import { textLimitError } from '@/app/text-validation';
import { sameOriginRequest } from '@/app/auth';
import { cleanText, requiredPrivilege } from '@/app/server/portal';
import { database } from '@/db/server';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredPrivilege(request, 'specialties.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = Number((await context.params).id);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'Проверьте данные' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Проверьте данные' }, { status: 400 });
  const textError = textLimitError(body.name, 80, 'Название специальности');
  if (textError) return Response.json({ error: textError }, { status: 400 });
  const db = database();
  const current = db.prepare('SELECT id, name, active FROM portal_specialties WHERE id = ?').get(id) as { id: number; name: string; active: number } | undefined;
  if (!current) return Response.json({ error: 'Специальность не найдена' }, { status: 404 });
  const name = body.name === undefined ? current.name : cleanText(body.name, 80);
  const active = body.active === undefined ? current.active : body.active ? 1 : 0;
  if (name.length < 2) return Response.json({ error: 'Введите название специальности' }, { status: 400 });
  try {
    db.prepare('UPDATE portal_specialties SET name = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, active, id);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return Response.json({ error: 'Такая специальность уже существует' }, { status: 409 });
    throw error;
  }
  return Response.json({ specialty: { id, name, active } });
}
