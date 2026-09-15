import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

export async function runRequesterAuditChecks({ base, adminCookie, memberCookie, otherCookie, dbPath }) {
  const results = [];
  async function req(path, cookie, method = 'GET', body, origin = base) {
    const response = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(method === 'GET' ? {} : { origin, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  async function json(path, cookie, method = 'GET', body, expected = 200) {
    const { status, data } = await req(path, cookie, method, body); assert.equal(status, expected, `${method} ${path}: ${JSON.stringify(data)}`); return data;
  }
  const state = () => json('/api/applications', memberCookie);
  const application = async id => (await state()).applications.find(item => item.id === id);
  const notifications = async () => (await json('/api/notifications', memberCookie)).notifications;
  const tomorrow = new Date(Date.now() + 22 * 86400000).toISOString().slice(0, 10);
  const nextDay = new Date(Date.now() + 23 * 86400000).toISOString().slice(0, 10);
  const fields = { eventTitle: 'Аудит: уточнение заявки', requestKind: 'event', slots: [{ startsAt: tomorrow + 'T12:00', endsAt: tomorrow + 'T14:00', location: 'Тестовый зал' }], eventDescription: 'Проверяем безопасное уточнение существующей заявки', scenario: '12:00 — открытие; 13:00 — интервью с участниками', participants: '10–15 человек', rulesAccepted: true, contactName: 'Тестовый представитель', contactChannel: '@audit_fixture', specialists: [] };
  const form = changes => { const data = new FormData(); for (const [key, value] of Object.entries({ ...fields, ...changes })) data.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value)); return data; };
  let app = (await json('/api/applications', memberCookie, 'POST', form(), 201)).application;
  assert.ok(Number.isInteger(app.revision) && app.revision >= 1);
  const initial = app;
  const ownerState = await state(); assert.match(ownerState.draftScope, /^\d+:\d+$/);
  if (otherCookie) { const otherState = await json('/api/applications', otherCookie); assert.notEqual(otherState.draftScope, ownerState.draftScope); }
  results.push('account and organization scoped draft key');
  const path = `/api/applications/${app.id}`;
  const untouched = async (body, code) => { const before = await application(app.id), beforeNotes = await notifications(); await json(path, memberCookie, 'PATCH', body, code); assert.deepEqual(await application(app.id), before); assert.deepEqual(await notifications(), beforeNotes); };
  await untouched({ action: 'cancel' }, 409);
  await untouched({ action: 'cancel', revision: String(app.revision) }, 409);
  await untouched({ action: 'cancel', revision: 0 }, 409);
  await untouched({ action: 'resubmit', revision: app.revision, ...fields }, 409);
  assert.equal((await req(path, null, 'PATCH', { action: 'cancel', revision: app.revision })).status, 401);
  if (otherCookie) assert.equal((await req(path, otherCookie, 'PATCH', { action: 'cancel', revision: app.revision })).status, 404);
  assert.equal((await req(path, memberCookie, 'PATCH', { action: 'cancel', revision: app.revision }, 'https://not-gutv.invalid')).status, 403);
  results.push('cancel and resubmit require revision, correct owner and same origin');
  app = (await json(`/api/admin/applications/${app.id}`, adminCookie, 'PATCH', { revision: app.revision, status: 'clarification', closingReason: 'Уточните место и план съёмки' })).application;
  const body = { action: 'resubmit', revision: app.revision, ...fields, slots: [{ startsAt: tomorrow + 'T12:00', endsAt: tomorrow + 'T14:00', location: 'Уточнённый зал' }, { startsAt: tomorrow + 'T23:00', endsAt: nextDay + 'T02:00', location: 'Ночная площадка' }] };
  for (const invalid of [{ rulesAccepted: false }, { scenario: '' }, { participants: '-1' }, { eventTitle: 'x'.repeat(161) }, { contactChannel: '' }, { slots: [] }, { slots: [{ ...fields.slots[0], endsAt: tomorrow + 'T11:00' }] }, { requestKind: 'video', deliveryDate: '' }, { requestKind: 'trip', specialists: [] }, { specialists: [{ id: 9999999, requestedCount: 1 }] }]) await untouched({ ...body, ...invalid }, 400);
  results.push('invalid resubmissions preserve row, revision, brief, history and notifications');
  const notesBefore = (await notifications()).length;
  const saved = (await json(path, memberCookie, 'PATCH', body)).application;
  assert.equal(saved.id, initial.id); assert.equal(saved.number, initial.number); assert.equal(saved.createdAt, initial.createdAt); assert.equal(saved.status, 'review'); assert.equal(saved.revision, app.revision + 1); assert.equal(saved.closingReason, ''); assert.deepEqual(saved.brief.slots, body.slots);
  assert.equal(saved.history.length, app.history.length + 1); assert.equal((await notifications()).length, notesBefore + 1);
  await untouched(body, 409); await untouched({ action: 'cancel', revision: app.revision }, 409);
  results.push('resubmission keeps identity, returns to review and increments revision once; stale retry is inert');
  const cancelled = (await json(path, memberCookie, 'PATCH', { action: 'cancel', revision: saved.revision })).application;
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.revision, saved.revision + 1);
  await untouched({ action: 'cancel', revision: saved.revision }, 409);
  results.push('cancellation increments revision and rejects duplicate stale requests');
  const specialties = ownerState.specialties;
  assert.ok(specialties.length, 'fixture has specialties');
  let trip = (await json('/api/applications', memberCookie, 'POST', form({ eventTitle: 'Аудит: специалисты в уточнении', requestKind: 'trip', specialists: [{ id: specialties[0].id, requestedCount: 1 }] }), 201)).application;
  trip = (await json(`/api/admin/applications/${trip.id}`, adminCookie, 'PATCH', { revision: trip.revision, status: 'clarification', closingReason: 'Уточните количество специалистов' })).application;
  if (dbPath) {
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE portal_application_specialists SET assigned_count = 1, assigned_names = 'Назначенный тестовый оператор' WHERE application_id = ? AND specialty_id = ?").run(trip.id, specialties[0].id);
      const before = await application(trip.id), beforeNotes = await notifications();
      await json(`/api/applications/${trip.id}`, memberCookie, 'PATCH', { ...fields, action: 'resubmit', revision: trip.revision }, 400);
      assert.deepEqual(await application(trip.id), before); assert.deepEqual(await notifications(), beforeNotes);
      db.prepare('UPDATE portal_specialties SET active = 0 WHERE id = ?').run(specialties[0].id);
      await json(`/api/applications/${trip.id}`, memberCookie, 'PATCH', { ...fields, action: 'resubmit', revision: trip.revision, requestKind: 'trip', specialists: [{ id: specialties[0].id, requestedCount: 2 }] }, 400);
      const archivedSaved = (await json(`/api/applications/${trip.id}`, memberCookie, 'PATCH', { ...fields, action: 'resubmit', revision: trip.revision, requestKind: 'trip', specialists: [{ id: specialties[0].id, requestedCount: 1 }] })).application;
      assert.equal(archivedSaved.specialists[0].assignedNames, 'Назначенный тестовый оператор');
      trip = (await json(`/api/admin/applications/${trip.id}`, adminCookie, 'PATCH', { revision: archivedSaved.revision, status: 'clarification', closingReason: 'Уточните число специалистов' })).application;
      results.push('assigned positions cannot be deleted; archived positions retain unchanged counts and assignments');
    } finally { db.prepare('UPDATE portal_specialties SET active = 1 WHERE id = ?').run(specialties[0].id); db.close(); }
  }
  const tripSaved = (await json(`/api/applications/${trip.id}`, memberCookie, 'PATCH', { ...fields, action: 'resubmit', revision: trip.revision, requestKind: 'trip', specialists: [{ id: specialties[0].id, requestedCount: 3 }] })).application;
  assert.equal(tripSaved.specialists[0].requestedCount, 3); assert.equal(tripSaved.status, 'review');
  results.push('trip specialist selection and counts round trip through resubmission');
  let legacyId;
  if (dbPath) {
    const db = new DatabaseSync(dbPath);
    try {
      const org = db.prepare('SELECT o.id, a.id AS account_id FROM portal_organizations o JOIN portal_accounts a ON a.organization_id = o.id WHERE o.id = ? LIMIT 1').get(ownerState.organization.id);
      legacyId = Number(db.prepare("INSERT INTO portal_applications (organization_id, created_by, event_title, event_date, start_time, end_time, location, event_description, requested_equipment, internal_comment, contact_name, contact_channel, status) VALUES (?, ?, 'Аудит: старая заявка', '2020-01-01', '12:00', '14:00', 'Старый зал', 'Описание старого мероприятия', 'Старая камера', 'Сохранить служебную запись', 'Тестовый представитель', '@audit_fixture', 'clarification')").run(org.id, org.account_id).lastInsertRowid);
      const legacy = await application(legacyId); assert.equal(legacy.brief, null);
      const upgraded = (await json(`/api/applications/${legacyId}`, memberCookie, 'PATCH', { ...fields, action: 'resubmit', revision: legacy.revision })).application;
      assert.equal(upgraded.id, legacyId); assert.equal(upgraded.status, 'review'); assert.ok(upgraded.brief); assert.equal(upgraded.revision, legacy.revision + 1);
      assert.deepEqual({ ...db.prepare('SELECT requested_equipment, internal_comment FROM portal_applications WHERE id = ?').get(legacyId) }, { requested_equipment: 'Старая камера', internal_comment: 'Сохранить служебную запись' });
      results.push('legacy clarification upgrades in place while preserving equipment and internal notes');
    } finally { db.close(); }
  }
  // Leave an editable fixture for the shared browser run.
  const editable = (await json(`/api/admin/applications/${tripSaved.id}`, adminCookie, 'PATCH', { revision: tripSaved.revision, status: 'clarification', closingReason: 'Проверьте даты и количество специалистов перед отправкой' })).application;
  return { results, editableId: editable.id, editableNumber: editable.number, cancelledId: cancelled.id, legacyId };
}
