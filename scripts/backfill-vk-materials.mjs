#!/usr/bin/env node

import { DatabaseSync } from 'node:sqlite';

const DEFAULT_GROUP_ID = 30973272;
const MAX_POSTS = 100;

function clean(value, max) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '';
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function records(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function imageSizes(value, alt = '') {
  return (Array.isArray(value) ? value : []).flatMap((size) => {
    const record = records(size);
    const url = clean(record.url, 2048);
    return url.startsWith('https://') ? [{
      url,
      area: positiveInteger(record.width) * positiveInteger(record.height),
      alt,
    }] : [];
  });
}

function attachmentImages(attachments) {
  return (Array.isArray(attachments) ? attachments : []).flatMap((attachment) => {
    const item = records(attachment);
    if (item.type === 'photo') {
      const photo = records(item.photo);
      return imageSizes(photo.sizes, clean(photo.text, 220));
    }
    if (item.type === 'video') {
      const video = records(item.video);
      return [...imageSizes(video.image, clean(video.title, 220)), ...imageSizes(video.first_frame, clean(video.title, 220))];
    }
    if (item.type === 'link') {
      const link = records(item.link);
      return imageSizes(records(link.photo).sizes, clean(link.title, 220));
    }
    if (item.type === 'doc') {
      const document = records(item.doc);
      return imageSizes(records(records(document.preview).photo).sizes, clean(document.title, 220));
    }
    return [];
  });
}

function normalisePost(post, groupId) {
  const item = records(post);
  const postId = positiveInteger(item.id);
  const publishedAt = positiveInteger(item.date);
  if (!postId || !publishedAt || Number(item.owner_id) !== -groupId) return null;
  const copiedPost = records((Array.isArray(item.copy_history) ? item.copy_history : [])[0]);
  const text = clean(item.text, 20_000) || clean(copiedPost.text, 20_000);
  const images = [...attachmentImages(item.attachments), ...attachmentImages(copiedPost.attachments)];
  const image = images.sort((left, right) => right.area - left.area)[0];
  return {
    groupId,
    postId,
    publishedAt,
    text,
    href: `https://vk.ru/wall-${groupId}_${postId}`,
    imageUrl: image?.url || '',
    imageAlt: image?.alt || 'Фотография из публикации ГУТВ',
  };
}

const args = new Set(process.argv.slice(2));
if ([...args].some((argument) => !['--apply', '--dry-run'].includes(argument))) {
  throw new Error('Usage: node scripts/backfill-vk-materials.mjs [--dry-run|--apply]');
}

const apply = args.has('--apply');
const token = clean(process.env.GUTV_VK_BACKFILL_TOKEN, 512);
const groupId = positiveInteger(process.env.GUTV_VK_GROUP_ID, DEFAULT_GROUP_ID);
const count = Math.min(positiveInteger(process.env.GUTV_VK_BACKFILL_COUNT, 20), MAX_POSTS);
if (!token) throw new Error('GUTV_VK_BACKFILL_TOKEN is required');

const endpoint = new URL('https://api.vk.com/method/wall.get');
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  body: new URLSearchParams({
    owner_id: `-${groupId}`,
    filter: 'owner',
    count: String(count),
    v: '5.199',
    access_token: token,
  }),
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`VK wall.get returned HTTP ${response.status}`);
const payload = await response.json();
if (payload?.error) throw new Error(`VK wall.get error ${payload.error.error_code || 'unknown'}: ${payload.error.error_msg || 'unknown error'}`);

const posts = (Array.isArray(payload?.response?.items) ? payload.response.items : [])
  .map((post) => normalisePost(post, groupId))
  .filter(Boolean)
  .sort((left, right) => right.publishedAt - left.publishedAt || right.postId - left.postId)
  .slice(0, 5);
if (posts.length === 0) throw new Error('VK wall.get returned no own public posts');

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  groupId,
  selected: posts.map((post) => ({ postId: post.postId, publishedAt: post.publishedAt, hasText: Boolean(post.text), hasImage: Boolean(post.imageUrl) })),
}, null, 2));

if (apply) {
  const databasePath = clean(process.env.GUTV_DATABASE_PATH, 4096);
  if (!databasePath) throw new Error('GUTV_DATABASE_PATH is required with --apply');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA busy_timeout = 5000;');
    const upsert = database.prepare(`
      INSERT INTO portal_vk_posts
        (group_id, post_id, published_at, text, href, image_url, image_alt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id, post_id) DO UPDATE SET
        published_at = excluded.published_at,
        text = excluded.text,
        href = excluded.href,
        image_url = excluded.image_url,
        image_alt = excluded.image_alt,
        updated_at = CURRENT_TIMESTAMP
    `);
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const post of posts) upsert.run(post.groupId, post.postId, post.publishedAt, post.text, post.href, post.imageUrl, post.imageAlt);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}
