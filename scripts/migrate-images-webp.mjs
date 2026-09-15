#!/usr/bin/env node
// Usage: node scripts/migrate-images-webp.mjs --database /data/portal.sqlite \
//   --map scripts/webp-assets.json [--apply --backup /data/backups/images-UNIQUE.sqlite]
// The default is a read-only dry run. A successful apply retains every original in
// the SQLite backup, preserves photo IDs, and changes only image bytes and URLs.
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import sharp from 'sharp';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function validateAssetMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Asset map must be a JSON object');
  const mapping = new Map();
  for (const [from, to] of Object.entries(value)) {
    const localPath = path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
      && !/[\\?#\u0000-\u0020]/.test(path) && !path.split('/').some(part => part === '.' || part === '..');
    if (!localPath(from) || !localPath(to) || !/\.webp$/i.test(to)) throw new Error('Asset map must contain only local absolute paths targeting WebP');
    if (from !== to) mapping.set(from, to);
  }
  // A map must reach its final state in one pass, including when rerun later.
  for (const to of mapping.values()) if (mapping.has(to)) throw new Error('Asset map must not contain chained replacements');
  return mapping;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export async function prepareMigration(db, mapping = new Map()) {
  const plan = {
    photos: [], people: [], projects: [], vkPosts: [],
    summary: {
      convertedPhotos: 0, alreadyWebpPhotos: 0, photoBytesBefore: 0, photoBytesAfter: 0,
      updatedReferences: { leadershipPeople: 0, studioProjects: 0, vkPosts: 0 },
    },
  };
  if (tableExists(db, 'portal_leadership_photos')) {
    const rows = db.prepare('SELECT id, mime_type, bytes, size_bytes FROM portal_leadership_photos ORDER BY id').all();
    for (const row of rows) {
      const originalBytes = Buffer.from(row.bytes);
      plan.summary.photoBytesBefore += originalBytes.length;
      if (row.mime_type === 'image/webp') {
        plan.summary.alreadyWebpPhotos += 1;
        plan.summary.photoBytesAfter += originalBytes.length;
        continue;
      }
      if (!['image/jpeg', 'image/png'].includes(row.mime_type)) throw new Error('Unsupported stored photo MIME type; no changes applied');
      let converted;
      try {
        const source = sharp(originalBytes, { animated: true, failOn: 'warning' });
        const metadata = await source.metadata();
        if (!['jpeg', 'png'].includes(metadata.format)) throw new Error('Unexpected image format');
        converted = await source.rotate().webp({ quality: 85, effort: 6 }).toBuffer();
      } catch {
        throw new Error('A stored photo could not be decoded or converted; no changes applied');
      }
      if (!converted.length || converted.length > MAX_PHOTO_BYTES) throw new Error('A converted photo exceeds the database size limit; no changes applied');
      plan.photos.push({ id: row.id, mimeType: row.mime_type, sizeBytes: row.size_bytes, originalBytes, converted });
      plan.summary.convertedPhotos += 1;
      plan.summary.photoBytesAfter += converted.length;
    }
  }
  if (mapping.size && tableExists(db, 'portal_leadership_people')) {
    for (const row of db.prepare('SELECT id, photo_url FROM portal_leadership_people').all()) {
      if (mapping.has(row.photo_url)) plan.people.push({ id: row.id, before: row.photo_url, after: mapping.get(row.photo_url) });
    }
  }
  if (mapping.size && tableExists(db, 'portal_studio_projects')) {
    for (const row of db.prepare('SELECT id, content FROM portal_studio_projects').all()) {
      let content;
      try { content = JSON.parse(row.content); } catch { throw new Error('Invalid stored studio project JSON; no changes applied'); }
      if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Invalid stored studio project object; no changes applied');
      if (mapping.has(content.photoUrl)) {
        plan.projects.push({ id: row.id, before: row.content, after: JSON.stringify({ ...content, photoUrl: mapping.get(content.photoUrl) }) });
      }
    }
  }
  if (mapping.size && tableExists(db, 'portal_vk_posts')) {
    for (const row of db.prepare('SELECT id, image_url FROM portal_vk_posts').all()) {
      if (mapping.has(row.image_url)) plan.vkPosts.push({ id: row.id, before: row.image_url, after: mapping.get(row.image_url) });
    }
  }
  plan.summary.updatedReferences.leadershipPeople = plan.people.length;
  plan.summary.updatedReferences.studioProjects = plan.projects.length;
  plan.summary.updatedReferences.vkPosts = plan.vkPosts.length;
  return plan;
}

// Encoding finishes before the transaction starts. Comparing each original value
// prevents concurrent management edits from being silently overwritten.
export function applyMigrationPlan(db, plan) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const exactlyOne = result => {
      if (Number(result.changes) !== 1) throw new Error('Images or references changed during preparation; transaction rolled back; rerun the migration');
    };
    if (plan.photos.length) {
      const update = db.prepare("UPDATE portal_leadership_photos SET mime_type = 'image/webp', bytes = ?, size_bytes = ? WHERE id = ? AND mime_type = ? AND bytes = ? AND size_bytes = ?");
      for (const row of plan.photos) exactlyOne(update.run(row.converted, row.converted.length, row.id, row.mimeType, row.originalBytes, row.sizeBytes));
    }
    for (const [table, column, rows] of [
      ['portal_leadership_people', 'photo_url', plan.people],
      ['portal_studio_projects', 'content', plan.projects],
      ['portal_vk_posts', 'image_url', plan.vkPosts],
    ]) {
      if (!rows.length) continue;
      const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} = ?`);
      for (const row of rows) exactlyOne(update.run(row.after, row.id, row.before));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function migrateImages({ databasePath, mapPath, backupPath, apply = false }) {
  if (!databasePath) throw new Error('--database is required');
  if (apply && !backupPath) throw new Error('--apply requires an explicit unique --backup path');
  const sourcePath = await realpath(databasePath);
  if (!(await stat(sourcePath)).isFile()) throw new Error('Database must be an existing regular file');
  if (backupPath && resolve(backupPath) === sourcePath) throw new Error('Backup must use a different file');
  const mapping = validateAssetMap(mapPath ? JSON.parse(await readFile(mapPath, 'utf8')) : {});
  const db = new DatabaseSync(sourcePath, { readOnly: !apply });
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    const plan = await prepareMigration(db, mapping);
    if (apply) {
      // Reserve the destination without overwriting any existing backup or symlink.
      const destination = await open(backupPath, 'wx', 0o600);
      await destination.close();
      await backup(db, backupPath);
      const saved = new DatabaseSync(backupPath, { readOnly: true });
      try {
        if (saved.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite backup verification failed; no changes applied');
      } finally { saved.close(); }
      applyMigrationPlan(db, plan);
    }
    return { mode: apply ? 'applied' : 'dry-run', ...plan.summary, backupCreated: apply };
  } finally { db.close(); }
}

function parseArguments(argv) {
  const options = {};
  let mode;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--apply' || arg === '--dry-run') {
      if (mode) throw new Error('Specify --apply or --dry-run only once');
      mode = arg;
      options.apply = arg === '--apply';
      continue;
    }
    const key = { '--database': 'databasePath', '--map': 'mapPath', '--backup': 'backupPath' }[arg];
    if (!key || options[key] || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Invalid or duplicate migration argument');
    options[key] = argv[++index];
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('node scripts/migrate-images-webp.mjs --database PATH [--map PATH] [--dry-run | --apply --backup UNIQUE_PATH]');
    else console.log(JSON.stringify(await migrateImages(options), null, 2));
  } catch (error) {
    console.error(`Image migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exitCode = 1;
  }
}
