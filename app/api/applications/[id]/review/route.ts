import { textLimitError } from '@/app/text-validation';
import { sameOriginRequest } from '@/app/auth';
import { applicationRows, cleanText, requiredSession, serializeApplications } from '@/app/server/portal';
import { notifyTelegram } from '@/app/server/telegram';
import { database } from '@/db/server';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredSession(request, 'requester');
  if (!session?.organizationId) return Response.json({ error: 'Требуется вход' }, { status: 401 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = Number((await context.params).id);
  let body: { rating?: unknown; comment?: unknown };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: 'Проверьте отзыв' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Проверьте отзыв' }, { status: 400 });
  const textError = textLimitError(body.comment, 2000, 'Отзыв');
  if (textError) return Response.json({ error: textError }, { status: 400 });
  const rating = Number(body.rating);
  const comment = cleanText(body.comment, 2000);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return Response.json({ error: 'Поставьте оценку от 1 до 5' }, { status: 400 });
  }
  const db = database();
  const application = db.prepare(`
    SELECT id, event_title, status FROM portal_applications WHERE id = ? AND organization_id = ?
  `).get(id, session.organizationId) as { id: number; event_title: string; status: string } | undefined;
  if (!application) return Response.json({ error: 'Заявка не найдена' }, { status: 404 });
  if (application.status !== 'completed') return Response.json({ error: 'Отзыв доступен после выполнения заявки' }, { status: 409 });
  const existing = db.prepare('SELECT created_at FROM portal_reviews WHERE application_id = ?').get(id) as { created_at: string } | undefined;
  if (existing) {
    const age = Date.now() - new Date(existing.created_at.replace(' ', 'T') + 'Z').getTime();
    if (age > 7 * 24 * 60 * 60 * 1000) return Response.json({ error: 'Срок редактирования отзыва истёк' }, { status: 409 });
    db.prepare(`UPDATE portal_reviews SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP WHERE application_id = ?`).run(rating, comment, id);
  } else {
    db.prepare(`INSERT INTO portal_reviews (application_id, organization_id, rating, comment) VALUES (?, ?, ?, ?)`).run(id, session.organizationId, rating, comment);
  }
  await notifyTelegram(process.env.GUTV_TELEGRAM_ADMIN_CHAT_ID, `Новый отзыв по заявке №${id}: ${rating}/5\n${application.event_title}${comment ? `\n${comment}` : ''}`);
  return Response.json({ application: serializeApplications(applicationRows('WHERE a.id = ?', [id]), false)[0] });
}
