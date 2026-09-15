import { textLimitError } from '@/app/text-validation';
import { sameOriginRequest } from '@/app/auth';
import { cleanText, requiredPrivilege } from '@/app/server/portal';
import { database } from '@/db/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await requiredPrivilege(request, 'specialties.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  let name = '';
  try {
    const body = await request.json() as { name?: unknown };
    const textError = textLimitError(body?.name, 80, 'Название специальности');
    if (textError) return Response.json({ error: textError }, { status: 400 });
    name = cleanText(body?.name, 80);
  } catch { /* handled below */ }
  if (name.length < 2) return Response.json({ error: 'Введите название специальности' }, { status: 400 });
  const db = database();
  try {
    const sort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM portal_specialties').get() as { value: number }).value + 1;
    const result = db.prepare('INSERT INTO portal_specialties (name, sort_order) VALUES (?, ?)').run(name, sort);
    return Response.json({ specialty: { id: Number(result.lastInsertRowid), name, active: 1, sort_order: sort } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return Response.json({ error: 'Такая специальность уже существует' }, { status: 409 });
    throw error;
  }
}
