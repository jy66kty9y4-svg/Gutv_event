import { sameOriginRequest } from '@/app/auth';
import { database } from '@/db/server';
import { leadershipId, leadershipRoster, leadershipRouteId, leadershipText } from '@/app/server/leadership';
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
  const current = database().prepare('SELECT id FROM portal_leadership_positions WHERE id = ?').get(id);
  if (!current) return Response.json({ error: 'Не найдено' }, { status: 404 });
  if (!body || !Object.keys(body).length || Object.keys(body).some((key) => key !== 'title' && key !== 'personId')) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  const title = body.title === undefined ? undefined : leadershipText(body.title, 2, 100);
  const personId = body.personId === undefined ? undefined : body.personId === null ? null : leadershipId(body.personId);
  if (title === null || personId === 0 || personId && !database().prepare('SELECT id FROM portal_leadership_people WHERE id = ?').get(personId)) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  const row = database().prepare('SELECT title, person_id FROM portal_leadership_positions WHERE id = ?').get(id) as { title: string; person_id: number | null };
  database().prepare('UPDATE portal_leadership_positions SET title = ?, person_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(title === undefined ? row.title : title, personId === undefined ? row.person_id : personId, id);
  return Response.json(leadershipRoster());
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredPrivilege(request, 'leadership.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = leadershipRouteId((await context.params).id);
  if (!database().prepare('DELETE FROM portal_leadership_positions WHERE id = ?').run(id).changes) return Response.json({ error: 'Не найдено' }, { status: 404 });
  return Response.json(leadershipRoster());
}
