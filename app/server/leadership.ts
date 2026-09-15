import type { LeadershipPerson, LeadershipPhotoPosition, LeadershipRoster, PublicLeadershipCard } from '@/app/leadership-types';
import { leadershipSeed } from '@/db/leadership-seed';
import { database } from '@/db/server';
import sharp from 'sharp';
import { webpPhotoUrl } from '@/app/photo-source';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24_000_000;

type PersonRow = { id: number; name: string; description: string; photo_url: string; photo_position: LeadershipPerson['photoPosition']; photo_scale: number };
type PositionRow = { id: number; title: string; sort_order: number; person_id: number | null };

export function leadershipRoster(): LeadershipRoster {
  const db = database();
  const people = (db.prepare('SELECT id, name, description, photo_url, photo_position, photo_scale FROM portal_leadership_people ORDER BY name COLLATE NOCASE, id').all() as PersonRow[])
    .map((row) => ({ id: row.id, name: row.name, description: row.description, photoUrl: row.photo_url, photoPosition: row.photo_position, photoScale: row.photo_scale }));
  const positions = (db.prepare('SELECT id, title, sort_order, person_id FROM portal_leadership_positions ORDER BY sort_order, id').all() as PositionRow[])
    .map((row) => ({ id: row.id, title: row.title, sortOrder: row.sort_order, personId: row.person_id }));
  return { people, positions };
}

export function publicLeadershipCards(): PublicLeadershipCard[] {
  const roster = leadershipRoster();
  const people = new Map(roster.people.map((person) => [person.id, person]));
  return roster.positions.map((position) => ({ ...position, person: position.personId ? people.get(position.personId) || null : null }));
}

export function leadershipId(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function leadershipRouteId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : 0;
}

export function leadershipText(value: unknown, min: number, max: number) {
  if (typeof value !== 'string' || value.length > max) return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length >= min && text.length <= max ? text : null;
}

export function leadershipPhotoPosition(value: unknown): LeadershipPhotoPosition | null {
  if (value === 'center top' || value === 'center center' || value === 'center bottom') return value;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?% (?:0|[1-9]\d*)(?:\.\d+)?%$/.test(value)) return null;
  const [x, y] = value.split(' ').map((part) => Number(part.slice(0, -1)));
  return x >= 0 && x <= 100 && y >= 0 && y <= 100 ? value as LeadershipPhotoPosition : null;
}

export function leadershipPhotoScale(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.25 && value <= 3 ? value : null;
}

export function isLeadershipPhotoUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Old editor tabs may still submit a pre-migration static photo URL.
  const migratedUrl = webpPhotoUrl(value);
  if (leadershipSeed.people.some((person) => person.photoUrl === value || person.photoUrl === migratedUrl)) return true;
  const match = value.match(/^\/api\/leadership\/photos\/([1-9]\d*)$/);
  return Boolean(match && database().prepare('SELECT id FROM portal_leadership_photos WHERE id = ?').get(Number(match[1])));
}

export async function leadershipImage(bytes: Uint8Array): Promise<{ mimeType: 'image/webp'; bytes: Buffer } | null> {
  if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) return null;
  try {
    const image = sharp(Buffer.from(bytes), { animated: true, limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' });
    const metadata = await image.metadata();
    if ((metadata.format !== 'jpeg' && metadata.format !== 'png' && metadata.format !== 'webp')
      || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS
      || (metadata.pages && metadata.pages > 1)) return null;
    const converted = await image.rotate().webp({ quality: 85, effort: 6 }).toBuffer();
    if (converted.length < 1 || converted.length > MAX_IMAGE_BYTES) return null;
    return { mimeType: 'image/webp', bytes: converted };
  } catch {
    return null;
  }
}
