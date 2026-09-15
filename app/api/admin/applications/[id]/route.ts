import { briefTextError, filmingSlotsError, normalizeFilmingSlots, type FilmingSlot, type FilmingBrief } from '@/app/filming-brief';
import { loadFilmingBrief, saveFilmingBrief } from '@/app/server/filming-brief';
import { filmingScheduleError, validFilmingDate, validFilmingTime } from '@/app/filming-validation';
import { applicationTextError, textLimitError } from '@/app/text-validation';
import { sameOriginRequest } from '@/app/auth';
import { applicationRows, cleanText, createNotification, isPortalStatus, requiredPrivilege, serializeApplications, statusLabels, type PortalStatus } from '@/app/server/portal';
import { notifyTelegram } from '@/app/server/telegram';
import { database } from '@/db/server';
import { deliveryDateError, needsDeliveryDate, requestDeadlineWarnings } from '@/app/request-deadlines';

export const runtime = 'nodejs';

const transitions: Record<PortalStatus, PortalStatus[]> = {
  review: ['clarification', 'approved', 'rejected', 'cancelled'],
  clarification: ['review', 'approved', 'rejected', 'cancelled'],
  approved: ['in_progress', 'clarification', 'rejected', 'cancelled'],
  in_progress: ['completed', 'clarification', 'cancelled'],
  completed: [],
  rejected: ['review'],
  cancelled: ['review'],
};

function cleanRequired(value: unknown, fallback: string, max: number) {
  return value === undefined ? fallback : cleanText(value, max);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredPrivilege(request, 'applications.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'Неверный номер заявки' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'Проверьте данные' }, { status: 400 }); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Проверьте данные' }, { status: 400 });
  const revision = body.revision;
  const revisionConflict = () => Response.json({ error: 'Заявка уже изменена. Ваши правки сохранены в форме. Загрузите актуальную версию перед повторным сохранением.', code: 'revision_conflict' }, { status: 409 });
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return revisionConflict();
  const textError = applicationTextError(body);
  if (textError) return Response.json({ error: textError }, { status: 400 });
  const db = database();
  const current = db.prepare(`SELECT * FROM portal_applications WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!current) return Response.json({ error: 'Заявка не найдена' }, { status: 404 });
  if (current.revision !== revision) return revisionConflict();
  if (body.action === 'hide' || body.action === 'restore') {
    db.prepare(`UPDATE portal_applications SET hidden_at = ${body.action === 'hide' ? 'COALESCE(hidden_at, CURRENT_TIMESTAMP)' : 'NULL'}, updated_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ? AND revision = ?`).run(id, revision);
    return Response.json({ application: serializeApplications(applicationRows('WHERE a.id = ?', [id]), true)[0] });
  }
  const existingBrief = loadFilmingBrief(id);
  let nextBrief: FilmingBrief | null = null;
  if (existingBrief) {
    const kind = body.requestKind === undefined ? existingBrief.requestKind : body.requestKind;
    const scenario = body.scenario === undefined ? existingBrief.scenario : body.scenario;
    const participants = body.participants === undefined ? existingBrief.participants : body.participants;
    const detailError = briefTextError(kind, scenario, participants);
    if (detailError) return Response.json({ error: detailError }, { status: 400 });
    const deliveryDate = needsDeliveryDate(kind) ? (body.deliveryDate === undefined ? existingBrief.deliveryDate : body.deliveryDate) : '';
    const deliveryError = deliveryDateError(kind, deliveryDate);
    if (deliveryError) return Response.json({ error: deliveryError }, { status: 400 });
    const rawSlots = body.slots === undefined ? existingBrief.slots : body.slots;
    const slotError = filmingSlotsError(rawSlots, new Date(), existingBrief.slots);
    if (slotError) return Response.json({ error: slotError }, { status: 400 });
    const slots = normalizeFilmingSlots(rawSlots as FilmingSlot[]);
    const first = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    const summary = { eventDate: first.startsAt.slice(0, 10), startTime: first.startsAt.slice(11), endTime: first.endsAt.slice(11), location: first.location };
    for (const [key, value] of Object.entries(summary)) {
      if (body[key] !== undefined && body[key] !== value) return Response.json({ error: 'Изменяйте дату, время и место в интервалах съёмки' }, { status: 400 });
      body[key] = value;
    }
    nextBrief = { ...existingBrief, requestKind: kind as FilmingBrief['requestKind'], scenario: String(scenario).trim(), participants: String(participants).trim(), slots, deliveryDate: String(deliveryDate || '') };
  } else if (['requestKind', 'scenario', 'participants', 'slots'].some(key => body[key] !== undefined)) {
    return Response.json({ error: 'Эта заявка создана по прежней форме' }, { status: 400 });
  }
  const currentStatus = current.status as PortalStatus;
  const nextStatus = body.status === undefined ? currentStatus : body.status;
  if (!isPortalStatus(nextStatus)) return Response.json({ error: 'Неизвестный статус' }, { status: 400 });
  if (nextStatus !== currentStatus && !transitions[currentStatus].includes(nextStatus)) {
    return Response.json({ error: `Нельзя перейти из «${statusLabels[currentStatus]}» в «${statusLabels[nextStatus]}»` }, { status: 409 });
  }

  const eventTitle = cleanRequired(body.eventTitle, String(current.event_title), 160);
  const eventDate = cleanRequired(body.eventDate, String(current.event_date), 10);
  const startTime = cleanRequired(body.startTime, String(current.start_time), 5);
  const endTime = cleanRequired(body.endTime, String(current.end_time), 5);
  const location = cleanRequired(body.location, String(current.location), 240);
  const eventDescription = cleanRequired(body.eventDescription, String(current.event_description), 4000);
  const requestedEquipment = cleanRequired(body.requestedEquipment, String(current.requested_equipment), 2000);
  const assignedEquipment = cleanRequired(body.assignedEquipment, String(current.assigned_equipment), 2000);
  const contactName = cleanRequired(body.contactName, String(current.contact_name), 120);
  const contactChannel = cleanRequired(body.contactChannel, String(current.contact_channel), 120);
  const customerComment = cleanRequired(body.customerComment, String(current.customer_comment), 2000);
  const internalComment = cleanRequired(body.internalComment, String(current.internal_comment), 3000);
  const closingReason = cleanRequired(body.closingReason, String(current.closing_reason), 500);
  const scheduleChanged = eventDate !== current.event_date || startTime !== current.start_time || endTime !== current.end_time;
  const scheduleError = !existingBrief && scheduleChanged ? filmingScheduleError(eventDate, startTime, endTime) : null;
  if (scheduleError) return Response.json({ error: scheduleError }, { status: 400 });
  if (eventTitle.length < 2 || (scheduleChanged && !validFilmingDate(eventDate)) || !validFilmingTime(startTime) || !validFilmingTime(endTime) || (!existingBrief && endTime <= startTime) || location.length < 2 || eventDescription.length < 10 || requestedEquipment.length < 2 || contactName.length < 2 || contactChannel.length < 3) {
    return Response.json({ error: 'Проверьте обязательные поля заявки' }, { status: 400 });
  }
  if (['clarification', 'rejected', 'cancelled'].includes(nextStatus) && nextStatus !== currentStatus && !closingReason) {
    return Response.json({ error: nextStatus === 'clarification' ? 'Укажите, что нужно уточнить заказчику' : 'Укажите причину отклонения или отмены' }, { status: 400 });
  }
  const deadlineWarnings = requestDeadlineWarnings(nextBrief, String(current.created_at));
  const exceptionRequired = nextStatus === 'approved' && deadlineWarnings.length > 0;
  if (exceptionRequired && body.acceptRuleException !== true) return Response.json({ error: 'Подтвердите согласование заявки несмотря на несоответствие срокам подачи', warnings: deadlineWarnings }, { status: 400 });

  const specialists = Array.isArray(body.specialists) ? body.specialists as Array<Record<string, unknown>> : null;
  if (specialists) {
    for (const item of specialists) {
      if (!item || typeof item !== 'object') return Response.json({ error: 'Проверьте назначение специалистов' }, { status: 400 });
      const error = textLimitError(item.assignedNames, 500, 'Назначенные специалисты');
      if (error) return Response.json({ error }, { status: 400 });
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const updated = db.prepare(`
      UPDATE portal_applications SET event_title = ?, event_date = ?, start_time = ?, end_time = ?,
        location = ?, event_description = ?, requested_equipment = ?, assigned_equipment = ?,
        contact_name = ?, contact_channel = ?, customer_comment = ?, internal_comment = ?,
        status = ?, closing_reason = ?, updated_at = CURRENT_TIMESTAMP, revision = revision + 1
      WHERE id = ? AND revision = ?
    `).run(eventTitle, eventDate, startTime, endTime, location, eventDescription, requestedEquipment, assignedEquipment, contactName, contactChannel, customerComment, internalComment, nextStatus, closingReason, id, revision);
    if (Number(updated.changes) !== 1) throw new Error('Application revision conflict');

    if (nextBrief) saveFilmingBrief(id, nextBrief);

    if (specialists) {
      const existingIds = new Set((db.prepare('SELECT specialty_id FROM portal_application_specialists WHERE application_id = ?').all(id) as Array<{ specialty_id: number }>).map((item) => item.specialty_id));
      const update = db.prepare(`
        UPDATE portal_application_specialists SET requested_count = ?, assigned_count = ?, assigned_names = ?
        WHERE application_id = ? AND specialty_id = ?
      `);
      for (const item of specialists) {
        const specialtyId = Number(item.id);
        const requestedCount = Number(item.requestedCount);
        const assignedCount = Number(item.assignedCount);
        const assignedNames = cleanText(item.assignedNames, 500);
        if (!existingIds.has(specialtyId) || !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 99 || !Number.isInteger(assignedCount) || assignedCount < 0 || assignedCount > 99) throw new Error('Invalid specialist assignment');
        update.run(requestedCount, assignedCount, assignedNames, id, specialtyId);
      }
    }

    if (nextStatus !== currentStatus || exceptionRequired) {
      const publicStatusNote = exceptionRequired ? `Согласовано исключение по срокам подачи: ${deadlineWarnings.join(' ')}` : ['clarification', 'rejected', 'cancelled'].includes(nextStatus) ? closingReason : '';
      db.prepare(`
        INSERT INTO portal_status_history (application_id, from_status, to_status, changed_by, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, currentStatus, nextStatus, session.accountId, publicStatusNote);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (error instanceof Error && error.message === 'Application revision conflict') return revisionConflict();
    if (error instanceof Error && error.message === 'Invalid specialist assignment') return Response.json({ error: 'Проверьте назначение специалистов' }, { status: 400 });
    throw error;
  }

  if (nextStatus !== currentStatus) {
    const organizationId = Number(current.organization_id);
    const title = `Статус заявки изменён: ${statusLabels[nextStatus]}`;
    const clarificationPrompt = nextStatus === 'clarification' ? '\nОткройте заявку в личном кабинете и нажмите «Внести уточнения».' : '';
    const message = `${eventTitle} · ${eventDate}${closingReason ? `\n${closingReason}` : ''}${clarificationPrompt}`;
    createNotification(organizationId, id, title, message);
    const organization = db.prepare('SELECT telegram_chat_id FROM portal_organizations WHERE id = ?').get(organizationId) as { telegram_chat_id: string | null } | undefined;
    await notifyTelegram(organization?.telegram_chat_id, `ГУТВ · заявка №${id}\n${statusLabels[nextStatus]}\n${message}`);
  }
  return Response.json({ application: serializeApplications(applicationRows('WHERE a.id = ?', [id]), true)[0] });
}
