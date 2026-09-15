import { createHash, timingSafeEqual } from 'node:crypto';
import type { StudioStory } from '@/app/public-content';
import { stories as fallbackStories } from '@/app/public-content';
import {
  VK_REFERENCE_CAPTURED_AT,
  VK_REFERENCE_GROUP_ID,
  vkReferencePosts,
  type VkReferencePost,
} from '@/app/vk-reference-posts';
import { database } from '@/db/server';

const DEFAULT_VK_GROUP_ID = 30973272;
const PUBLIC_STORY_LIMIT = 5;

type UnknownRecord = Record<string, unknown>;
type VkPostRow = {
  group_id: number;
  post_id: number;
  published_at: number;
  text: string;
  href: string;
  image_url: string;
  image_alt: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '';
}

export function vkGroupId() {
  const configured = finiteInteger(process.env.GUTV_VK_GROUP_ID);
  return configured > 0 ? configured : DEFAULT_VK_GROUP_ID;
}

export function vkCallbackSecret() {
  const sessionSecret = (process.env.GUTV_SESSION_SECRET || '').trim();
  if (!sessionSecret) throw new Error('Session secret is not configured');
  return createHash('sha256').update(`vk-callback-v1:${sessionSecret}`).digest('hex').slice(0, 48);
}

export function validVkCallbackSecret(value: unknown) {
  if (typeof value !== 'string') return false;
  const expected = Buffer.from(vkCallbackSecret());
  const received = Buffer.from(value);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function vkConfirmationCode() {
  const code = clean(process.env.GUTV_VK_CONFIRMATION_CODE, 80);
  if (!code) throw new Error('VK confirmation code is empty');
  return code;
}

type ImageCandidate = { url: string; width: number; height: number; alt: string };

function imageSizes(value: unknown, alt = ''): ImageCandidate[] {
  return list(value).flatMap((item) => {
    const size = record(item);
    const url = clean(size.url, 2048);
    if (!url.startsWith('https://')) return [];
    return [{
      url,
      width: Math.max(0, finiteInteger(size.width)),
      height: Math.max(0, finiteInteger(size.height)),
      alt,
    }];
  });
}

function attachmentImages(attachments: unknown): ImageCandidate[] {
  return list(attachments).flatMap((item) => {
    const attachment = record(item);
    const type = clean(attachment.type, 30);
    if (type === 'photo') {
      const photo = record(attachment.photo);
      return imageSizes(photo.sizes, clean(photo.text, 220));
    }
    if (type === 'video') {
      const video = record(attachment.video);
      return [
        ...imageSizes(video.image, clean(video.title, 220)),
        ...imageSizes(video.first_frame, clean(video.title, 220)),
      ];
    }
    if (type === 'link') {
      const link = record(attachment.link);
      const photo = record(link.photo);
      return imageSizes(photo.sizes, clean(link.title, 220));
    }
    if (type === 'doc') {
      const document = record(attachment.doc);
      const preview = record(document.preview);
      const photo = record(preview.photo);
      return imageSizes(photo.sizes, clean(document.title, 220));
    }
    return [];
  });
}

function bestPostImage(post: UnknownRecord) {
  const direct = attachmentImages(post.attachments);
  const copied = list(post.copy_history).flatMap((item) => attachmentImages(record(item).attachments));
  return [...direct, ...copied].sort((left, right) => right.width * right.height - left.width * left.height)[0];
}

function postText(post: UnknownRecord) {
  const ownText = clean(post.text, 20_000);
  if (ownText) return ownText;
  const copiedPost = record(list(post.copy_history)[0]);
  return clean(copiedPost.text, 20_000);
}

export function saveVkWallPost(value: unknown) {
  const envelope = record(value);
  const callbackObject = record(envelope.object);
  const post = record(callbackObject.post || callbackObject);
  const groupId = finiteInteger(envelope.group_id);
  const postId = finiteInteger(post.id);
  if (groupId !== vkGroupId() || postId <= 0) throw new Error('VK callback contains an invalid post');

  const publishedAt = finiteInteger(post.date) || Math.floor(Date.now() / 1000);
  const text = postText(post);
  const image = bestPostImage(post);
  const href = `https://vk.ru/wall-${groupId}_${postId}`;
  const imageAlt = image?.alt || 'Фотография из публикации ГУТВ';

  database().prepare(`
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
  `).run(groupId, postId, publishedAt, text, href, image?.url || '', imageAlt);
}

function shorten(value: string, max: number) {
  if (value.length <= max) return value;
  const shortened = value.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
  return `${shortened || value.slice(0, max - 1)}…`;
}

function storyCopy(rawText: string) {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.replace(/https?:\/\/\S+/g, '').trim())
    .filter(Boolean);
  const plain = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!plain) return {
    title: 'Новый материал ГУТВ',
    description: 'Свежая публикация студенческого телевидения Губкинского университета.',
  };

  const titleSource = lines[0].replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu, ' ').replace(/\s+/g, ' ').trim() || plain;
  const title = shorten(titleSource, 92);
  const remainder = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim();
  const descriptionSource = remainder || (plain !== titleSource ? plain : 'Открывайте публикацию, чтобы посмотреть материал полностью.');
  return { title, description: shorten(descriptionSource, 230) };
}

function storyDate(timestamp: number) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    timeZone: 'Europe/Moscow',
  }).format(new Date(timestamp * 1000));
}

function rowToStory(row: VkPostRow): StudioStory {
  const copy = storyCopy(row.text);
  return {
    date: storyDate(row.published_at),
    category: 'Новости студии',
    title: copy.title,
    description: copy.description,
    href: row.href,
    image: row.image_url || undefined,
    imageAlt: row.image_alt || undefined,
    source: 'vk',
  };
}

function referenceToStory(reference: VkReferencePost, row?: VkPostRow): StudioStory {
  const enriched = row ? rowToStory(row) : undefined;
  const description = reference.text.replace(/\s+/g, ' ').trim();
  return {
    date: enriched?.date || reference.date,
    category: 'Новости студии',
    title: row?.text ? enriched?.title || reference.title : reference.title,
    description: shorten(row?.text ? enriched?.description || description : description, 230),
    href: reference.href,
    image: enriched?.image || reference.image,
    imageAlt: enriched?.image ? enriched.imageAlt : reference.imageAlt,
    imageCrop: enriched?.image ? undefined : reference.imageCrop,
    duration: reference.duration,
    source: 'vk',
  };
}

export function latestPublicStories(): StudioStory[] {
  const groupId = vkGroupId();
  const references = groupId === VK_REFERENCE_GROUP_ID ? vkReferencePosts : [];
  let rows: VkPostRow[] = [];
  try {
    if (references.length > 0) {
      const referenceIds = references.map((reference) => reference.postId);
      const placeholders = referenceIds.map(() => '?').join(', ');
      rows = database().prepare(`
        SELECT group_id, post_id, published_at, text, href, image_url, image_alt
        FROM portal_vk_posts
        WHERE group_id = ?
          AND (published_at > ? OR post_id IN (${placeholders}))
        ORDER BY published_at DESC, post_id DESC
        LIMIT ?
      `).all(groupId, VK_REFERENCE_CAPTURED_AT, ...referenceIds, PUBLIC_STORY_LIMIT + references.length) as VkPostRow[];
    } else {
      rows = database().prepare(`
        SELECT group_id, post_id, published_at, text, href, image_url, image_alt
        FROM portal_vk_posts
        WHERE group_id = ?
        ORDER BY published_at DESC, post_id DESC
        LIMIT ?
      `).all(groupId, PUBLIC_STORY_LIMIT) as VkPostRow[];
    }
  } catch {
    const referenceStories = references.map((reference) => referenceToStory(reference)).slice(0, PUBLIC_STORY_LIMIT);
    return referenceStories.length > 0 ? referenceStories : fallbackStories.slice(0, PUBLIC_STORY_LIMIT);
  }

  const referenceIds = new Set(references.map((reference) => reference.postId));
  const rowsByPostId = new Map(rows.map((row) => [row.post_id, row]));
  const newerStories = rows
    .filter((row) => !referenceIds.has(row.post_id) && (references.length === 0 || row.published_at > VK_REFERENCE_CAPTURED_AT))
    .map(rowToStory);
  const referenceStories = references.map((reference) => referenceToStory(reference, rowsByPostId.get(reference.postId)));
  const stories = [...newerStories, ...referenceStories].slice(0, PUBLIC_STORY_LIMIT);
  return stories.length > 0 ? stories : fallbackStories.slice(0, PUBLIC_STORY_LIMIT);
}
