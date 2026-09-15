import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Uses a built server by default. --dev should only be used in an isolated copy.
const root = process.env.GUTV_AUTH_TEST_ROOT || process.cwd();
const work = await mkdtemp(join(tmpdir(), 'gutv-auth-test-'));
const dbPath = join(work, 'requests.sqlite');
const adminPassword = randomBytes(24).toString('base64url');
const salt = randomBytes(18);
const passwordRecord = `pbkdf2-sha256$210000$${salt.toString('base64url')}$${pbkdf2Sync(adminPassword, salt, 210000, 32, 'sha256').toString('base64url')}`;
const port = await new Promise((resolve, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const base = `http://127.0.0.1:${port}`;
let child, db, browser, logs = '';
async function request(path, method = 'GET', body, cookie) {
  return fetch(base + path, { method, redirect: 'manual', headers: { origin: base, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function expectStatus(response, status, message) {
  const data = await response.json();
  assert.equal(response.status, status, `${message}: ${JSON.stringify(data)}`);
  return data;
}
async function login(username, password) {
  const response = await request('/api/auth/login', 'POST', { username, password });
  await expectStatus(response, 200, 'Login');
  return response.headers.get('set-cookie').split(';')[0];
}
const registration = {
  organizationType: 'organization', organizationName: 'Русская тестовая организация',
  representativeName: 'Алёна Тестовая', contact: '@тестовый_контакт',
  username: ' ЁЖИК.СТУДИЯ_42 ', password: 'ПарольНаРусскомЁ123!',
};
try {
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...(process.argv.includes('--dev') ? ['dev', '--webpack'] : ['start']), '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: { ...process.env, GUTV_DATABASE_PATH: dbPath, GUTV_UPLOAD_PATH: join(work, 'uploads'), GUTV_SESSION_SECRET: randomBytes(32).toString('base64url'), GUTV_ADMIN_USERNAME: 'studio', GUTV_PASSWORD_RECORD: passwordRecord, GUTV_TELEGRAM_BOT_TOKEN: '', GUTV_TELEGRAM_ADMIN_CHAT_ID: '', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await request('/api/auth/session')).status === 401) { ready = true; break; } } catch { /* booting */ }
    if (child.exitCode !== null) throw new Error(logs.slice(-2000));
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Server readiness: ${logs.slice(-2000)}`);
  for (const malformedCookie of ['gutv_session=%', 'gutv_session=%E0%A4%A', 'gutv_session=%FF']) {
    await expectStatus(await request('/api/auth/session', 'GET', undefined, malformedCookie), 401, 'Malformed cookie is an unauthenticated request');
    await expectStatus(await request('/api/applications', 'GET', undefined, malformedCookie), 401, 'Malformed cookie cannot crash a private endpoint');
  }
  const admin = await login('studio', adminPassword);
  await expectStatus(await request('/api/auth/register', 'POST', registration), 201, 'Cyrillic registration');
  db = new DatabaseSync(dbPath);
  const account = db.prepare('SELECT a.id, a.username, a.organization_id FROM portal_accounts a WHERE a.username = ?').get('ёжик.студия_42');
  assert.ok(account, 'Username is normalized without transliteration');
  const pending = await expectStatus(await request('/api/auth/login', 'POST', { username: 'ЁЖИК.СТУДИЯ_42', password: registration.password }), 403, 'Pending account');
  assert.match(pending.error, /рассмотрении/);
  await expectStatus(await request(`/api/admin/organizations/${account.organization_id}`, 'PATCH', { status: 'active' }, admin), 200, 'Approve organization');
  const cookie = await login('ЁЖИК.СТУДИЯ_42', registration.password);
  const payload = JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.username, 'ёжик.студия_42');
  assert.equal(payload.displayName, registration.organizationName);
  const session = await expectStatus(await request('/api/auth/session', 'GET', undefined, cookie), 200, 'Cyrillic session');
  assert.equal(session.user.displayName, registration.organizationName);
  await expectStatus(await request('/api/auth/login', 'POST', { username: 'ЁЖИК.СТУДИЯ_42', password: registration.password.toLocaleLowerCase('ru-RU') }), 401, 'Password case must match');
  await expectStatus(await request('/api/auth/register', 'POST', { ...registration, organizationName: 'Дубликат логина', username: 'ёжик.студия_42' }), 409, 'Case insensitive Cyrillic uniqueness');
  console.log('PASS Cyrillic registration, moderation, case insensitive login, case sensitive password, UTF-8 session');

  const count = () => db.prepare('SELECT COUNT(*) AS count FROM portal_accounts').get().count;
  const beforeInvalid = count();
  for (const [field, size] of [['organizationName', 121], ['representativeName', 121], ['contact', 121], ['username', 61], ['password', 201]]) {
    await expectStatus(await request('/api/auth/register', 'POST', { ...registration, organizationName: 'Проверка ограничений', username: 'проверка_ограничений', [field]: 'я'.repeat(size) }), 400, `Overlong ${field} must be rejected, not truncated`);
    if (field !== 'password') await expectStatus(await request('/api/auth/register', 'POST', { ...registration, organizationName: 'Проверка ограничений', username: 'проверка_ограничений', [field]: 'я'.repeat(3) + ' '.repeat(size) }), 400, `Whitespace normalization must not bypass ${field} limit`);
  }
  for (const [field, value] of [['organizationName', 'А'], ['representativeName', 'А'], ['contact', '12'], ['username', 'аб'], ['username', 'имя пользователя'], ['password', 'пароль']]) {
    const result = await expectStatus(await request('/api/auth/register', 'POST', { ...registration, organizationName: 'Проверка ограничений', username: 'проверка_ограничений', [field]: value }), 400, `Invalid ${field}`);
    assert.ok(result.error.length > 0);
  }
  for (const body of [null, [], 'invalid']) await expectStatus(await request('/api/auth/register', 'POST', body), 400, 'Malformed registration');
  assert.equal(count(), beforeInvalid, 'Invalid registration creates no account');
  const maximum = { organizationType: 'faculty', organizationName: 'я'.repeat(120), representativeName: 'я'.repeat(120), contact: 'я'.repeat(120), username: 'я'.repeat(60), password: 'Я'.repeat(200) };
  await expectStatus(await request('/api/auth/register', 'POST', maximum), 201, 'Exact maximum lengths');
  const maximumAccount = db.prepare('SELECT organization_id FROM portal_accounts WHERE username = ?').get(maximum.username);
  await expectStatus(await request(`/api/admin/organizations/${maximumAccount.organization_id}`, 'PATCH', { status: 'active' }, admin), 200, 'Approve maximum length registration');
  await login(maximum.username, maximum.password);
  await expectStatus(await request('/api/auth/login', 'POST', { username: maximum.username + ' ', password: maximum.password }), 400, 'Login raw username limit');
  console.log('PASS registration bounds, clear validation, no truncated accounts, exact maximum length password login');

  if (process.env.GUTV_AUTH_PLAYWRIGHT_MODULE) {
    const { chromium } = await import(process.env.GUTV_AUTH_PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true, ...(process.env.GUTV_AUTH_BROWSER_CHANNEL ? { channel: process.env.GUTV_AUTH_BROWSER_CHANNEL } : {}) });
    for (const [index, viewport] of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }].entries()) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => { errors.push(error.message); });
      await page.goto(`${base}/?auth=register`);
      const form = page.locator('.auth-register-form'); await form.waitFor();
      const username = `РУССКИЙ_БРАУЗЕР_${index}`, password = 'РусскийПарольЁ123!';
      for (const [name, value] of Object.entries({ organizationName: `Русская организация браузера ${index}`, representativeName: 'Алёна Браузерная', contact: '@русский_контакт', username, password })) await form.locator(`[name="${name}"]`).fill(value);
      assert.equal(await form.locator('[name="username"]').inputValue(), username);
      assert.equal(await form.locator('[name="password"]').inputValue(), password);
      assert.ok(await page.locator('#register-username-hint').isVisible());
      assert.ok(await page.locator('#register-password-hint').isVisible());
      assert.ok(await form.evaluate(element => element.checkValidity()));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow');
      await form.getByRole('button', { name: 'Отправить регистрацию' }).click();
      await page.getByRole('heading', { name: 'Заявка отправлена' }).waitFor();
      const created = db.prepare('SELECT organization_id FROM portal_accounts WHERE username = ?').get(username.toLocaleLowerCase('ru-RU'));
      await expectStatus(await request(`/api/admin/organizations/${created.organization_id}`, 'PATCH', { status: 'active' }, admin), 200, 'Approve browser registration');
      await page.getByRole('button', { name: 'Перейти ко входу' }).click();
      await page.locator('.auth-dialog [name="username"]').fill(username);
      await page.locator('.auth-dialog [name="password"]').fill(password);
      await page.locator('.auth-dialog').getByRole('button', { name: 'Войти', exact: true }).click();
      await page.waitForURL(`${base}/cabinet`);
      assert.deepEqual(errors, [], 'No browser JavaScript errors');
      await context.close();
    }
    console.log('PASS desktop and mobile browser Cyrillic input, registration, login, hints, and layout');
  }
} catch (error) { console.error(logs.slice(-1800)); throw error; }
finally {
  await browser?.close();
  if (child && child.exitCode === null) await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
  db?.close();
  await rm(work, { recursive: true, force: true });
}
