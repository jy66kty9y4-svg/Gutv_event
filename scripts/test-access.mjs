import assert from 'node:assert/strict';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createPortalSchemaSql } from '../db/schema.ts';

// Real production server, real password login, isolated synthetic data only.
const work = await mkdtemp(join(tmpdir(), 'gutv-access-test-'));
const dbPath = join(work, 'requests.sqlite');
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(18);
const passwordRecord = `pbkdf2-sha256$210000$${salt.toString('base64url')}$${pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('base64url')}`;
const sessionSecret = randomBytes(32).toString('base64url');
const port = await new Promise((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}`;
let child, logs = '', db;
async function start() {
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(), env: { ...process.env, GUTV_DATABASE_PATH: dbPath, GUTV_UPLOAD_PATH: join(work, 'uploads'), GUTV_SESSION_SECRET: sessionSecret, GUTV_ADMIN_USERNAME: 'studio', GUTV_PASSWORD_RECORD: passwordRecord, GUTV_TELEGRAM_BOT_TOKEN: '', GUTV_TELEGRAM_ADMIN_CHAT_ID: '', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', c => { logs += c; }); child.stderr.on('data', c => { logs += c; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/studio')).ok) return; } catch { /* booting */ }
    if (child.exitCode !== null) throw new Error(logs.slice(-2000));
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Readiness timeout ' + logs.slice(-2000));
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  await new Promise(resolve => { const timer = setTimeout(() => current.kill('SIGKILL'), 5000); current.once('exit', () => { clearTimeout(timer); resolve(); }); current.kill('SIGTERM'); });
}
async function req(path, cookie, method = 'GET', body, origin = base) {
  return fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method === 'GET' ? {} : { origin, 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(path, cookie, method = 'GET', body) {
  const response = await req(path, cookie, method, body); const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`); return data;
}
async function login(username) {
  const response = await req('/api/auth/login', null, 'POST', { username, password });
  assert.equal(response.status, 200, `login ${username}`);
  return response.headers.get('set-cookie').split(';')[0];
}
const forbiddenRoutes = [
  ['/api/admin/access', 'GET'], ['/api/admin/access/roles', 'POST'], ['/api/admin/access/roles/1', 'PATCH'], ['/api/admin/access/users/1', 'PATCH'],
  ['/api/admin/applications/1', 'PATCH'], ['/api/admin/organizations/1', 'PATCH'], ['/api/admin/specialties', 'POST'], ['/api/admin/specialties/1', 'PATCH'],
  ['/api/admin/leadership', 'GET'], ['/api/admin/leadership/people', 'POST'], ['/api/admin/leadership/people/1', 'PATCH'], ['/api/admin/leadership/positions', 'POST'], ['/api/admin/leadership/positions/1', 'DELETE'], ['/api/admin/leadership/order', 'PUT'], ['/api/admin/leadership/photos', 'POST'],
  ['/api/admin/projects', 'GET'], ['/api/admin/projects', 'POST'], ['/api/admin/projects/1', 'PATCH'], ['/api/admin/projects/order', 'PUT'], ['/api/admin/projects/photos', 'POST'],
];
try {
  db = new DatabaseSync(dbPath); db.exec(createPortalSchemaSql);
  const org = db.prepare("INSERT INTO portal_organizations (type,name,representative_name,contact,status) VALUES ('organization',?,?,?,'active')");
  org.run('Тестовая организация', 'Тестовый сотрудник', 'test@example.test'); org.run('Другая организация', 'Другой сотрудник', 'other@example.test');
  const account = db.prepare("INSERT INTO portal_accounts (username,password_hash,role,status,organization_id,display_name) VALUES (?,?,?,'active',?,?)");
  account.run('member-one', passwordRecord, 'requester', 1, 'Тестовый сотрудник');
  account.run('member-two', passwordRecord, 'requester', 2, 'Другой сотрудник');
  account.run('legacy-admin', passwordRecord, 'management', null, 'Прежний администратор');
  db.prepare(`INSERT INTO portal_applications (organization_id,created_by,event_title,event_date,start_time,end_time,location,event_description,requested_equipment,contact_name,contact_channel,internal_comment) VALUES (2,2,'Чужая заявка','2026-10-01','12:00','13:00','Студия','Описание тестовой заявки','Камера','Другой сотрудник','other@example.test','Служебные сведения')`).run();
  db.prepare("INSERT INTO portal_attachments (application_id,original_name,stored_name,mime_type,size_bytes) VALUES (1,'11111111-1111-4111-8111-111111111111.pdf','11111111-1111-4111-8111-111111111111.pdf','text/plain',4)").run();
  await mkdir(join(work, 'uploads')); await writeFile(join(work, 'uploads', '11111111-1111-4111-8111-111111111111.pdf'), 'test');
  await start();
  const admin = await login('studio'), member = await login('member-one'), other = await login('member-two'), legacy = await login('legacy-admin');
  const snapshot = () => json('/api/admin/access', admin);
  let state = await snapshot();
  assert.deepEqual(state.roles.map(r => r.name), ['Администратор','Директор','Молодость','Бухгалтер']);
  assert.equal(state.users.find(u => u.id === 3).roleIds[0], state.roles[0].id, 'Legacy admin migrated once');
  assert.ok((await json('/api/admin/dashboard', legacy)).privileges.includes('access.manage'));
  assert.equal((await req('/api/admin/access')).status, 401);
  assert.equal((await req('/management', member)).status, 307);
  assert.equal((await req('/api/admin/dashboard', member)).status, 403);
  const adminRole = state.roles.find(r => r.administrator), accountant = state.roles.find(r => r.name === 'Бухгалтер'), youth = state.roles.find(r => r.name === 'Молодость');
  async function assign(id, roles, cookie = admin) {
    const s = await json('/api/admin/access', cookie); const u = s.users.find(u => u.id === id);
    return json(`/api/admin/access/users/${id}`, cookie, 'PATCH', { roleIds: roles, revision: u.revision });
  }
  async function update(id, change) {
    const s = await snapshot(); const role = s.roles.find(r => r.id === id);
    return json(`/api/admin/access/roles/${id}`, admin, 'PATCH', { ...role, ...change });
  }
  await assign(1, [accountant.id]);
  assert.equal((await req('/management', member)).status, 200, 'Existing session gains panel access');
  assert.equal((await json('/api/auth/session', member)).user.role, 'management');
  assert.ok((await req('/', member)).ok);
  let dashboard = await json('/api/admin/dashboard', member);
  assert.deepEqual(dashboard.privileges, ['panel.access']);
  assert.deepEqual(dashboard.applications, []); assert.deepEqual(dashboard.organizations, []); assert.deepEqual(dashboard.specialties, []);
  assert.equal((await req('/api/attachments/1', member)).status, 404, 'Panel access cannot read other organization attachment');
  assert.equal((await req('/api/attachments/1', other)).status, 200, 'Owner still can read attachment');
  assert.equal((await req('/api/applications', member)).status, 200, 'Role does not remove own cabinet');
  for (const [path, method] of forbiddenRoutes) assert.equal((await req(path, member, method, method === 'GET' ? undefined : {})).status, 403, path);
  await assign(1, [accountant.id, youth.id]);
  assert.equal((await req('/api/admin/projects', member)).status, 200);
  const photoForm = new FormData();
  photoForm.set('file', new Blob([await readFile('public/gutv-logo.png')], { type: 'image/png' }), 'project.png');
  const photoUpload = await fetch(base + '/api/admin/projects/photos', { method: 'POST', headers: { cookie: member, origin: base }, body: photoForm });
  assert.equal(photoUpload.status, 200, 'Project editor can upload project photos without leadership privilege');
  assert.ok((await photoUpload.json()).photoUrl);
  assert.equal((await req('/api/admin/leadership/photos', member, 'POST', {})).status, 403, 'Project photo permission does not grant leadership uploads');
  assert.equal((await req('/api/admin/leadership', member)).status, 403);
  await update(youth.id, { name: 'Редакция', privileges: ['projects.manage', 'leadership.manage'] });
  assert.equal((await req('/api/admin/leadership', member)).status, 200, 'Privileges combine across roles');
  const position = await json('/api/admin/leadership/positions', member, 'POST', { title: 'Тестовая должность' });
  assert.ok(position);
  const positionId = position.positions.find(p => p.title === 'Тестовая должность').id;
  await json(`/api/admin/leadership/positions/${positionId}`, member, 'PATCH', { title: 'Д'.repeat(100) });
  for (const title of ['Д'.repeat(101), 'Должность' + ' '.repeat(100)]) {
    assert.equal((await req('/api/admin/leadership/positions', member, 'POST', { title })).status, 400);
    assert.equal((await req(`/api/admin/leadership/positions/${positionId}`, member, 'PATCH', { title })).status, 400);
  }
  const personDraft = { name: 'И'.repeat(120), description: 'Я'.repeat(600), photoUrl: '', photoPosition: 'center center' };
  let roster = await json('/api/admin/leadership/people', member, 'POST', personDraft);
  const personId = roster.people.find(p => p.name === personDraft.name).id;
  for (const invalid of [{ name: 'И'.repeat(121) }, { description: 'Я'.repeat(601) }, { description: ' '.repeat(601) }, { description: 600 }]) {
    assert.equal((await req('/api/admin/leadership/people', member, 'POST', { ...personDraft, ...invalid })).status, 400);
    assert.equal((await req(`/api/admin/leadership/people/${personId}`, member, 'PATCH', invalid)).status, 400);
  }
  roster = await json('/api/admin/leadership', member);
  assert.equal(roster.positions.find(p => p.id === positionId).title, 'Д'.repeat(100), 'Overlimit title cannot overwrite the saved position');
  assert.equal(roster.people.find(p => p.id === personId).description, personDraft.description, 'Overlimit description cannot silently clear saved text');
  roster = await json(`/api/admin/leadership/people/${personId}`, member, 'PATCH', { description: '' });
  assert.equal(roster.people.find(p => p.id === personId).description, '', 'Explicitly clearing an optional description remains supported');
  await assign(1, [youth.id]);
  assert.equal((await req('/api/admin/projects', member)).status, 403, 'Panel permission is mandatory');
  await assign(1, [accountant.id]);
  assert.equal((await req('/api/admin/projects', member)).status, 403, 'Same-session revocation');
  assert.equal((await req('/api/admin/access/roles', admin, 'POST', { name: 'Бухгалтер', privileges: [] })).status, 409);
  assert.equal((await req('/api/admin/access/roles', admin, 'POST', { name: 'Неизвестные права', privileges: ['invented'] })).status, 400);
  for (const invalid of [{ name: 'Р'.repeat(81) }, { name: 'Роль' + ' '.repeat(80) }, { name: 'Роль', description: 'Я'.repeat(501) }, { name: 'Роль', description: ' '.repeat(501) }]) {
    assert.equal((await req('/api/admin/access/roles', admin, 'POST', { privileges: [], ...invalid })).status, 400);
    const currentRole = (await snapshot()).roles.find(r => r.id === accountant.id);
    assert.equal((await req(`/api/admin/access/roles/${accountant.id}`, admin, 'PATCH', { ...currentRole, ...invalid })).status, 400);
    assert.deepEqual((await snapshot()).roles.find(r => r.id === accountant.id), currentRole, 'Invalid role text must not mutate data or revision');
  }
  await update(accountant.id, { name: 'Р'.repeat(80), description: 'Я'.repeat(500) });
  await update(accountant.id, { name: accountant.name, description: accountant.description });
  assert.equal((await req('/api/admin/access/roles', admin, 'POST', { name: 'Bad origin', privileges: [] }, 'https://evil.example')).status, 403);
  assert.equal((await req('/api/admin/access/users/0', admin, 'PATCH', { roleIds: [], revision: 1 })).status, 409);
  assert.equal((await req(`/api/admin/access/roles/${adminRole.id}`, admin, 'PATCH', { ...adminRole, privileges: [] })).status, 400);
  assert.equal((await req(`/api/admin/access/roles/${adminRole.id}`, admin, 'DELETE', { revision: adminRole.revision })).status, 409);
  assert.equal((await req(`/api/admin/access/roles/${accountant.id}`, admin, 'DELETE', { revision: accountant.revision })).status, 409);
  const oldUser = (await snapshot()).users.find(u => u.id === 1);
  await assign(1, [accountant.id]);
  assert.equal((await req('/api/admin/access/users/1', admin, 'PATCH', { roleIds: [], revision: oldUser.revision })).status, 409, 'Concurrent updates do not overwrite');
  const newRole = await json('/api/admin/access/roles', admin, 'POST', { name: 'Управление доступом', description: 'Доверенная роль', privileges: ['panel.access', 'access.manage'] });
  await assign(1, [newRole.id]);
  await assign(2, [adminRole.id], member);
  assert.equal((await req('/api/admin/access', other)).status, 200, 'Delegated administrator can manage access');
  assert.equal((await json('/api/admin/dashboard', other)).applications.length, 1);
  await assign(1, [], other);
  assert.equal((await req('/api/admin/access', member)).status, 403);
  await assign(2, []);
  assert.equal((await req('/api/admin/access', other)).status, 403);
  let role = (await snapshot()).roles.find(r => r.id === newRole.id);
  await json(`/api/admin/access/roles/${newRole.id}`, admin, 'DELETE', { revision: role.revision });
  await update(adminRole.id, { name: 'Главный администратор' });
  await assign(1, [accountant.id]);
  const before = await snapshot();
  await stop(); await start();
  assert.deepEqual(await snapshot(), before, 'Roles and assignments persist, seeds do not overwrite edits');
  assert.equal((await req('/api/admin/dashboard', member)).status, 200, 'Session survives restart');
  db.prepare("UPDATE portal_accounts SET status = 'blocked' WHERE id = 1").run();
  assert.equal((await req('/api/admin/dashboard', member)).status, 401, 'Roles do not bypass account block');
  db.prepare("UPDATE portal_accounts SET status = 'active' WHERE id = 1").run();
  db.prepare('UPDATE portal_account_access SET admin_access_blocked = 1 WHERE account_id = 1').run();
  assert.equal((await req('/api/admin/dashboard', member)).status, 401, 'Roles do not bypass central block');
  db.prepare('UPDATE portal_account_access SET admin_access_blocked = 0 WHERE account_id = 1').run();
  assert.deepEqual(db.prepare('SELECT DISTINCT action FROM portal_access_audit ORDER BY action').all().map(r => r.action), ['role.create', 'role.delete', 'role.update', 'user.roles']);
  assert.ok(db.prepare('SELECT id FROM portal_access_audit WHERE actor_id = 1').get(), 'Delegated changes audited');
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  console.log('PASS access integration: migration, role CRUD, assignment, delegation, revocation, API matrix, attachment isolation, blocked accounts, concurrency, restart persistence');
  if (process.env.GUTV_ACCESS_BROWSER_MODULE) {
    await update(adminRole.id, { name: 'Администратор' });
    await update(youth.id, { name: 'Молодость', privileges: ['panel.access', 'projects.manage'] });
    const { runBrowserChecks } = await import(process.env.GUTV_ACCESS_BROWSER_MODULE);
    await runBrowserChecks({ base, adminCookie: admin, memberCookie: member, output: process.env.GUTV_ACCESS_OUTPUT || work });
  }
} catch (error) { console.error(logs.slice(-1800)); throw error; }
finally { await stop(); db?.close(); await rm(work, { recursive: true, force: true }); }
