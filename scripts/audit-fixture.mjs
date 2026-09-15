import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export async function startAuditFixture() {
  const root = process.cwd();
  const work = await mkdtemp(join(tmpdir(), 'gutv-audit-regression-'));
  const dbPath = join(work, 'requests.sqlite');
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(18);
  const passwordRecord = `pbkdf2-sha256$210000$${salt.toString('base64url')}$${pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('base64url')}`;
  const port = await new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const base = `http://127.0.0.1:${port}`;
  let logs = '';
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, GUTV_DATABASE_PATH: dbPath, GUTV_UPLOAD_PATH: join(work, 'uploads'), GUTV_SESSION_SECRET: randomBytes(32).toString('base64url'), GUTV_ADMIN_USERNAME: 'studio', GUTV_PASSWORD_RECORD: passwordRecord, GUTV_TELEGRAM_BOT_TOKEN: '', GUTV_TELEGRAM_ADMIN_CHAT_ID: '', GUTV_VK_CONFIRMATION_CODE: '', GUTV_VK_GROUP_ID: '', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-5000); });
  child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-5000); });
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    if (child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
    });
    await rm(work, { recursive: true, force: true });
  }
  async function request(path, cookie, method = 'GET', body) {
    return fetch(base + path, { method, redirect: 'manual', headers: {
      origin: base, ...(cookie ? { cookie } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
  }
  async function json(path, cookie, method = 'GET', body, expected = 200) {
    const response = await request(path, cookie, method, body), value = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
    return value;
  }
  async function login(username) {
    const response = await request('/api/auth/login', null, 'POST', { username, password });
    assert.equal(response.status, 200, `Login ${username}`);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if ((await request('/api/auth/session')).status === 401) { ready = true; break; } } catch { /* booting */ }
      if (child.exitCode !== null) throw new Error(`Fixture stopped: ${logs}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, `Fixture not ready: ${logs}`);
    const adminCookie = await login('studio');
    const members = [];
    for (const [username, name] of [['audit-member', 'Тестовая организация'], ['audit-other', 'Другая тестовая организация']]) {
      await json('/api/auth/register', null, 'POST', { organizationType: 'organization', organizationName: name, representativeName: 'Тестовый представитель', contact: '@audit_fixture', username, password }, 201);
      const dashboard = await json('/api/admin/dashboard', adminCookie);
      const organization = dashboard.organizations.find(item => item.name === name);
      await json(`/api/admin/organizations/${organization.id}`, adminCookie, 'PATCH', { status: 'active' });
      members.push(await login(username));
    }
    return { base, adminCookie, memberCookie: members[0], otherCookie: members[1], password, dbPath, request, json, close };
  } catch (error) { await close(); throw error; }
}
