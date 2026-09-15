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
const productionBuild = process.env.GUTV_TEST_PRODUCTION !== '0';
const root = await mkdtemp(join(tmpdir(), 'gutv-projects-test-'));
const databasePath = join(root, 'portal.sqlite');
const secret = Buffer.from('leadership-test-only-secret-32bytes').toString('base64url');
let child, base, logs = '';
function token(role = 'management', accountId = 0) {
  const data = { accountId, role, organizationId: role === 'requester' ? 1 : null, username: role === 'requester' ? 'requester-test' : 'studio', displayName: 'Integration', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
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
  return fetch(base + '/api/admin/projects' + path, { method, headers, ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
}
async function ok(path = '', method = 'GET', body) {
  const r = await request(path, method, body); const data = await r.json();
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${JSON.stringify(data)}`); return data;
}
async function rejected(path, method, body) { const r = await request(path, method, body); assert.ok(r.status >= 400 && r.status < 500, `${method} ${path} unexpectedly ${r.status}`); }
try {
  await cp(source, root, { recursive: true, filter: p => !['node_modules', '.next', '.git'].includes(relative(source, p).split('/')[0]) });
  if (productionBuild) await cp(join(source, '.next'), join(root, '.next'), { recursive: true });
  await symlink(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
  await start();
  assert.equal((await request('', 'GET', undefined, '')).status, 401);
  const db = new DatabaseSync(databasePath);
  db.exec("INSERT INTO portal_organizations (id,type,name,representative_name,contact,status) VALUES (1,'organization','Test organization','Test person','test@example.com','active'); INSERT INTO portal_accounts (id,username,password_hash,role,status,organization_id,display_name) VALUES (1,'requester-test','unused','requester','active',1,'Test requester');"); db.close();
  assert.equal((await request('', 'GET', undefined, token('requester',1))).status, 403);
  const initial = (await ok()).projects; assert.equal(initial.length, 3);
  const draft = Object.fromEntries(Object.entries(initial[0]).filter(([key]) => key !== 'id' && key !== 'sortOrder'));
  const legacySaved = await ok(`/${initial[0].id}`, 'PATCH', { ...draft, photoUrl: '/media/on-set.jpg' });
  assert.equal(legacySaved.projects.find(project => project.id === initial[0].id).photoUrl, '/media/on-set.webp', 'Old editor photo URLs must be normalized when saved');
  assert.equal((await request('', 'POST', draft, token(), 'https://untrusted.example')).status, 403);
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'not a url']) await rejected('', 'POST', { ...draft, url });
  await rejected('', 'POST', { ...draft, photoScale: .1 });
  await rejected('', 'POST', { ...draft, photoUrl: 'https://example.com/private.png' });
  const projectImage = await sharp({ create: { width: 48, height: 24, channels: 4, background: { r: 20, g: 65, b: 110, alpha: .5 } } }).png().toBuffer();
  const form = new FormData(); form.set('file', new File([projectImage], 'photo.png', { type: 'image/png' }));
  const uploaded = await ok('/photos','POST', form); assert.match(uploaded.photoUrl, /^\/api\/leadership\/photos\/\d+$/);
  const photo = await fetch(base + uploaded.photoUrl); assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/webp');
  const photoBytes = Buffer.from(await photo.arrayBuffer()); assert.equal(Number(photo.headers.get('content-length')), photoBytes.length);
  const photoMetadata = await sharp(photoBytes).metadata(); assert.equal(photoMetadata.format, 'webp'); assert.equal(photoMetadata.width, 48); assert.equal(photoMetadata.height, 24);
  assert.deepEqual(await sharp(photoBytes).extractChannel('alpha').raw().toBuffer(), await sharp(projectImage).extractChannel('alpha').raw().toBuffer());
  const created = (await ok('', 'POST', { ...draft, title: 'Тестовый проект', photoUrl: uploaded.photoUrl, photoScale: .5, photoPosition: '30% 10%' })).projects.at(-1);
  assert.equal(created.photoScale, .5);
  await ok(`/${created.id}`, 'PATCH', { ...draft, title: 'Изменённый проект', photoUrl: uploaded.photoUrl, photoScale: .25, tone: 'light' });
  const ids = [...initial.map(p=>p.id), created.id].reverse();
  assert.deepEqual((await ok('/order', 'PUT', { ids })).projects.map(p=>p.id), ids);
  await rejected('/order', 'PUT', { ids: [ids[0],ids[0],...ids.slice(2)] });
  await rejected('/order', 'PUT', { ids: [99999,...ids.slice(1)] });
  assert.deepEqual((await ok()).projects.map(p=>p.id), ids);
  assert.ok((await (await fetch(base+'/studio')).text()).includes('Изменённый проект'));
  await stop(); await start(); assert.deepEqual((await ok()).projects.map(p=>p.id), ids);
  for (const id of ids) await ok(`/${id}`, 'DELETE');
  assert.equal((await ok()).projects.length,0);
  await stop(); await start(); assert.equal((await ok()).projects.length,0,'Empty collection stays empty');
  console.log('PASS: projects CRUD, upload, original photo scale, order, persistence, public rendering and access controls');
} catch(error) { console.error(logs.slice(-1800)); throw error; }
finally { await stop(); await rm(root, { recursive: true, force: true }); }
