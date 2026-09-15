#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const source = process.cwd();
const productionBuild = process.env.GUTV_TEST_PRODUCTION === '1';
const root = await mkdtemp(join(tmpdir(), 'gutv-leadership-test-'));
const databasePath = join(root, 'portal.sqlite');
const secret = Buffer.from('leadership-test-only-secret-32bytes').toString('base64url');
let child, base, logs = '';
function token(role = 'management', accountId = 0, username = role === 'requester' ? 'requester-test' : 'studio') {
  const data = { accountId, role, organizationId: role === 'requester' ? 1 : null, username, displayName: 'Integration', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const body = `v2.${Buffer.from(JSON.stringify(data)).toString('base64url')}`;
  return `${body}.${createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url')}`;
}
async function port() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
async function start() {
  const p = await port(); base = `http://127.0.0.1:${p}`;
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...(productionBuild ? ['start'] : ['dev', '--webpack']), '--hostname', '127.0.0.1', '--port', String(p)], { cwd: root, env: { ...process.env, GUTV_DATABASE_PATH: databasePath, GUTV_SESSION_SECRET: secret, GUTV_VK_CONFIRMATION_CODE: 'local-test-only', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', x => { logs += x; }); child.stderr.on('data', x => { logs += x; });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(base + '/studio')).ok) return; } catch {}
    if (child.exitCode !== null) throw new Error('Local server stopped: ' + logs.slice(-3000));
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Server readiness timeout: ' + logs.slice(-3000));
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const c = child;
  await new Promise(resolve => { const timer = setTimeout(() => { c.kill('SIGKILL'); }, 5000); c.once('exit', () => { clearTimeout(timer); resolve(); }); c.kill('SIGTERM'); });
}
async function request(path = '', method = 'GET', body, cookie = token(), origin = base) {
  const headers = { ...(cookie ? { cookie: `gutv_session=${cookie}` } : {}), ...(method !== 'GET' ? { origin } : {}) };
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  return fetch(base + '/api/admin/leadership' + path, { method, headers, ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
}
async function ok(path = '', method = 'GET', body) {
  const r = await request(path, method, body); const data = await r.json();
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${JSON.stringify(data)}`); return data;
}
async function rejected(path, method, body) { const r = await request(path, method, body); assert.ok(r.status >= 400 && r.status < 500, `${method} ${path} unexpectedly ${r.status}`); }
async function uploadPhoto(bytes, type, name, width, height) {
  const form = new FormData(); form.append('file', new Blob([bytes], { type }), name);
  const upload = await ok('/photos', 'POST', form);
  assert.match(upload.photoUrl, /^\/api\/leadership\/photos\/\d+$/);
  const photo = await fetch(base + upload.photoUrl);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/webp');
  assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
  const output = Buffer.from(await photo.arrayBuffer());
  assert.equal(Number(photo.headers.get('content-length')), output.length);
  assert.equal(output.toString('ascii', 0, 4), 'RIFF');
  assert.equal(output.toString('ascii', 8, 12), 'WEBP');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, width); assert.equal(metadata.height, height);
  assert.equal(metadata.orientation, undefined, 'EXIF orientation must be applied to pixels');
  assert.equal(metadata.exif, undefined, 'Uploaded camera metadata must not be retained');
  const db = new DatabaseSync(databasePath);
  try {
    const row = db.prepare('SELECT mime_type, bytes, size_bytes FROM portal_leadership_photos WHERE id = ?').get(Number(upload.photoUrl.split('/').at(-1)));
    assert.equal(row.mime_type, 'image/webp'); assert.equal(row.size_bytes, output.length);
    assert.deepEqual(Buffer.from(row.bytes), output, 'Database must store the converted photo');
  } finally { db.close(); }
  return { ...upload, output };
}
const titles = ['Директор', 'Заместитель директора', 'Технический директор', 'Шеф-редактор', 'Заместитель по внешним связям', 'Видео-контент на концертах'];
try {
  await cp(source, root, { recursive: true, filter: p => !['node_modules', '.next', '.git'].includes(relative(source, p).split('/')[0]) });
  if (productionBuild) await cp(join(source, '.next'), join(root, '.next'), { recursive: true });
  await symlink(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE test_existing_data (value TEXT NOT NULL);
    INSERT INTO test_existing_data VALUES ('preserved');
    CREATE TABLE portal_leadership_people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
      photo_url TEXT NOT NULL DEFAULT '',
      photo_position TEXT NOT NULL DEFAULT 'center top',
      photo_scale REAL NOT NULL DEFAULT 1 CHECK (photo_scale >= 1 AND photo_scale <= 3),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE portal_leadership_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
      person_id INTEGER REFERENCES portal_leadership_people(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (sort_order)
    );
    CREATE TABLE portal_leadership_seed_state (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO portal_leadership_people (id, name, photo_url, photo_position) VALUES
      (1, 'Адельшин Джемильхан', '/media/leadership/adelshin-dzhemilkhan.jpg', 'center center'),
      (2, 'Харитонов Никита', '/media/leadership/kharitonov-nikita.jpg', 'center center'),
      (3, 'Семенов Семён', '/media/leadership/semenov-semyon.png', 'center top');
    UPDATE portal_leadership_people SET photo_scale = 1.25 WHERE id = 1;
    INSERT INTO portal_leadership_positions (title, person_id, sort_order) VALUES
      ('Директор', 1, 1), ('Заместитель директора', NULL, 2), ('Технический директор', NULL, 3),
      ('Шеф-редактор', NULL, 4), ('Заместитель по внешним связям', 3, 5), ('Видео-контент на концертах', 2, 6);
    INSERT INTO portal_leadership_seed_state (version) VALUES ('workbook-2026-09-05-v1');
  `);
  legacy.close();
  await start();
  assert.equal((await request('', 'GET', undefined, '')).status, 401);
  const db = new DatabaseSync(databasePath);
  db.exec("INSERT INTO portal_organizations (id,type,name,representative_name,contact,status) VALUES (1,'organization','Test organization','Test person','test@example.com','active'); INSERT INTO portal_accounts (id,username,password_hash,role,status,organization_id,display_name) VALUES (1,'requester-test','unused','requester','active',1,'Test requester');");
  assert.equal((await request('', 'GET', undefined, token('requester', 1))).status, 403);
  assert.equal((await request('/positions', 'POST', { title: 'Не сохранять' }, token(), 'https://untrusted.example')).status, 403);
  assert.ok(db.prepare('PRAGMA table_info(portal_leadership_people)').all().some(column => column.name === 'photo_scale'), 'Legacy SQLite schema must gain photo_scale');
  assert.deepEqual(db.prepare('SELECT photo_position, photo_scale FROM portal_leadership_people ORDER BY id').all().map(row => ({ ...row })), [
    { photo_position: 'center center', photo_scale: 1.25 },
    { photo_position: 'center center', photo_scale: 1 },
    { photo_position: 'center top', photo_scale: 1 },
  ], 'Legacy positioning and people must survive migration');
  const blocked = db.prepare("INSERT INTO portal_accounts (username,password_hash,role,status,display_name) VALUES ('blocked-leadership-test','unused','management','blocked','Blocked test')").run();
  db.close();
  const blockedToken = token('management', Number(blocked.lastInsertRowid), 'blocked-leadership-test');
  assert.equal((await request('', 'GET', undefined, blockedToken)).status, 401);
  assert.equal((await request('/positions', 'POST', { title: 'Не сохранять' }, blockedToken)).status, 401);
  let roster = await ok();
  assert.deepEqual(roster.positions.map(p => p.title), titles);
  assert.deepEqual(roster.positions.map(p => p.personId), [1,null,null,null,3,2]);
  assert.equal(roster.people.length, 3);
  roster = await ok('/people/1', 'PATCH', { photoUrl: '/media/leadership/adelshin-dzhemilkhan.jpg' });
  assert.equal(roster.people.find(person => person.id === 1).photoUrl, '/media/leadership/adelshin-dzhemilkhan.webp', 'Old editor photo URLs must be normalized when saved');
  for (const p of roster.people) assert.ok((await fetch(base + p.photoUrl)).ok);
  let html = await (await fetch(base + '/studio')).text();
  assert.ok(html.includes('Адельшин Джемильхан') && html.includes('Харитонов Никита') && html.includes('Семенов Семён'));
  assert.ok(!html.includes('Djemil Gadji') && !html.includes('Алексей Малинин'));

  roster = await ok('/positions', 'POST', { title: 'Тестовая должность' });
  const position = roster.positions.find(p => p.title === 'Тестовая должность');
  assert.equal(position.personId, null);
  roster = await ok(`/positions/${position.id}`, 'PATCH', { title: 'Редактор материалов' });
  await rejected('/positions', 'POST', { title: '' });
  await rejected(`/positions/${position.id}`, 'PATCH', { personId: 999999 });
  await rejected(`/positions/${position.id}`, 'PATCH', { personId: true });
  await rejected(`/positions/${position.id}`, 'PATCH', { title: 'Не менять', personId: 999999 });
  assert.equal((await ok()).positions.find(p => p.id === position.id).title, 'Редактор материалов', 'Invalid patch must be atomic');

  const portrait = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#295485' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const upload = await uploadPhoto(portrait, 'image/jpeg', 'portrait.jpg', 32, 48);
  const transparent = await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 23, g: 78, b: 142, alpha: .35 } } }).png().toBuffer();
  const pngUpload = await uploadPhoto(transparent, 'image/png', 'transparent.png', 12, 8);
  assert.deepEqual(await sharp(pngUpload.output).extractChannel('alpha').raw().toBuffer(), await sharp(transparent).extractChannel('alpha').raw().toBuffer(), 'PNG transparency must survive conversion');
  const webp = await sharp({ create: { width: 19, height: 11, channels: 3, background: '#945333' } }).webp().toBuffer();
  await uploadPhoto(webp, 'image/webp', 'existing.webp', 19, 11);
  const deniedForm = new FormData(); deniedForm.append('file', new Blob([portrait], { type: 'image/jpeg' }), 'portrait.jpg');
  assert.equal((await request('/photos', 'POST', deniedForm, '')).status, 401);
  assert.equal((await request('/photos', 'POST', deniedForm, token('requester', 1))).status, 403);
  assert.equal((await request('/photos', 'POST', deniedForm, token(), 'https://untrusted.example')).status, 403);
  for (const [bytes, type, name] of [[Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml', 'x.svg'], [Buffer.from('RIFF1234WEBP'), 'image/webp', 'fake.webp'], [Buffer.from('not a photo'), 'image/png', 'fake.png']]) {
    const bad = new FormData(); bad.append('file', new Blob([bytes], { type }), name); await rejected('/photos', 'POST', bad);
  }
  const large = new FormData(); large.append('file', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), 'large.jpg'); await rejected('/photos', 'POST', large);
  const tooManyPixels = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#000000' } }).png().toBuffer();
  const oversized = new FormData(); oversized.append('file', new Blob([tooManyPixels], { type: 'image/png' }), 'oversized.png'); await rejected('/photos', 'POST', oversized);
  const corrupt = new FormData(); corrupt.append('file', new Blob([portrait.subarray(0, Math.floor(portrait.length / 2))], { type: 'image/jpeg' }), 'corrupt.jpg'); await rejected('/photos', 'POST', corrupt);
  const photoCount = new DatabaseSync(databasePath);
  assert.equal(photoCount.prepare('SELECT COUNT(*) AS count FROM portal_leadership_photos').get().count, 3, 'Rejected uploads must not create stored photos'); photoCount.close();
  await rejected('/people', 'POST', { name: 'Опасный URL', photoUrl: 'https://untrusted.example/photo.jpg' });
  await rejected('/people', 'POST', { name: 'Неизвестное фото', photoUrl: '/api/leadership/photos/999999' });
  roster = await ok('/people', 'POST', { name: 'Легаси человек', description: '', photoUrl: upload.photoUrl, photoPosition: 'center center' });
  const legacyPerson = roster.people.find(p => p.name === 'Легаси человек');
  assert.equal(legacyPerson.photoScale, 1, 'POST without photoScale must remain compatible and default to 1');
  roster = await ok('/people', 'POST', { name: 'Тестовый человек', description: '', photoUrl: upload.photoUrl, photoPosition: '37.5% 62.25%', photoScale: 1.75 });
  const person = roster.people.find(p => p.name === 'Тестовый человек');
  assert.equal(person.photoPosition, '37.5% 62.25%'); assert.equal(person.photoScale, 1.75);
  for (const photoPosition of ['37.5% 101%', '37.5 % 62%', 'center middle']) {
    await rejected('/people', 'POST', { name: 'Некорректная позиция', description: '', photoUrl: upload.photoUrl, photoPosition });
  }
  for (const photoScale of [0.24, 0, 3.01, '1.75']) {
    await rejected('/people', 'POST', { name: 'Некорректный масштаб', description: '', photoUrl: upload.photoUrl, photoPosition: 'center top', photoScale });
  }
  roster = await ok(`/positions/${position.id}`, 'PATCH', { personId: person.id });
  html = await (await fetch(base + '/studio')).text(); assert.ok(html.includes('Тестовый человек') && html.includes(upload.photoUrl));
  await rejected(`/people/${person.id}`, 'PATCH', { name: 'Не менять имя', photoUrl: 'javascript:alert(1)' });
  await rejected(`/people/${person.id}`, 'PATCH', { photoScale: 3.01 });
  assert.equal((await ok()).people.find(p => p.id === person.id).name, 'Тестовый человек', 'Invalid person patch must be atomic');
  roster = await ok(`/people/${person.id}`, 'PATCH', { name: 'Обновлённый человек', description: 'Описание после сохранения' });
  const updatedPerson = roster.people.find(p => p.id === person.id);
  assert.equal(updatedPerson.photoPosition, '37.5% 62.25%'); assert.equal(updatedPerson.photoScale, 1.75, 'PATCH without photoScale must preserve it');
  const ids = [position.id, ...roster.positions.filter(p => p.id !== position.id).map(p => p.id)];
  roster = await ok('/order', 'PUT', { ids }); assert.deepEqual(roster.positions.map(p => p.id), ids);
  await rejected('/order', 'PUT', { ids: ids.slice(1) });
  await rejected('/order', 'PUT', { ids: ids.map(() => ids[0]) });
  await rejected('/order', 'PUT', { ids: ids.map(String) });
  roster = await ok(`/people/${person.id}`, 'PATCH', { photoScale: 0.5 });
  assert.equal(roster.people.find(p => p.id === person.id).photoScale, 0.5);
  await stop(); await start();
  roster = await ok(); assert.deepEqual(roster.positions.map(p => p.id), ids);
  assert.equal(roster.people.find(p => p.id === person.id).name, 'Обновлённый человек');
  assert.equal(roster.people.find(p => p.id === person.id).photoPosition, '37.5% 62.25%');
  assert.equal(roster.people.find(p => p.id === person.id).photoScale, 0.5, 'Zoom below 100% survives restart');
  assert.equal((await fetch(base + upload.photoUrl)).status, 200, 'Uploaded photo survives restart');
  roster = await ok(`/people/${person.id}`, 'DELETE'); assert.equal(roster.positions.find(p => p.id === position.id).personId, null);
  roster = await ok(`/positions/${position.id}`, 'DELETE'); assert.equal(roster.positions.length, 6);
  for (const p of roster.positions) await ok(`/positions/${p.id}`, 'DELETE');
  for (const p of roster.people) await ok(`/people/${p.id}`, 'DELETE');
  await stop(); await start();
  roster = await ok(); assert.deepEqual(roster, { people: [], positions: [] }, 'Seed must not recreate deleted editorial data');
  const verify = new DatabaseSync(databasePath); assert.equal(verify.prepare('SELECT value FROM test_existing_data').get().value, 'preserved'); verify.close();
  console.log('PASS leadership: seed/order/vacancies, CRUD/assignments, JPEG/PNG/WebP conversion, EXIF rotation, transparency, invalid/pixel/size rejection, persistent photos, restart retention, no reseeding, validation/atomicity, management-only access and CSRF.');
} finally { await stop(); await rm(root, { recursive: true, force: true }); }
