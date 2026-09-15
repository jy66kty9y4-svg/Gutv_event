#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { spawn } from 'node:child_process';

const sourceRoot = process.cwd();
const groupId = 30973272;
const sessionSecret = 'vk-materials-focused-test';
const referenceCapture = 1_788_613_554;
const referenceIds = [6873, 6869, 6866, 6862, 6855];

function port() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForPage(url, child, serverLog) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (child.exitCode !== null) throw new Error(`Next dev stopped before test setup: ${lastError?.message || 'unknown error'}\n${serverLog().slice(-2_000)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

function callbackPayload(post) {
  const secret = createHash('sha256').update(`vk-callback-v1:${sessionSecret}`).digest('hex').slice(0, 48);
  return { type: 'wall_post_new', group_id: groupId, secret, object: { post } };
}

async function sendCallback(baseUrl, post) {
  const response = await fetch(`${baseUrl}/api/vk/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(callbackPayload(post)),
  });
  assert.equal(response.status, 200);
  return response.text();
}

const workingRoot = await mkdtemp(join(tmpdir(), 'gutv-vk-materials-'));
const databasePath = join(workingRoot, 'requests.sqlite');
let child;
let output = '';

try {
  await cp(sourceRoot, workingRoot, {
    recursive: true,
    filter: (source) => {
      const firstPart = relative(sourceRoot, source).split('/')[0];
      return firstPart !== 'node_modules' && firstPart !== '.next';
    },
  });
  await symlink(join(sourceRoot, 'node_modules'), join(workingRoot, 'node_modules'), 'dir');
  const seed = new DatabaseSync(databasePath);
  try {
    seed.exec(`
      CREATE TABLE portal_vk_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        published_at INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        href TEXT NOT NULL,
        image_url TEXT NOT NULL DEFAULT '',
        image_alt TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (group_id, post_id)
      );
    `);
    seed.prepare(`
      INSERT INTO portal_vk_posts (group_id, post_id, published_at, text, href)
      VALUES (?, ?, ?, ?, ?)
    `).run(groupId + 1, 700, 1_700_009_999, 'FOREIGN GROUP', 'https://vk.ru/wall-30973273_700');
    seed.prepare(`
      INSERT INTO portal_vk_posts (group_id, post_id, published_at, text, href)
      VALUES (?, ?, ?, ?, ?)
    `).run(groupId, 7999, referenceCapture - 1, 'UNKNOWN OLD', 'https://vk.ru/wall-30973272_7999');
  } finally {
    seed.close();
  }

  const testPort = await port();
  const baseUrl = `http://127.0.0.1:${testPort}`;
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--port', String(testPort)], {
    cwd: workingRoot,
    env: {
      ...process.env,
      GUTV_DATABASE_PATH: databasePath,
      GUTV_SESSION_SECRET: sessionSecret,
      GUTV_VK_GROUP_ID: String(groupId),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  await waitForPage(`${baseUrl}/studio`, child, () => output);
  const legacyMaterials = await fetch(`${baseUrl}/materials`, { redirect: 'manual' });
  assert.equal(legacyMaterials.status, 307, 'the old materials page must redirect to the studio feed');
  assert.equal(legacyMaterials.headers.get('location'), '/studio#latest-projects');

  const initialHtml = (await (await fetch(`${baseUrl}/studio`)).text()).replace(/<!--[^]*?-->/g, '');
  assert.equal((initialHtml.match(/<article class="vk-project-card"/g) || []).length, 5);
  for (const postId of referenceIds) assert.ok(initialHtml.includes(`https://vk.ru/wall-30973272_${postId}`), `reference post ${postId} must render without a database row`);
  assert.ok(!initialHtml.includes('UNKNOWN OLD'), 'an unknown database row older than the reference capture must not outrank confirmed posts');

  assert.equal(await sendCallback(baseUrl, {
    id: 7001,
    date: referenceCapture + 300,
    text: 'NEWER DATE CALLBACK',
  }), 'ok');
  assert.equal(await sendCallback(baseUrl, {
    id: 8000,
    date: referenceCapture + 200,
    text: 'HIGHER ID OLDER DATE',
  }), 'ok');
  assert.equal(await sendCallback(baseUrl, {
    id: 6869,
    date: referenceCapture - 100,
    text: 'REFERENCE ENRICHED',
  }), 'ok');
  const fallbackImageHtml = await (await fetch(`${baseUrl}/studio`)).text();
  assert.ok(fallbackImageHtml.includes('/media/vk-reference/6869.webp'), 'a known callback without an image must retain its reference screenshot');
  assert.equal(await sendCallback(baseUrl, {
    id: 6869,
    date: referenceCapture - 100,
    text: 'REFERENCE ENRICHED',
    attachments: [{ type: 'photo', photo: { text: 'Callback image', sizes: [{ url: 'https://images.example.test/callback-6869.jpg', width: 640, height: 480 }] } }],
  }), 'ok');

  const invalidGroup = callbackPayload({ id: 999, date: 1_700_000_999, text: 'WRONG GROUP' });
  invalidGroup.group_id = groupId + 1;
  const rejected = await fetch(`${baseUrl}/api/vk/callback`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(invalidGroup),
  });
  assert.equal(rejected.status, 403, 'callbacks from a different group must not enter this database');

  const html = await (await fetch(`${baseUrl}/studio`)).text();
  const visibleHtml = html.replace(/<!--[^]*?-->/g, '');
  assert.ok(visibleHtml.includes('id="latest-projects"'), 'the live feed must be embedded in Studio');
  assert.equal((html.match(/<article class="vk-project-card"/g) || []).length, 5);
  assert.ok(html.indexOf('NEWER DATE CALLBACK') < html.indexOf('HIGHER ID OLDER DATE'), 'new callback posts must sort by publication date before post ID');
  assert.ok(html.indexOf('HIGHER ID OLDER DATE') < html.indexOf('REFERENCE ENRICHED'), 'new callback posts must lead the confirmed snapshot');
  assert.ok(visibleHtml.includes('https://images.example.test/callback-6869.jpg'), 'a real callback image must replace the reference screenshot');
  assert.ok(!visibleHtml.includes('viewBox="0 129 1102 620"'), 'reference crop coordinates must not be applied to a real callback image');
  assert.equal((visibleHtml.match(/VK · ГУТВ/g) || []).length, 5);
  assert.ok(!visibleHtml.includes('АРХИВ · ГУТВ'));
  assert.ok(!visibleHtml.includes('FOREIGN GROUP'), 'posts from a different VK group must not leak after a group reconfiguration');
  assert.ok(!visibleHtml.includes('UNKNOWN OLD'), 'an old unknown row must not displace the confirmed snapshot');

  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  child = undefined;

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT count(1) AS count FROM portal_vk_posts WHERE group_id = ? AND post_id = 6869').get(groupId).count, 1, 'a known reference callback must use its existing post ID');
    assert.equal(database.prepare('SELECT text FROM portal_vk_posts WHERE post_id = 6869').get().text, 'REFERENCE ENRICHED');
  } finally {
    database.close();
  }

  console.log('Studio VK feed focused test passed: redirect, five references, new callback merge, reference deduplication, image fallback, and isolation.');
} finally {
  child?.kill('SIGTERM');
  await rm(workingRoot, { recursive: true, force: true });
}
