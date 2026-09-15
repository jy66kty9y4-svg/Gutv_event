import { sameOriginRequest } from '@/app/auth';
import { briefTextError, filmingSlotsError, normalizeFilmingSlots, type FilmingSlot, type RequestKind } from '@/app/filming-brief';
import { deliveryDateError, needsDeliveryDate } from '@/app/request-deadlines';
import { filmingDateBounds } from '@/app/filming-validation';
import { requestedSpecialistsError, type RequestedSpecialist } from '@/app/request-specialists';
import { applicationTextError } from '@/app/text-validation';
import { saveFilmingBrief } from '@/app/server/filming-brief';
import { applicationRows, cleanText, createNotification, requiredSession, serializeApplications } from '@/app/server/portal';
import { notifyTelegram } from '@/app/server/telegram';
import { database } from '@/db/server';

export const runtime = 'nodejs';
const conflict = () => Response.json({ code: 'revision_conflict', error: 'Заявка уже изменена. Обновите её данные перед повторной отправкой. Ваши правки сохранены в черновике.' }, { status: 409 });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredSession(request, 'requester');
  if (!session?.organizationId) return Response.json({ error: 'Требуется вход' }, { status: 401 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'Неверный номер заявки' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: 'Не удалось прочитать данные заявки' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Проверьте данные заявки' }, { status: 400 });
  const db = database();
  const current = db.prepare('SELECT id, status, event_title, revision FROM portal_applications WHERE id = ? AND organization_id = ?').get(id, session.organizationId) as { id: number; status: string; event_title: string; revision: number } | undefined;
  if (!current) return Response.json({ error: 'Заявка не найдена' }, { status: 404 });
  if (!Number.isInteger(body.revision) || Number(body.revision) < 1 || body.revision !== current.revision) return conflict();
  const action = body.action ?? 'cancel';
  if (action !== 'cancel' && action !== 'resubmit') return Response.json({ error: 'Неизвестное действие с заявкой' }, { status: 400 });
  if (action === 'cancel') {
    if (!['review', 'clarification', 'approved'].includes(current.status)) return Response.json({ error: 'Эту заявку уже нельзя отменить самостоятельно' }, { status: 409 });
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500)) return Response.json({ error: 'Причина отмены: не более 500 символов' }, { status: 400 });
    const reason = cleanText(body.reason, 500);
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare("UPDATE portal_applications SET status = 'cancelled', closing_reason = ?, updated_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ? AND organization_id = ? AND revision = ? AND status = ?").run(reason, id, session.organizationId, current.revision, current.status);
      if (result.changes !== 1) { db.exec('ROLLBACK'); return conflict(); }
      db.prepare("INSERT INTO portal_status_history (application_id, from_status, to_status, changed_by, note) VALUES (?, ?, 'cancelled', ?, ?)").run(id, current.status, session.accountId, reason || 'Отменено заказчиком');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      console.error('Application cancellation failed', { message: error instanceof Error ? error.message : 'Unknown error' });
      return Response.json({ error: 'Не удалось отменить заявку. Попробуйте ещё раз.' }, { status: 500 });
    }
    createNotification(session.organizationId, id, 'Заявка отменена', current.event_title);
    await notifyTelegram(process.env.GUTV_TELEGRAM_ADMIN_CHAT_ID, `Заявка №${id} отменена заказчиком\n${current.event_title}${reason ? `\nПричина: ${reason}` : ''}`);
    return Response.json({ application: serializeApplications(applicationRows('WHERE a.id = ?', [id]), false)[0] });
  }
  if (current.status !== 'clarification') return Response.json({ error: 'Повторная отправка доступна для заявки, которая требует уточнения. Обновите данные заявки.' }, { status: 409 });
  const textError = applicationTextError(body);
  if (textError) return Response.json({ error: textError }, { status: 400 });
  const briefError = briefTextError(body.requestKind, body.scenario, body.participants);
  if (briefError) return Response.json({ error: briefError }, { status: 400 });
  const deliveryDate = needsDeliveryDate(body.requestKind) ? body.deliveryDate : '';
  const deliveryError = deliveryDateError(body.requestKind, deliveryDate);
  if (deliveryError) return Response.json({ error: deliveryError }, { status: 400 });
  if (deliveryDate && String(deliveryDate) < filmingDateBounds().min) return Response.json({ error: 'Дата сдачи видеоматериала не может быть в прошлом' }, { status: 400 });
  if (body.rulesAccepted !== true) return Response.json({ error: 'Подтвердите ознакомление с правилами подачи заявок' }, { status: 400 });
  const slotError = filmingSlotsError(body.slots);
  if (slotError) return Response.json({ error: slotError }, { status: 400 });
  const slots = normalizeFilmingSlots(body.slots as FilmingSlot[]);
  const first = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const eventTitle = cleanText(body.eventTitle, 160), eventDescription = cleanText(body.eventDescription, 4000);
  const contactName = cleanText(body.contactName, 120), contactChannel = cleanText(body.contactChannel, 120);
  if (eventTitle.length < 2 || eventDescription.length < 10 || contactName.length < 2 || contactChannel.length < 3) return Response.json({ error: 'Заполните название, обоснование заявки и контактные данные' }, { status: 400 });
  const activeIds = (db.prepare('SELECT id FROM portal_specialties WHERE active = 1').all() as Array<{ id: number }>).map(item => item.id);
  const existingSpecialists = db.prepare('SELECT specialty_id, requested_count, assigned_count, assigned_names FROM portal_application_specialists WHERE application_id = ?').all(id) as Array<{ specialty_id: number; requested_count: number; assigned_count: number; assigned_names: string }>;
  const retainedArchiveIds = existingSpecialists.filter(item => !activeIds.includes(item.specialty_id)).map(item => item.specialty_id);
  const specialistError = requestedSpecialistsError(body.requestKind, body.specialists, [...activeIds, ...retainedArchiveIds]);
  if (specialistError) return Response.json({ error: specialistError }, { status: 400 });
  const specialists = body.specialists as RequestedSpecialist[];
  for (const item of specialists) {
    if (!activeIds.includes(item.id) && !existingSpecialists.some(existing => existing.specialty_id === item.id && existing.requested_count === item.requestedCount)) return Response.json({ error: 'Архивную специальность можно сохранить только с прежним количеством. Для изменения состава свяжитесь со студией.' }, { status: 400 });
  }
  if (existingSpecialists.some(item => (item.assigned_count > 0 || item.assigned_names.trim()) && !specialists.some(next => next.id === item.specialty_id))) return Response.json({ error: 'На удаляемую позицию уже назначены специалисты. Согласуйте изменение состава со студией; остальные данные и назначения сохранены.' }, { status: 400 });
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`UPDATE portal_applications SET event_title = ?, event_date = ?, start_time = ?, end_time = ?, location = ?, event_description = ?, contact_name = ?, contact_channel = ?, status = 'review', closing_reason = '', updated_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ? AND organization_id = ? AND revision = ? AND status = 'clarification'`).run(eventTitle, first.startsAt.slice(0, 10), first.startsAt.slice(11), first.endsAt.slice(11), first.location, eventDescription, contactName, contactChannel, id, session.organizationId, current.revision);
    if (result.changes !== 1) { db.exec('ROLLBACK'); return conflict(); }
    // Legacy records are upgraded in place; attachments, equipment and internal notes remain intact.
    saveFilmingBrief(id, { requestKind: body.requestKind as RequestKind, scenario: String(body.scenario).trim(), participants: String(body.participants).trim(), slots, deliveryDate: String(deliveryDate || ''), rulesAcceptedAt: new Date().toISOString() });
    const keepIds = new Set(specialists.map(item => item.id));
    const existing = db.prepare('SELECT specialty_id FROM portal_application_specialists WHERE application_id = ?').all(id) as Array<{ specialty_id: number }>;
    for (const item of existing) if (!keepIds.has(item.specialty_id)) db.prepare('DELETE FROM portal_application_specialists WHERE application_id = ? AND specialty_id = ?').run(id, item.specialty_id);
    const upsert = db.prepare('INSERT INTO portal_application_specialists (application_id, specialty_id, requested_count) VALUES (?, ?, ?) ON CONFLICT(application_id, specialty_id) DO UPDATE SET requested_count = excluded.requested_count');
    for (const item of specialists) upsert.run(id, item.id, item.requestedCount);
    db.prepare("INSERT INTO portal_status_history (application_id, from_status, to_status, changed_by, note) VALUES (?, 'clarification', 'review', ?, 'Заказчик уточнил заявку и отправил её повторно')").run(id, session.accountId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('Application resubmission failed', { message: error instanceof Error ? error.message : 'Unknown error' });
    return Response.json({ error: 'Не удалось отправить уточнение. Ваши правки сохранены в черновике.' }, { status: 500 });
  }
  createNotification(session.organizationId, id, 'Уточнение отправлено', `${eventTitle}. Заявка снова на рассмотрении.`);
  await notifyTelegram(process.env.GUTV_TELEGRAM_ADMIN_CHAT_ID, `Заказчик уточнил заявку №${id}\n${eventTitle}\n${first.startsAt.slice(0, 10)}, ${first.startsAt.slice(11)}–${first.endsAt.slice(11)}`);
  return Response.json({ application: serializeApplications(applicationRows('WHERE a.id = ?', [id]), false)[0] });
}
