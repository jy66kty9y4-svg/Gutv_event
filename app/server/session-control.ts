import { createHash, randomUUID } from 'node:crypto';
import { accountPrivileges } from '@/app/server/access';
import { database } from '@/db/server';
import { normalizedUsername, type VerifiedSession } from '@/app/auth';

const SITE_ID = 'gutv-portal';
const USER_NAMESPACE = 'a7320598-5d4c-4148-8bfd-415fb4c7db71';
const ENVIRONMENT_ACCOUNT_ID = 0;

type AccountRow = {
  id: number; username: string; role: 'requester' | 'management'; status: AccountStatus;
  organization_id: number | null; display_name: string; created_at: string | null; last_login_at: string | null;
  organization_status: AccountStatus | null; organization_name: string | null;
};
type AccountStatus = 'pending' | 'active' | 'rejected' | 'blocked';
type AccessRow = { admin_access_blocked: number; revoked_before: number };
type SessionRow = { id: string; account_id: number; issued_at: number; expires_at: number; last_activity_at: string; client_ip: string | null; user_agent: string; observed_at: string | null; revoked_at: string | null; legacy: number };

function iso(value: string | null | undefined) { return value ? value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z') : null; }
function nowSeconds() { return Math.floor(Date.now() / 1000); }
function digest(token: string) { return createHash('sha256').update(token).digest('hex'); }
function uuidBytes(value: string) { return Buffer.from(value.replace(/-/g, ''), 'hex'); }
function uuid5(name: string) {
  const hash = createHash('sha1').update(Buffer.concat([uuidBytes(USER_NAMESPACE), Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function publicUserId(accountId: number) { return uuid5(`gutv-portal:account:${accountId}`); }
export function accountTargetId(accountId: number) { return `${SITE_ID}:${publicUserId(accountId)}`; }
export function sessionStatus(row: Pick<SessionRow, 'expires_at' | 'revoked_at'>) { return row.revoked_at ? 'revoked' : row.expires_at <= nowSeconds() ? 'expired' : 'active'; }

function environmentAccount(): AccountRow {
  return { id: 0, username: normalizedUsername(process.env.GUTV_ADMIN_USERNAME || 'studio'), role: 'management', status: 'active', organization_id: null, display_name: 'Руководство ГУТВ', created_at: null, last_login_at: null, organization_status: null, organization_name: null };
}
function accountRow(accountId: number): AccountRow | undefined {
  if (accountId === ENVIRONMENT_ACCOUNT_ID) return environmentAccount();
  return database().prepare(`SELECT a.id, a.username, a.role, a.status, a.organization_id, a.display_name, a.created_at, a.last_login_at,
      o.status AS organization_status, o.name AS organization_name
    FROM portal_accounts a LEFT JOIN portal_organizations o ON o.id = a.organization_id WHERE a.id = ?`).get(accountId) as AccountRow | undefined;
}
function accessRow(accountId: number): AccessRow {
  const db = database();
  db.prepare('INSERT OR IGNORE INTO portal_account_access (account_id) VALUES (?)').run(accountId);
  return db.prepare('SELECT admin_access_blocked, revoked_before FROM portal_account_access WHERE account_id = ?').get(accountId) as AccessRow;
}
function allowed(account: AccountRow, access: AccessRow) { return !access.admin_access_blocked && account.status === 'active' && (account.role === 'management' || account.organization_status === 'active'); }
function sessionCount(accountId: number) { return Number((database().prepare('SELECT COUNT(*) AS count FROM portal_auth_sessions WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ?').get(accountId, nowSeconds()) as { count: number }).count); }
function lastSeen(accountId: number) { return iso((database().prepare('SELECT MAX(last_activity_at) AS value FROM portal_auth_sessions WHERE account_id = ?').get(accountId) as { value: string | null }).value); }

export function ensureIssuedSession(token: string, session: VerifiedSession, request?: Request) {
  const db = database();
  const id = session.sessionId || randomUUID();
  db.prepare('INSERT OR IGNORE INTO portal_account_access (account_id) VALUES (?)').run(session.accountId);
  db.prepare(`INSERT OR IGNORE INTO portal_auth_sessions
    (id, account_id, token_digest, issued_at, expires_at, client_ip, user_agent, observed_at, legacy)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`)
    .run(id, session.accountId, digest(token), session.issuedAt, session.expiresAt, request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null, (request?.headers.get('user-agent') || '').slice(0, 500), session.legacy ? 1 : 0);
  return id;
}

export async function validateStatefulSession(session: VerifiedSession, request?: Request) {
  const db = database();
  const account = accountRow(session.accountId); if (!account) return null;
  const access = accessRow(session.accountId);
  if (session.legacy) {
    const cutoff = (db.prepare('SELECT legacy_v2_cutoff_at FROM portal_session_control_state WHERE id = 1').get() as { legacy_v2_cutoff_at: number }).legacy_v2_cutoff_at;
    if (nowSeconds() > cutoff || session.issuedAt <= access.revoked_before) return null;
  }
  const tokenDigest = digest(session.token);
  let row = db.prepare('SELECT * FROM portal_auth_sessions WHERE token_digest = ?').get(tokenDigest) as SessionRow | undefined;
  if (!row && session.legacy) { ensureIssuedSession(session.token, session, request); row = db.prepare('SELECT * FROM portal_auth_sessions WHERE token_digest = ?').get(tokenDigest) as SessionRow | undefined; }
  if (!row || row.account_id !== session.accountId || row.expires_at !== session.expiresAt || row.issued_at !== session.issuedAt || (!session.legacy && row.id !== session.sessionId) || row.revoked_at || row.expires_at <= nowSeconds() || !allowed(account, access) || account.role !== session.role || account.username !== session.username || account.organization_id !== session.organizationId) return null;
  db.prepare(`UPDATE portal_auth_sessions SET last_activity_at = CURRENT_TIMESTAMP, observed_at = CURRENT_TIMESTAMP,
      client_ip = COALESCE(?, client_ip), user_agent = CASE WHEN ? <> '' THEN ? ELSE user_agent END WHERE id = ?`)
    .run(request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null, request?.headers.get('user-agent') || '', (request?.headers.get('user-agent') || '').slice(0, 500), row.id);
  const privileges = accountPrivileges(account.id);
  return { ...session, role: privileges.includes('panel.access') ? 'management' as const : 'requester' as const, privileges };
}

export async function revokeSessionFromToken(session: VerifiedSession) {
  const db = database();
  if (session.legacy) ensureIssuedSession(session.token, session);
  db.prepare('UPDATE portal_auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE token_digest = ?').run(digest(session.token));
}

export function users() {
  const rows = [environmentAccount(), ...(database().prepare(`SELECT a.id, a.username, a.role, a.status, a.organization_id, a.display_name, a.created_at, a.last_login_at,
    o.status AS organization_status, o.name AS organization_name FROM portal_accounts a LEFT JOIN portal_organizations o ON o.id = a.organization_id ORDER BY a.id`).all() as AccountRow[])];
  return rows.map((account) => user(account));
}
export function accountAccessAllowed(accountId: number) { const account = accountRow(accountId); return Boolean(account && allowed(account, accessRow(accountId))); }
export function user(account: AccountRow) {
  const access = accessRow(account.id); const isProtected = account.id === ENVIRONMENT_ACCOUNT_ID;
  return { site_id: SITE_ID, kind: 'portal_account', id: publicUserId(account.id), display_name: account.organization_name || account.display_name,
    identity: account.username, enabled: !access.admin_access_blocked, created_at: iso(account.created_at)!, roles: [account.role], active_session_count: sessionCount(account.id), last_seen_at: lastSeen(account.id),
    account_status: account.status, organization_status: account.organization_status, admin_access_blocked: Boolean(access.admin_access_blocked), access_allowed: allowed(account, access), protected: isProtected };
}
export function accountByPublicId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return undefined;
  const candidates = [environmentAccount(), ...(database().prepare(`SELECT a.id, a.username, a.role, a.status, a.organization_id, a.display_name, a.created_at, a.last_login_at,
    o.status AS organization_status, o.name AS organization_name FROM portal_accounts a LEFT JOIN portal_organizations o ON o.id = a.organization_id`).all() as AccountRow[])];
  return candidates.find((candidate) => publicUserId(candidate.id) === id.toLowerCase());
}
export function allSessions(status = 'all') {
  const rows = database().prepare('SELECT * FROM portal_auth_sessions ORDER BY last_activity_at DESC').all() as SessionRow[];
  return rows.filter((row) => status === 'all' || sessionStatus(row) === status).map((row) => session(row));
}
export function session(row: SessionRow) {
  const account = accountRow(row.account_id); return { site_id: SITE_ID, id: row.id, user_id: publicUserId(row.account_id), display_name: account?.organization_name || account?.display_name || 'Неизвестный аккаунт', issued_at: new Date(row.issued_at * 1000).toISOString(), last_activity_at: iso(row.last_activity_at)!, expires_at: new Date(row.expires_at * 1000).toISOString(), revoked_at: iso(row.revoked_at), client_ip: row.client_ip, user_agent: row.user_agent, observed_at: iso(row.observed_at), status: sessionStatus(row), session_kind: 'account', legacy: Boolean(row.legacy) };
}
export function summary() { const values = users(); const activeSessions = allSessions('active'); return { siteId: SITE_ID, totalUsers: values.length, enabledUsers: values.filter((item) => item.access_allowed).length, activeUsers: values.filter((item) => item.access_allowed && item.active_session_count > 0).length, activeSessions: activeSessions.length, actionsToday: Number((database().prepare("SELECT COUNT(*) AS count FROM portal_orbit_audit WHERE occurred_at >= date('now')").get() as { count: number }).count), asOf: new Date().toISOString() }; }
export function audit() { return (database().prepare('SELECT * FROM portal_orbit_audit ORDER BY occurred_at DESC LIMIT 500').all() as Array<{ id: string; occurred_at: string; actor: string; action: string; target_type: string; target_id: string; reason: string; outcome: 'succeeded'|'noop'|'failed'; request_id: string; details_json: string }>).map((item) => ({ id: item.id, occurred_at: iso(item.occurred_at)!, actor: item.actor, action: item.action, target_type: item.target_type, target_id: item.target_id, reason: item.reason, outcome: item.outcome, request_id: item.request_id, details: JSON.parse(item.details_json) })); }
export function loadSession(id: string) { return database().prepare('SELECT * FROM portal_auth_sessions WHERE id = ?').get(id) as SessionRow | undefined; }
export function terminateSession(row: SessionRow) { const active = sessionStatus(row) === 'active'; if (active) database().prepare('UPDATE portal_auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL').run(row.id); return { id: row.id, siteId: SITE_ID, status: active ? 'terminated' : 'already_closed', terminatedAt: active ? new Date().toISOString() : null }; }
export function terminateUserSessions(accountId: number) { const db = database(); const now = nowSeconds(); const result = db.prepare('UPDATE portal_auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ?').run(accountId, now); db.prepare('INSERT INTO portal_account_access (account_id, revoked_before, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(account_id) DO UPDATE SET revoked_before = excluded.revoked_before, updated_at = CURRENT_TIMESTAMP').run(accountId, now); return Number(result.changes); }
export function setEnabled(account: AccountRow, enabled: boolean) { if (account.id === 0) return null; const db = database(); const before = accessRow(account.id); const nextBlocked = enabled ? 0 : 1; const changed = before.admin_access_blocked !== nextBlocked; db.prepare('UPDATE portal_account_access SET admin_access_blocked = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?').run(nextBlocked, account.id); let terminated = 0; if (!enabled) terminated = terminateUserSessions(account.id); return { changed, terminated, accessAllowed: allowed(account, { admin_access_blocked: nextBlocked, revoked_before: before.revoked_before }) }; }
export function writeAudit(actor: string, action: string, targetType: string, targetId: string, reason: string, outcome: 'succeeded'|'noop'|'failed', requestId: string, details: Record<string, unknown>) { database().prepare('INSERT INTO portal_orbit_audit (id, actor, action, target_type, target_id, reason, outcome, request_id, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), actor, action, targetType, targetId, reason, outcome, requestId, JSON.stringify(details)); }
