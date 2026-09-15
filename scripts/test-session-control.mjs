import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = await mkdtemp(join(tmpdir(), 'gutv-session-control-'));
const dbPath = join(work, 'requests.sqlite');
const port = 34719;
const secret = 'test-control-secret-with-at-least-32-characters';
const sessionSecret = 'dGVzdC1zZXNzaW9uLXNlY3JldC1mb3ItZ3V0di1jb250cm9s';
let child;

function stop() { if (child && !child.killed) child.kill('SIGTERM'); }
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const requestBody = options.body;
    const client = httpRequest({ hostname: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    client.on('error', reject); if (requestBody) client.write(requestBody); client.end();
  });
}
function sign(method, path, body = '', requestId = randomUUID(), nonce = randomUUID()) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = awaitHash(body);
  return { timestamp, requestId, nonce, signature: createHmac('sha256', secret).update(['v1', method, path, timestamp, nonce, 'test-owner', requestId, digest].join('\n')).digest('hex') };
}
function awaitHash(value) { return createHash('sha256').update(value).digest('hex'); }

async function internal(method, path, payload, overrides = {}) {
  const body = method === 'GET' ? '' : JSON.stringify(payload);
  const signed = sign(method, path, body, overrides.requestId, overrides.nonce);
  const headers = { Host: 'gutv-portal-control:3000', 'Content-Type': 'application/json', 'X-Orbit-Timestamp': signed.timestamp, 'X-Orbit-Nonce': signed.nonce, 'X-Orbit-Actor': 'test-owner', 'X-Orbit-Request-Id': signed.requestId, 'X-Orbit-Signature': overrides.badSignature ? `${signed.signature[0] === '0' ? '1' : '0'}${signed.signature.slice(1)}` : signed.signature };
  if (overrides.forwarded !== false) Object.assign(headers, { 'X-Forwarded-Host': 'gutv-portal-control:3000', 'X-Forwarded-Proto': 'http' });
  const response = await request(path, { method, body: method === 'GET' ? undefined : body, headers });
  return { response, json: await response.json(), signed };
}
function sessionIdFromCookie(cookie) { return JSON.parse(Buffer.from(decodeURIComponent(cookie.split('=')[1]).split('.')[1], 'base64url').toString('utf8')).sessionId; }
function legacyCookie(accountId, username, displayName, marker) { const expiresAt = Math.floor(Date.now() / 1000) + 12 * 60 * 60; const payload = Buffer.from(JSON.stringify({ accountId, role: 'requester', organizationId: 1, username, displayName, expiresAt, marker })).toString('base64url'); const signed = `v2.${payload}`; return `gutv_session=${signed}.${createHmac('sha256', Buffer.from(sessionSecret, 'base64url')).update(signed).digest('base64url')}`; }

try {
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env: { ...process.env, GUTV_DATABASE_PATH: dbPath, GUTV_SESSION_SECRET: sessionSecret, GUTV_ADMIN_USERNAME: 'studio', GUTV_PASSWORD_RECORD: '', ORBIT_GUTV_HMAC_SECRET: secret, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let boot = ''; child.stdout.on('data', (chunk) => { boot += chunk; }); child.stderr.on('data', (chunk) => { boot += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) { try { if ((await request('/')).status < 500) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); if (attempt === 59) throw new Error(`server did not start: ${boot}`); }
  const registration = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationType: 'organization', organizationName: 'Session Test Org', representativeName: 'Session Test', contact: 'test@example.test', username: 'session-test', password: 'correct-horse-battery' }) }); assert.equal(registration.status, 201);
  const db = new DatabaseSync(dbPath); db.prepare("UPDATE portal_organizations SET status = 'active' WHERE name = 'Session Test Org'").run(); db.prepare("UPDATE portal_accounts SET status = 'active' WHERE username = 'session-test'").run();
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'session-test', password: 'correct-horse-battery' }) }); assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
  const secondLogin = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'session-test', password: 'correct-horse-battery' }) }); assert.equal(secondLogin.status, 200); const secondCookie = secondLogin.headers.get('set-cookie').split(';')[0];
  const publicAttempt = await request('/api/internal/orbitpanel/summary'); assert.equal(publicAttempt.status, 404);
  const unsigned = await request('/api/internal/orbitpanel/summary', { headers: { Host: 'gutv-portal-control:3000', 'X-Forwarded-Host': 'gutv-portal-control:3000', 'X-Forwarded-Proto': 'http' } }); assert.equal(unsigned.status, 401);
  const badHmac = await internal('GET', '/api/internal/orbitpanel/summary', undefined, { badSignature: true }); assert.equal(badHmac.response.status, 401);
  const directInternal = await internal('GET', '/api/internal/orbitpanel/summary', undefined, { forwarded: false }); assert.equal(directInternal.response.status, 200);
  const listed = await internal('GET', '/api/internal/orbitpanel/users'); assert.equal(listed.response.status, 200); const admin = listed.json.data.find((item) => item.protected); assert.equal(admin.created_at, null); const target = listed.json.data.find((item) => item.identity === 'session-test'); assert.ok(target);
  const sessions = await internal('GET', '/api/internal/orbitpanel/sessions?status=active'); assert.equal(sessions.response.status, 200); const targetSession = sessions.json.data.find((item) => item.id === sessionIdFromCookie(cookie)); assert.ok(targetSession);
  const terminate = await internal('POST', `/api/internal/orbitpanel/sessions/${targetSession.id}/terminate`, { reason: 'Close one active session' }); assert.equal(terminate.response.status, 200); assert.equal((await request('/api/auth/session', { headers: { Cookie: cookie } })).status, 401); assert.equal((await request('/api/applications', { headers: { Cookie: cookie } })).status, 401); assert.equal((await request('/api/auth/session', { headers: { Cookie: secondCookie } })).status, 200);
  const all = await internal('POST', `/api/internal/orbitpanel/users/${target.id}/terminate-sessions`, { reason: 'Close all active sessions' }); assert.equal(all.response.status, 200); assert.equal((await request('/api/auth/session', { headers: { Cookie: secondCookie } })).status, 401);
  const freshLogin = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'session-test', password: 'correct-horse-battery' }) }); assert.equal(freshLogin.status, 200); const freshCookie = freshLogin.headers.get('set-cookie').split(';')[0];
  const disableId = randomUUID(); const disabled = await internal('POST', `/api/internal/orbitpanel/users/${target.id}/set-enabled`, { enabled: false, reason: 'Security test block' }, { requestId: disableId }); assert.equal(disabled.response.status, 200); assert.equal(disabled.json.data.enabled, false); assert.equal((await request('/api/auth/session', { headers: { Cookie: freshCookie } })).status, 401); assert.equal((await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'session-test', password: 'correct-horse-battery' }) })).status, 403);
  const reenabled = await internal('POST', `/api/internal/orbitpanel/users/${target.id}/set-enabled`, { enabled: true, reason: 'Security test unblock' }); assert.equal(reenabled.response.status, 200); assert.equal((await request('/api/auth/session', { headers: { Cookie: freshCookie } })).status, 401); const relogin = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'session-test', password: 'correct-horse-battery' }) }); assert.equal(relogin.status, 200);
  const accountId = db.prepare("SELECT id FROM portal_accounts WHERE username = 'session-test'").get().id; await new Promise((resolve) => setTimeout(resolve, 1100)); const observedLegacy = legacyCookie(accountId, 'session-test', 'Session Test Org', 'observed'); const unseenLegacy = legacyCookie(accountId, 'session-test', 'Session Test Org', 'unseen'); assert.notEqual(observedLegacy, unseenLegacy); assert.equal((await request('/api/auth/session', { headers: { Cookie: observedLegacy } })).status, 200); assert.equal(db.prepare('SELECT COUNT(*) AS count FROM portal_auth_sessions WHERE token_digest = ?').get(createHash('sha256').update(unseenLegacy.split('=')[1]).digest('hex')).count, 0); await internal('POST', `/api/internal/orbitpanel/users/${target.id}/terminate-sessions`, { reason: 'Terminate legacy sessions' }); assert.equal((await request('/api/auth/session', { headers: { Cookie: observedLegacy } })).status, 401); assert.equal((await request('/api/auth/session', { headers: { Cookie: unseenLegacy } })).status, 401); db.prepare('UPDATE portal_session_control_state SET legacy_v2_cutoff_at = 0 WHERE id = 1').run(); assert.equal((await request('/api/auth/session', { headers: { Cookie: legacyCookie(accountId, 'session-test', 'Session Test Org', 'cutoff') } })).status, 401);
  const replayNonce = randomUUID(); const replayRequest = randomUUID(); const first = await internal('POST', `/api/internal/orbitpanel/users/${target.id}/terminate-sessions`, { reason: 'Replay guard test' }, { nonce: replayNonce, requestId: replayRequest }); assert.equal(first.response.status, 200); const replay = await internal('POST', `/api/internal/orbitpanel/users/${target.id}/terminate-sessions`, { reason: 'Replay guard test' }, { nonce: replayNonce, requestId: replayRequest }); assert.equal(replay.response.status, 409); const idempotent = await internal('POST', `/api/internal/orbitpanel/users/${target.id}/terminate-sessions`, { reason: 'Replay guard test' }, { requestId: replayRequest }); assert.equal(idempotent.response.status, 200); const conflict = await internal('POST', `/api/internal/orbitpanel/users/${target.id}/terminate-sessions`, { reason: 'Different idempotent body' }, { requestId: replayRequest }); assert.equal(conflict.response.status, 409);
  const protectedResult = await internal('POST', `/api/internal/orbitpanel/users/${admin.id}/set-enabled`, { enabled: false, reason: 'Do not block admin' }); assert.equal(protectedResult.response.status, 403);
  db.prepare("UPDATE portal_organizations SET status = 'pending' WHERE name = 'Session Test Org'").run(); db.prepare("UPDATE portal_accounts SET status = 'pending' WHERE username = 'session-test'").run(); const pendingSummary = await internal('GET', '/api/internal/orbitpanel/summary'); assert.equal(pendingSummary.json.data.enabledUsers, 1); await internal('POST', `/api/internal/orbitpanel/users/${target.id}/set-enabled`, { enabled: false, reason: 'Block pending account' }); await internal('POST', `/api/internal/orbitpanel/users/${target.id}/set-enabled`, { enabled: true, reason: 'Unblock pending account' }); assert.equal((await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'session-test', password: 'correct-horse-battery' }) })).status, 403);
  db.prepare("UPDATE portal_organizations SET status = 'rejected' WHERE name = 'Session Test Org'").run(); db.prepare("UPDATE portal_accounts SET status = 'rejected' WHERE username = 'session-test'").run(); assert.equal((await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'session-test', password: 'correct-horse-battery' }) })).status, 403); const noSecrets = JSON.stringify((await internal('GET', '/api/internal/orbitpanel/sessions')).json); assert.ok(!noSecrets.includes('correct-horse-battery') && !noSecrets.includes(cookie.split('=')[1]));
  console.log('PASS session-control security integration');
} finally { stop(); await rm(work, { recursive: true, force: true }); }
