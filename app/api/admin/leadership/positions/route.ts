import { sameOriginRequest } from '@/app/auth';
import { database } from '@/db/server';
import { leadershipId, leadershipRoster, leadershipText } from '@/app/server/leadership';
import { requiredPrivilege } from '@/app/server/portal';

export async function POST(request: Request) {
  const session = await requiredPrivilege(request, 'leadership.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const value = await request.json().catch(() => null);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'title' && key !== 'personId')) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  const title = leadershipText(body.title, 2, 100);
  const personId = body.personId === null || body.personId === undefined ? null : leadershipId(body.personId);
  if (!title || (body.personId !== null && body.personId !== undefined && !personId) || (personId && !database().prepare('SELECT id FROM portal_leadership_people WHERE id = ?').get(personId))) return Response.json({ error: 'Некорректные данные' }, { status: 400 });
  const db = database();
  const sort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM portal_leadership_positions').get() as { value: number }).value + 1;
  db.prepare('INSERT INTO portal_leadership_positions (title, person_id, sort_order) VALUES (?, ?, ?)').run(title, personId, sort);
  return Response.json(leadershipRoster());
}
