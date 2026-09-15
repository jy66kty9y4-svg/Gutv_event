#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { spawn } from 'node:child_process';

const source = process.cwd();
const productionBuild = true;
const root = await mkdtemp(join(tmpdir(), 'gutv-leadership-test-'));
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

try {
  await cp(source, root, { recursive: true, filter: p => !['node_modules', '.next', '.git'].includes(relative(source, p).split('/')[0]) });
  await cp(join(source, '.next'), join(root, '.next'), { recursive: true });
  await symlink(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
  await start();
  const cookie = token();
  const header = async (path, value = '') => {
    const r = await fetch(base+path, {headers:value ? {cookie:`gutv_session=${value}`} : {}});
    assert.equal(r.status,200); const html=await r.text();
    return html.match(/<header\b[\s\S]*?<\/header>/)?.[0] || '';
  };
  for (const path of ['/','/studio','/directions']) {
    const guest = await header(path); assert.ok(guest.includes('Войти') && guest.includes('Регистрация'));
    const user = await header(path,cookie); assert.ok(user.includes('Личный кабинет')); assert.ok(!user.includes('Войти') && !user.includes('Регистрация'));
    if(path!=='/') assert.ok(user.includes('href="/management"'));
    assert.ok((await header(path)).includes('Войти'),'Private header must not leak through cache');
  }
  const db = new DatabaseSync(databasePath);
  db.exec("INSERT INTO portal_organizations (id,type,name,representative_name,contact,status) VALUES (1,'organization','Test organization','Test person','test@example.com','active'); INSERT INTO portal_accounts (id,username,password_hash,role,status,organization_id,display_name) VALUES (1,'requester-test','unused','requester','active',1,'Test requester');");
  for (const path of ['/studio','/directions']) {
    const html=await header(path,token('requester',1)); assert.ok(html.includes('href="/cabinet"') && html.includes('/cabinet?new=1'));
  }
  const logout = await fetch(base+'/api/auth/logout',{method:'POST',headers:{origin:base,cookie:`gutv_session=${cookie}`}}); assert.ok(logout.ok);
  for(const path of ['/','/studio','/directions']) assert.ok((await header(path,cookie)).includes('Войти'),'Revoked sessions must be anonymous');
  db.close();
  console.log('PASS: authenticated/guest headers on all public pages, role destinations, no cached session leak, logout revocation');
} catch(error) { console.error(logs.slice(-1800)); throw error; }
finally { await stop(); await rm(root, { recursive: true, force: true }); }
