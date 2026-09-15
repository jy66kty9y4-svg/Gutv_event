import { createPasswordRecord, normalizedUsername, sameOriginRequest } from '@/app/auth';
import { registrationFields, registrationValidationError } from '@/app/auth-validation';
import { notifyTelegram } from '@/app/server/telegram';
import { database } from '@/db/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'Проверьте поля формы' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Проверьте поля формы' }, { status: 400 });

  const fields = registrationFields(body);
  const error = registrationValidationError(fields, body);
  if (error) return Response.json({ error }, { status: 400 });
  const { organizationType, organizationName, representativeName, contact, username, password } = fields;
  const reservedUsernames = new Set([
    normalizedUsername(process.env.GUTV_ADMIN_USERNAME || 'studio'),
  ]);
  if (reservedUsernames.has(username)) {
    return Response.json({ error: 'Этот логин недоступен' }, { status: 409 });
  }

  const db = database();
  const passwordHash = await createPasswordRecord(password);
  db.exec('BEGIN IMMEDIATE');
  try {
    const organization = db.prepare(`
      INSERT INTO portal_organizations (type, name, representative_name, contact, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(organizationType, organizationName, representativeName, contact);
    db.prepare(`
      INSERT INTO portal_accounts (username, password_hash, role, status, organization_id, display_name)
      VALUES (?, ?, 'requester', 'pending', ?, ?)
    `).run(username, passwordHash, Number(organization.lastInsertRowid), representativeName);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      return Response.json({ error: 'Такое название организации или логин уже зарегистрированы' }, { status: 409 });
    }
    throw error;
  }

  await notifyTelegram(process.env.GUTV_TELEGRAM_ADMIN_CHAT_ID, `Новая регистрация на сайте ГУТВ\n${organizationName}\nКонтакт: ${representativeName}, ${contact}`);
  return Response.json({ ok: true }, { status: 201 });
}
