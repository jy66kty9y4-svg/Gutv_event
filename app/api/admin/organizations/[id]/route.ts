import { sameOriginRequest } from '@/app/auth';
import { cleanText, createNotification, requiredPrivilege } from '@/app/server/portal';
import { notifyTelegram } from '@/app/server/telegram';
import { database } from '@/db/server';

export const runtime = 'nodejs';

const statuses = new Set(['pending', 'active', 'rejected', 'blocked']);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredPrivilege(request, 'organizations.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'Организация не найдена' }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'Проверьте данные' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Проверьте данные' }, { status: 400 });
  for (const [key, limit, label] of [['decisionNote', 500, 'Комментарий к решению'], ['telegramChatId', 80, 'Telegram chat ID']] as const) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > limit)) {
      return Response.json({ error: `${label}: не более ${limit} символов` }, { status: 400 });
    }
  }
  const db = database();
  const current = db.prepare('SELECT * FROM portal_organizations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!current) return Response.json({ error: 'Организация не найдена' }, { status: 404 });
  const status = body.status === undefined ? String(current.status) : String(body.status);
  if (!statuses.has(status)) return Response.json({ error: 'Неизвестный статус' }, { status: 400 });
  const decisionNote = body.decisionNote === undefined ? String(current.decision_note) : cleanText(body.decisionNote, 500);
  const currentTelegramChatId = typeof current.telegram_chat_id === 'string' ? current.telegram_chat_id : null;
  const telegramChatId: string | null = body.telegramChatId === undefined ? currentTelegramChatId : cleanText(body.telegramChatId, 80) || null;
  if (['rejected', 'blocked'].includes(status) && !decisionNote) {
    return Response.json({ error: 'Укажите причину решения' }, { status: 400 });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE portal_organizations SET status = ?, decision_note = ?, telegram_chat_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, decisionNote, telegramChatId, id);
    db.prepare(`UPDATE portal_accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ?`).run(status, id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (status !== current.status) {
    const titles: Record<string, string> = { active: 'Аккаунт подтверждён', rejected: 'Регистрация отклонена', blocked: 'Аккаунт заблокирован', pending: 'Аккаунт отправлен на проверку' };
    createNotification(id, null, titles[status], decisionNote || 'Статус аккаунта изменён');
    await notifyTelegram(typeof telegramChatId === 'string' ? telegramChatId : null, `ГУТВ\n${titles[status]}${decisionNote ? `\n${decisionNote}` : ''}`);
  }
  const organization = db.prepare(`
    SELECT o.id, o.type, o.name, o.representative_name, o.contact, o.telegram_chat_id,
      o.status, o.decision_note, o.created_at, o.updated_at, a.id AS account_id, a.username, a.last_login_at
    FROM portal_organizations o LEFT JOIN portal_accounts a ON a.organization_id = o.id AND a.role = 'requester'
    WHERE o.id = ?
  `).get(id);
  return Response.json({ organization });
}
