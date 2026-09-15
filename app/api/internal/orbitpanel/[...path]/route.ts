import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { database } from '@/db/server';
import { accountByPublicId, accountTargetId, allSessions, audit, loadSession, setEnabled, summary, terminateSession, terminateUserSessions, user, writeAudit } from '@/app/server/session-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const internalHost = 'gutv-portal-control:3000';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function envelope(code: string, message: string, status: number) { return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } }); }
function sha256(body: string) { return createHash('sha256').update(body).digest('hex'); }
function validHeader(value: string | null) { return Boolean(value && value.length >= 8 && value.length <= 120 && /^[\x21-\x7e]+$/.test(value)); }
function privateHost(request: Request) {
  const forwardedHost = request.headers.get('x-forwarded-host'); const forwardedProto = request.headers.get('x-forwarded-proto');
  return request.headers.get('host') === internalHost && (!forwardedHost || forwardedHost === internalHost) && (!forwardedProto || forwardedProto === 'http');
}
function rawPath(request: Request) { const url = new URL(request.url); return `${url.pathname}${url.search}`; }
function reasonFrom(body: unknown) { return typeof (body as { reason?: unknown })?.reason === 'string' ? (body as { reason: string }).reason.trim().slice(0, 501) : ''; }

async function authenticate(request: Request, body: string) {
  const secret = process.env.ORBIT_GUTV_HMAC_SECRET;
  const timestamp = request.headers.get('x-orbit-timestamp'); const nonce = request.headers.get('x-orbit-nonce'); const actor = request.headers.get('x-orbit-actor'); const requestId = request.headers.get('x-orbit-request-id'); const signature = request.headers.get('x-orbit-signature');
  if (!secret || secret.length < 32 || !timestamp || !nonce || !actor || !requestId || !signature || !validHeader(nonce) || !validHeader(actor) || !validHeader(requestId) || !/^[0-9a-f]{64}$/i.test(signature)) return { error: envelope('authentication_failed', 'Подпись управляющего запроса не подтверждена.', 401) };
  const timestampNumber = Number(timestamp);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > 60) return { error: envelope('authentication_failed', 'Подпись управляющего запроса не подтверждена.', 401) };
  const bodyHash = sha256(body); const canonical = ['v1', request.method, rawPath(request), timestamp, nonce, actor, requestId, bodyHash].join('\n');
  const expected = createHmac('sha256', secret).update(canonical).digest(); const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { error: envelope('authentication_failed', 'Подпись управляющего запроса не подтверждена.', 401) };
  const db = database(); db.prepare('DELETE FROM portal_orbit_nonces WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
  try { db.prepare('INSERT INTO portal_orbit_nonces (nonce, expires_at) VALUES (?, ?)').run(nonce, Math.floor(Date.now() / 1000) + 120); } catch { return { error: envelope('replay_detected', 'Этот запрос уже был обработан.', 409) }; }
  return { actor, requestId, bodyHash };
}

function storedMutation(action: string, targetId: string, bodyHash: string, requestId: string) {
  const existing = database().prepare('SELECT action, target_id, body_sha256, status, response_json FROM portal_orbit_idempotency WHERE request_id = ?').get(requestId) as { action: string; target_id: string; body_sha256: string; status: number; response_json: string } | undefined;
  if (!existing) return undefined;
  if (existing.action !== action || existing.target_id !== targetId || existing.body_sha256 !== bodyHash) return envelope('request_id_conflict', 'Идентификатор запроса уже использован для другой операции.', 409);
  return new Response(existing.response_json, { status: existing.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function saveMutation(action: string, targetId: string, bodyHash: string, requestId: string, response: Record<string, unknown>, status = 200) { const serialized = JSON.stringify(response); database().prepare('INSERT INTO portal_orbit_idempotency (request_id, action, target_id, body_sha256, status, response_json) VALUES (?, ?, ?, ?, ?, ?)').run(requestId, action, targetId, bodyHash, status, serialized); return new Response(serialized, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }
function atomic<T>(operation: () => T) { const db = database(); db.exec('BEGIN IMMEDIATE'); try { const value = operation(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } }

async function control(request: Request, context: Context) {
  if (!privateHost(request)) return new Response(null, { status: 404 });
  const { path } = await context.params; const tail = path.join('/');
  const permitted = request.method === 'GET' ? ['summary', 'users', 'sessions', 'audit'].includes(tail) : /^sessions\/[0-9a-f-]{36}\/terminate$/i.test(tail) || /^users\/[0-9a-f-]{36}\/(terminate-sessions|set-enabled)$/i.test(tail);
  if (!permitted) return envelope('invalid_id', 'Управляющий маршрут не найден.', 400);
  if (request.method === 'POST' && !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return envelope('authentication_failed', 'Подпись управляющего запроса не подтверждена.', 401);
  const body = request.method === 'GET' ? '' : await request.text();
  if (body.length > 64 * 1024) return envelope('authentication_failed', 'Подпись управляющего запроса не подтверждена.', 401);
  const auth = await authenticate(request, body); if ('error' in auth) return auth.error;
  if (request.method === 'GET') {
    if (tail === 'summary') return Response.json({ data: summary() }, { headers: { 'Cache-Control': 'no-store' } });
    if (tail === 'users') return Response.json({ data: (await import('@/app/server/session-control')).users() }, { headers: { 'Cache-Control': 'no-store' } });
    if (tail === 'audit') return Response.json({ data: audit() }, { headers: { 'Cache-Control': 'no-store' } });
    const status = new URL(request.url).searchParams.get('status') || 'all'; if (!['all', 'active', 'expired', 'revoked'].includes(status)) return envelope('invalid_query', 'Неизвестный фильтр сессий.', 400);
    return Response.json({ data: allSessions(status) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  let parsed: unknown; try { parsed = JSON.parse(body); } catch { return envelope('reason_required', 'Укажите причину операции.', 422); }
  const rawReason = typeof (parsed as { reason?: unknown })?.reason === 'string' ? (parsed as { reason: string }).reason.trim() : ''; const reason = reasonFrom(parsed); if (rawReason.length < 3 || rawReason.length > 500 || reason.length < 3) return envelope('reason_required', 'Укажите причину операции.', 422);
  if (tail.startsWith('sessions/')) {
    const id = tail.split('/')[1]; if (!uuid.test(id)) return envelope('invalid_id', 'Некорректный идентификатор сессии.', 400);
    const targetId = `gutv-portal:${id}`; const repeated = storedMutation('session.terminated', targetId, auth.bodyHash, auth.requestId); if (repeated) return repeated;
    const row = loadSession(id); if (!row) return envelope('session_not_found', 'Сессия не найдена.', 404);
    return atomic(() => { const data = terminateSession(row); const outcome = data.status === 'terminated' ? 'succeeded' : 'noop'; writeAudit(auth.actor, 'session.terminated', 'session', targetId, reason, outcome, auth.requestId, { siteId: 'gutv-portal', before: data.status === 'terminated' ? 'active' : data.status, after: data.status, changed: data.status === 'terminated', terminatedCount: data.status === 'terminated' ? 1 : 0 }); return saveMutation('session.terminated', targetId, auth.bodyHash, auth.requestId, { data }); });
  }
  const [, userId, operation] = tail.split('/'); if (!uuid.test(userId)) return envelope('invalid_id', 'Некорректный идентификатор пользователя.', 400);
  const account = accountByPublicId(userId); if (!account) return envelope('user_not_found', 'Пользователь не найден.', 404);
  const targetId = accountTargetId(account.id);
  if (operation === 'terminate-sessions') {
    const repeated = storedMutation('user.sessions_terminated', targetId, auth.bodyHash, auth.requestId); if (repeated) return repeated;
    return atomic(() => { const terminatedCount = terminateUserSessions(account.id); const data = { userId, siteId: 'gutv-portal', terminatedCount }; writeAudit(auth.actor, 'user.sessions_terminated', 'user', targetId, reason, terminatedCount ? 'succeeded' : 'noop', auth.requestId, { siteId: 'gutv-portal', before: 'active', after: terminatedCount ? 'terminated' : 'already_closed', changed: Boolean(terminatedCount), terminatedCount }); return saveMutation('user.sessions_terminated', targetId, auth.bodyHash, auth.requestId, { data }); });
  }
  const enabled = (parsed as { enabled?: unknown }).enabled; if (typeof enabled !== 'boolean') return envelope('enabled_required', 'Укажите состояние доступа.', 422);
  const repeated = storedMutation(enabled ? 'user.enabled' : 'user.disabled', targetId, auth.bodyHash, auth.requestId); if (repeated) return repeated;
  if (account.id === 0) return envelope('protected_management_account', 'Системная управленческая учётная запись защищена.', 403);
  return atomic(() => { const before = user(account); const changed = setEnabled(account, enabled)!; const data = { userId, siteId: 'gutv-portal', enabled, changed: changed.changed, accessAllowed: changed.accessAllowed }; const action = enabled ? 'user.enabled' : 'user.disabled'; writeAudit(auth.actor, action, 'user', targetId, reason, changed.changed ? 'succeeded' : 'noop', auth.requestId, { siteId: 'gutv-portal', before: before.enabled, after: enabled, changed: changed.changed, terminatedCount: changed.terminated }); return saveMutation(action, targetId, auth.bodyHash, auth.requestId, { data }); });
}

export const GET = control;
export const POST = control;
