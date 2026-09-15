import { briefTextError, filmingSlotsError, normalizeFilmingSlots, type FilmingSlot, type RequestKind } from '@/app/filming-brief';
import { saveFilmingBrief } from '@/app/server/filming-brief';
import { requestedSpecialistsError, type RequestedSpecialist } from '@/app/request-specialists';
import { deliveryDateError, needsDeliveryDate } from '@/app/request-deadlines';
import { filmingDateBounds } from '@/app/filming-validation';
import { applicationTextError } from '@/app/text-validation';
import { sameOriginRequest } from '@/app/auth';
import { notifyTelegram } from '@/app/server/telegram';
import { applicationRows, cleanText, requiredSession, serializeApplications } from '@/app/server/portal';
import { database } from '@/db/server';

export const runtime = 'nodejs';




export async function GET(request: Request) {
  const session = await requiredSession(request, 'requester');
  if (!session?.organizationId) return Response.json({ error: 'Требуется вход' }, { status: 401 });
  const db = database();
  const organization = db.prepare(`
    SELECT id, name, type, representative_name, contact FROM portal_organizations WHERE id = ?
  `).get(session.organizationId);
  const specialties = db.prepare(`
    SELECT id, name FROM portal_specialties WHERE active = 1 ORDER BY sort_order, name
  `).all();
  const applications = serializeApplications(
    applicationRows('WHERE a.organization_id = ?', [session.organizationId]),
    false,
  );
  return Response.json({ organization, specialties, applications, draftScope: `${session.accountId}:${session.organizationId}` });
}

export async function POST(request: Request) {
  const session = await requiredSession(request, 'requester');
  if (!session?.organizationId) return Response.json({ error: 'Требуется вход' }, { status: 401 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });

  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: 'Не удалось прочитать форму' }, { status: 400 }); }
  if ([...form.values()].some(value => value instanceof File)) return Response.json({ error: 'Загрузка файлов в заявки отключена' }, { status: 400 });
  const textError = applicationTextError(Object.fromEntries(form));
  if (textError) return Response.json({ error: textError }, { status: 400 });
  const requestKind = form.get('requestKind');
  const scenario = form.get('scenario');
  const participants = form.get('participants');
  const briefError = briefTextError(requestKind, scenario, participants);
  if (briefError) return Response.json({ error: briefError }, { status: 400 });
  const deliveryDate = needsDeliveryDate(requestKind) ? form.get('deliveryDate') : '';
  const deliveryError = deliveryDateError(requestKind, deliveryDate);
  if (deliveryError) return Response.json({ error: deliveryError }, { status: 400 });
  if (deliveryDate && String(deliveryDate) < filmingDateBounds().min) return Response.json({ error: 'Дата сдачи видеоматериала не может быть в прошлом' }, { status: 400 });
  if (form.get('rulesAccepted') !== 'true') return Response.json({ error: 'Подтвердите ознакомление с правилами подачи заявок' }, { status: 400 });
  let rawSlots: unknown;
  try { rawSlots = JSON.parse(String(form.get('slots') || 'null')); } catch { return Response.json({ error: 'Проверьте интервалы съёмки' }, { status: 400 }); }
  const slotError = filmingSlotsError(rawSlots);
  if (slotError) return Response.json({ error: slotError }, { status: 400 });
  const slots = normalizeFilmingSlots(rawSlots as FilmingSlot[]);
  const first = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const eventTitle = cleanText(form.get('eventTitle'), 160);
  const eventDate = first.startsAt.slice(0, 10), startTime = first.startsAt.slice(11), endTime = first.endsAt.slice(11), location = first.location;
  const eventDescription = cleanText(form.get('eventDescription'), 4000);
  const contactName = cleanText(form.get('contactName'), 120);
  const contactChannel = cleanText(form.get('contactChannel'), 120);
  if (eventTitle.length < 2 || eventDescription.length < 10 || contactName.length < 2 || contactChannel.length < 3) {
    return Response.json({ error: 'Заполните название, обоснование заявки и контактные данные' }, { status: 400 });
  }
  // Retain the legacy storage shape for old records and rollback compatibility.
  const requestedEquipment = 'Не запрашивается';
  const customerComment = '';
  const db = database();

  let rawSpecialists: unknown;
  try { rawSpecialists = JSON.parse(String(form.get('specialists') ?? '[]')); } catch { return Response.json({ error: 'Проверьте список специалистов' }, { status: 400 }); }
  const activeIds = (db.prepare('SELECT id FROM portal_specialties WHERE active = 1').all() as Array<{ id: number }>).map(item => item.id);
  const specialistError = requestedSpecialistsError(requestKind, rawSpecialists, activeIds);
  if (specialistError) return Response.json({ error: specialistError }, { status: 400 });
  const specialists = rawSpecialists as RequestedSpecialist[];

  let applicationId = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`
      INSERT INTO portal_applications (
        organization_id, created_by, event_title, event_date, start_time, end_time, location,
        event_description, requested_equipment, contact_name, contact_channel, customer_comment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(session.organizationId, session.accountId, eventTitle, eventDate, startTime, endTime, location, eventDescription, requestedEquipment, contactName, contactChannel, customerComment);
    applicationId = Number(result.lastInsertRowid);
    saveFilmingBrief(applicationId, { requestKind: requestKind as RequestKind, scenario: String(scenario).trim(), participants: String(participants).trim(), slots, deliveryDate: String(deliveryDate || ''), rulesAcceptedAt: new Date().toISOString() });
    const insertSpecialist = db.prepare('INSERT INTO portal_application_specialists (application_id, specialty_id, requested_count) VALUES (?, ?, ?)');
    specialists.forEach(item => insertSpecialist.run(applicationId, item.id, item.requestedCount));
    db.prepare(`
      INSERT INTO portal_status_history (application_id, from_status, to_status, changed_by, note)
      VALUES (?, NULL, 'review', ?, 'Заявка создана')
    `).run(applicationId, session.accountId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('Application creation failed', { message: error instanceof Error ? error.message : 'Unknown error' });
    return Response.json({ error: 'Не удалось сохранить заявку' }, { status: 500 });
  }

  const organization = db.prepare('SELECT name FROM portal_organizations WHERE id = ?').get(session.organizationId) as { name: string };
  await notifyTelegram(process.env.GUTV_TELEGRAM_ADMIN_CHAT_ID, `Новая заявка на съёмку GTV-${new Date().getFullYear()}-${String(applicationId).padStart(4, '0')}\n${organization.name}\n${eventTitle}\n${eventDate}, ${startTime}–${endTime}`);
  const application = serializeApplications(applicationRows('WHERE a.id = ?', [applicationId]), false)[0];
  return Response.json({ application }, { status: 201 });
}
