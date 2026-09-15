#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { applyMigrationPlan, migrateImages, prepareMigration, validateAssetMap } from './migrate-images-webp.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'gutv-image-migration-'));
const mapping = { '/media/portrait.jpg': '/media/portrait.webp', '/media/on-set.png': '/media/on-set.webp' };
const mapPath = join(temporary, 'assets.json');
const sources = {
  jpeg: await sharp({ create: { width: 12, height: 8, channels: 3, background: '#ff0033' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
  png: await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 15, g: 120, b: 210, alpha: 0.5 } } }).png().toBuffer(),
  webp: await sharp({ create: { width: 7, height: 9, channels: 3, background: '#ddaa33' } }).webp().toBuffer(),
};
const tableNames = ['portal_leadership_photos', 'portal_leadership_people', 'portal_studio_projects', 'portal_vk_posts', 'portal_applications', 'portal_sessions'];
let fixtures = 0;
function fixture() {
  const path = join(temporary, `fixture-${++fixtures}.sqlite`);
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE portal_leadership_photos (
      id INTEGER PRIMARY KEY, mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
      bytes BLOB NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880), created_at TEXT NOT NULL
    );
    CREATE TABLE portal_leadership_people (id INTEGER PRIMARY KEY, name TEXT, photo_url TEXT, photo_position TEXT, photo_scale REAL, updated_at TEXT);
    CREATE TABLE portal_studio_projects (id INTEGER PRIMARY KEY, content TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE portal_vk_posts (id INTEGER PRIMARY KEY, image_url TEXT NOT NULL, text TEXT, updated_at TEXT);
    CREATE TABLE portal_applications (id INTEGER PRIMARY KEY, request_text TEXT NOT NULL);
    CREATE TABLE portal_sessions (id INTEGER PRIMARY KEY, token TEXT NOT NULL);
  `);
  for (const [index, [extension, bytes]] of Object.entries(sources).entries()) db.prepare('INSERT INTO portal_leadership_photos VALUES (?, ?, ?, ?, ?)').run(index + 1, `image/${extension}`, bytes, bytes.length, '2026-01-01');
  const person = db.prepare('INSERT INTO portal_leadership_people VALUES (?, ?, ?, ?, ?, ?)');
  person.run(1, 'Local photo', '/media/portrait.jpg', '37% 62%', 1.75, '2026-01-01');
  person.run(2, 'Remote photo', 'https://example.com/media/portrait.jpg', 'center top', 0.5, '2026-01-02');
  person.run(3, 'Uploaded photo', '/api/leadership/photos/1', 'left bottom', 2.25, '2026-01-03');
  person.run(4, 'Different exact URL', '/media/portrait.jpg?v=1', 'center center', 1, '2026-01-04');
  db.prepare('INSERT INTO portal_studio_projects VALUES (?, ?, ?)').run(1, JSON.stringify({ title: 'Project', photoUrl: '/media/on-set.png', photoScale: 0.75, photoPosition: '11% 22%', tone: 'blue', url: 'https://example.com/media/on-set.png', extra: { retained: true } }), 4);
  db.prepare('INSERT INTO portal_studio_projects VALUES (?, ?, ?)').run(2, JSON.stringify({ photoUrl: 'https://example.com/media/on-set.png', photoScale: 1.5 }), 5);
  db.prepare('INSERT INTO portal_vk_posts VALUES (?, ?, ?, ?)').run(1, '/media/portrait.jpg', 'Unchanged text', '2026-01-01');
  db.prepare('INSERT INTO portal_vk_posts VALUES (?, ?, ?, ?)').run(2, 'https://example.com/media/portrait.jpg', 'Remote text', '2026-01-02');
  db.prepare('INSERT INTO portal_applications VALUES (1, ?)').run('Unrelated request including /media/portrait.jpg');
  db.prepare('INSERT INTO portal_sessions VALUES (1, ?)').run('fixture-token');
  return { db, path };
}
function snapshot(db) {
  return Object.fromEntries(tableNames.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row => {
    const result = { ...row };
    if (row.bytes) result.bytes = Buffer.from(row.bytes).toString('base64');
    return result;
  })]));
}
function photos(db) {
  return db.prepare('SELECT * FROM portal_leadership_photos ORDER BY id').all();
}

try {
  await writeFile(mapPath, JSON.stringify(mapping));
  const normal = fixture();
  try {
    const before = snapshot(normal.db);
    const dryRun = await migrateImages({ databasePath: normal.path, mapPath });
    assert.equal(dryRun.mode, 'dry-run');
    assert.equal(dryRun.backupCreated, false);
    assert.equal(dryRun.convertedPhotos, 2);
    assert.equal(dryRun.alreadyWebpPhotos, 1);
    assert.deepEqual(dryRun.updatedReferences, { leadershipPeople: 1, studioProjects: 1, vkPosts: 1 });
    assert.deepEqual(snapshot(normal.db), before, 'Dry run must not mutate anything');

    const backupPath = join(temporary, 'original.sqlite');
    const applied = await migrateImages({ databasePath: normal.path, mapPath, apply: true, backupPath });
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.backupCreated, true);
    const saved = new DatabaseSync(backupPath, { readOnly: true });
    try { assert.deepEqual(snapshot(saved), before, 'SQLite backup must retain originals and unrelated data including WAL contents'); }
    finally { saved.close(); }
    const after = snapshot(normal.db);
    const converted = photos(normal.db);
    for (const row of converted) {
      assert.equal(row.mime_type, 'image/webp');
      assert.equal(row.size_bytes, row.bytes.length);
      assert.equal((await sharp(row.bytes).metadata()).format, 'webp');
      assert.equal(row.created_at, '2026-01-01');
    }
    const portraitMetadata = await sharp(converted[0].bytes).metadata();
    assert.equal(portraitMetadata.width, 8, 'EXIF orientation must be applied to pixels');
    assert.equal(portraitMetadata.height, 12);
    assert.equal(portraitMetadata.orientation, undefined);
    assert.equal((await sharp(converted[1].bytes).metadata()).hasAlpha, true, 'Transparency must survive conversion');
    assert.deepEqual(Buffer.from(converted[2].bytes), sources.webp, 'Already-WebP photo must remain byte-for-byte identical');
    assert.deepEqual(after.portal_leadership_people, before.portal_leadership_people.map(row => row.id === 1 ? { ...row, photo_url: '/media/portrait.webp' } : row));
    assert.deepEqual(after.portal_vk_posts, before.portal_vk_posts.map(row => row.id === 1 ? { ...row, image_url: '/media/portrait.webp' } : row));
    const originalProject = JSON.parse(before.portal_studio_projects[0].content);
    assert.deepEqual(JSON.parse(after.portal_studio_projects[0].content), { ...originalProject, photoUrl: '/media/on-set.webp' });
    assert.equal(after.portal_studio_projects[0].sort_order, 4);
    assert.deepEqual(after.portal_studio_projects[1], before.portal_studio_projects[1]);
    assert.deepEqual(after.portal_applications, before.portal_applications);
    assert.deepEqual(after.portal_sessions, before.portal_sessions);
    const rerun = await migrateImages({ databasePath: normal.path, mapPath, apply: true, backupPath: join(temporary, 'rerun.sqlite') });
    assert.equal(rerun.convertedPhotos, 0);
    assert.equal(rerun.alreadyWebpPhotos, 3);
    assert.deepEqual(rerun.updatedReferences, { leadershipPeople: 0, studioProjects: 0, vkPosts: 0 });
    assert.deepEqual(snapshot(normal.db), after, 'Second apply must not change the result');
    const savedBytes = await readFile(backupPath);
    await assert.rejects(migrateImages({ databasePath: normal.path, mapPath, apply: true, backupPath }), /EEXIST/);
    assert.deepEqual(await readFile(backupPath), savedBytes, 'An existing backup must never be overwritten');
    assert.deepEqual(snapshot(normal.db), after);
    await assert.rejects(migrateImages({ databasePath: normal.path, apply: true }), /--backup/);
  } finally { normal.db.close(); }

  const broken = fixture();
  try {
    broken.db.prepare('UPDATE portal_leadership_photos SET bytes = ?, size_bytes = ? WHERE id = 2').run(Buffer.from('invalid'), 7);
    const before = snapshot(broken.db);
    await assert.rejects(migrateImages({ databasePath: broken.path, mapPath, apply: true, backupPath: join(temporary, 'broken.sqlite') }), /could not be decoded/);
    assert.deepEqual(snapshot(broken.db), before, 'Decoder failure after a valid image must leave the database untouched');
  } finally { broken.db.close(); }

  const concurrent = fixture();
  try {
    const plan = await prepareMigration(concurrent.db, validateAssetMap(mapping));
    const writer = new DatabaseSync(concurrent.path);
    try {
      const project = JSON.parse(writer.prepare('SELECT content FROM portal_studio_projects WHERE id = 1').get().content);
      writer.prepare('UPDATE portal_studio_projects SET content = ? WHERE id = 1').run(JSON.stringify({ ...project, photoScale: 2.5 }));
    } finally { writer.close(); }
    const updated = snapshot(concurrent.db);
    assert.throws(() => applyMigrationPlan(concurrent.db, plan), /changed during preparation/);
    assert.deepEqual(snapshot(concurrent.db), updated, 'A concurrent crop edit must cause rollback of earlier image and URL updates');
    const secondPlan = await prepareMigration(concurrent.db, validateAssetMap(mapping));
    concurrent.db.prepare('UPDATE portal_leadership_photos SET bytes = ?, size_bytes = ? WHERE id = 2').run(sources.jpeg, sources.jpeg.length);
    const changedPhoto = snapshot(concurrent.db);
    assert.throws(() => applyMigrationPlan(concurrent.db, secondPlan), /changed during preparation/);
    assert.deepEqual(snapshot(concurrent.db), changedPhoto, 'Concurrent bytes changes must be preserved and earlier conversions rolled back');
  } finally { concurrent.db.close(); }

  const missing = new DatabaseSync(join(temporary, 'empty.sqlite'));
  try {
    const plan = await prepareMigration(missing, validateAssetMap(mapping));
    applyMigrationPlan(missing, plan);
    assert.equal(plan.summary.convertedPhotos, 0);
  } finally { missing.close(); }
  assert.throws(() => validateAssetMap({ 'https://example.com/photo.jpg': '/photo.webp' }), /local absolute/);
  assert.throws(() => validateAssetMap({ '/photo.jpg': '//example.com/photo.webp' }), /local absolute/);
  assert.throws(() => validateAssetMap({ '/photo.jpg': '/nested/../photo.webp' }), /local absolute/);
  assert.throws(() => validateAssetMap({ '/photo.jpg': '/photo.webp', '/photo.webp': '/next.webp' }), /chained/);
  const cli = spawnSync(process.execPath, ['scripts/migrate-images-webp.mjs', '--apply'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /--database is required/);
  console.log('Image migration tests passed: dry run, conversion/orientation/alpha, backup, exact references, idempotency, error safety, atomic rollback, concurrent edits, unchanged application/session data.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
