import { webpPhotoUrl } from '@/app/photo-source';
import { sameOriginRequest } from '@/app/auth';
import { database } from '@/db/server';
import { isLeadershipPhotoUrl, leadershipPhotoPosition, leadershipPhotoScale, leadershipRoster, leadershipRouteId, leadershipText } from '@/app/server/leadership';
import { requiredPrivilege } from '@/app/server/portal';

function jsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredPrivilege(request, 'leadership.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = leadershipRouteId((await context.params).id);
  const value = await request.json().catch(() => null);
  const body = jsonObject(value) ? value : null;
  const db = database();
  const current = db.prepare('SELECT name, description, photo_url, photo_position, photo_scale FROM portal_leadership_people WHERE id = ?').get(id) as { name: string; description: string; photo_url: string; photo_position: string; photo_scale: number } | undefined;
  if (!current) return Response.json({ error: 'Не найдено' }, { status: 404 });
  if (!body || !Object.keys(body).length || Object.keys(body).some((key) => !['name', 'description', 'photoUrl', 'photoPosition', 'photoScale'].includes(key))) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  const name = body.name === undefined ? current.name : leadershipText(body.name, 2, 120);
  const description = body.description === undefined ? current.description : leadershipText(body.description, 0, 600);
  const photoUrl = body.photoUrl === undefined ? current.photo_url : body.photoUrl === '' ? '' : isLeadershipPhotoUrl(body.photoUrl) ? body.photoUrl : null;
  const photoPosition = body.photoPosition === undefined ? current.photo_position : leadershipPhotoPosition(body.photoPosition);
  const photoScale = body.photoScale === undefined ? current.photo_scale : leadershipPhotoScale(body.photoScale);
  if (!name || description === null || photoUrl === null || !photoPosition || photoScale === null) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  db.prepare('UPDATE portal_leadership_people SET name = ?, description = ?, photo_url = ?, photo_position = ?, photo_scale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name, description, webpPhotoUrl(photoUrl), photoPosition, photoScale, id);
  return Response.json(leadershipRoster());
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredPrivilege(request, 'leadership.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = leadershipRouteId((await context.params).id);
  if (!database().prepare('DELETE FROM portal_leadership_people WHERE id = ?').run(id).changes) return Response.json({ error: 'Не найдено' }, { status: 404 });
  return Response.json(leadershipRoster());
}
