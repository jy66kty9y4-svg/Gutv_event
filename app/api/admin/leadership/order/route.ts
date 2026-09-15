import { sameOriginRequest } from '@/app/auth';
import { database } from '@/db/server';
import { leadershipId, leadershipRoster } from '@/app/server/leadership';
import { requiredPrivilege } from '@/app/server/portal';

export async function PUT(request: Request) {
  const session = await requiredPrivilege(request, 'leadership.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const value = await request.json().catch(() => null);
  const body = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as { ids?: unknown } : null;
  if (!body || Object.keys(body).length !== 1 || !Array.isArray(body.ids)) return Response.json({ error: 'Некорректный порядок' }, { status: 400 });
  const ids = body.ids.map(leadershipId);
  const db = database();
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = (db.prepare('SELECT id FROM portal_leadership_positions ORDER BY sort_order').all() as Array<{ id: number }>).map((item) => item.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) {
      db.exec('ROLLBACK');
      return Response.json({ error: 'Некорректный порядок' }, { status: 400 });
    }
    db.prepare('UPDATE portal_leadership_positions SET sort_order = sort_order + 1000000').run();
    const update = db.prepare('UPDATE portal_leadership_positions SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    ids.forEach((id, index) => update.run(index + 1, id));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return Response.json(leadershipRoster());
}
