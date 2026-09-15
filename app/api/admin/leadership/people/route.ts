import { webpPhotoUrl } from '@/app/photo-source';
import { sameOriginRequest } from '@/app/auth';
import { database } from '@/db/server';
import { isLeadershipPhotoUrl, leadershipPhotoPosition, leadershipPhotoScale, leadershipRoster, leadershipText } from '@/app/server/leadership';
import { requiredPrivilege } from '@/app/server/portal';

export async function POST(request: Request) {
  const session = await requiredPrivilege(request, 'leadership.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const value = await request.json().catch(() => null);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  const body = value as Record<string, unknown>;
  const required = ['name', 'description', 'photoUrl', 'photoPosition'];
  const allowed = [...required, 'photoScale'];
  if (required.some((key) => !(key in body)) || Object.keys(body).some((key) => !allowed.includes(key))) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  const name = leadershipText(body.name, 2, 120);
  const description = leadershipText(body.description, 0, 600);
  const photoUrl = body.photoUrl === '' ? '' : isLeadershipPhotoUrl(body.photoUrl) ? body.photoUrl : null;
  const photoPosition = leadershipPhotoPosition(body.photoPosition);
  const photoScale = body.photoScale === undefined ? 1 : leadershipPhotoScale(body.photoScale);
  if (!name || description === null || photoUrl === null || !photoPosition || photoScale === null) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  database().prepare('INSERT INTO portal_leadership_people (name, description, photo_url, photo_position, photo_scale) VALUES (?, ?, ?, ?, ?)').run(name, description, webpPhotoUrl(photoUrl), photoPosition, photoScale);
  return Response.json(leadershipRoster());
}
