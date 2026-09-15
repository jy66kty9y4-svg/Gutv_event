import assert from 'node:assert/strict';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { filmingDateBounds, filmingScheduleError, validFilmingDate } from '../app/filming-validation.ts';

const fixed = new Date('2026-08-31T21:30:00Z');
assert.deepEqual(filmingDateBounds(fixed), { min: '2026-09-01', max: '2027-03-01' }, 'Moscow date across UTC midnight');
assert.equal(filmingDateBounds(new Date('2026-08-31T12:00:00Z')).max, '2027-02-28', 'Six calendar months clamp end of month');
assert.equal(filmingDateBounds(new Date('2023-08-31T12:00:00Z')).max, '2024-02-29', 'Leap-year boundary');
assert.equal(validFilmingDate('2027-02-29'), false);
assert.equal(validFilmingDate('2028-02-29'), true);
assert.equal(filmingScheduleError('2026-09-01', '00:29', '01:00', fixed), 'Время начала съёмки уже прошло (московское время)');
assert.equal(filmingScheduleError('2026-09-01', '00:31', '01:00', fixed), null);

const work = await mkdtemp(join(tmpdir(), 'gutv-filming-test-'));
const dbPath = join(work, 'requests.sqlite');
const password = 'ПарольСъёмки2026!';
const salt = randomBytes(18);
const passwordRecord = `pbkdf2-sha256$210000$${salt.toString('base64url')}$${pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('base64url')}`;
const port = await new Promise((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const base = `http://127.0.0.1:${port}`;
let child, db, logs = '';
async function req(path, cookie, method = 'GET', body) {
  return fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(method === 'GET' ? {} : { origin: base, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
}
async function json(path, cookie, method = 'GET', body, expected = 200) {
  // Existing validation cases operate on the latest version; conflict cases live in test-audit-admin.mjs.
  const mutation = method === 'PATCH' && /^\/api\/(?:admin\/)?applications\/\d+$/.test(path);
  if (mutation && body && !Object.hasOwn(body, 'revision')) {
    const listPath = path.startsWith('/api/admin/') ? '/api/admin/dashboard' : '/api/applications';
    const latestResponse = await req(listPath, cookie);
    assert.equal(latestResponse.status, 200, 'Read latest revision before isolated validation mutation');
    const latest = await latestResponse.json();
    const current = latest.applications.find(item => item.id === Number(path.split('/').at(-1)));
    assert.ok(current, 'Application exists in its authorized collection');
    body = { ...body, revision: current.revision, ...(path.startsWith('/api/admin/') ? {} : { action: 'cancel' }) };
  }
  const response = await req(path, cookie, method, body); const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`); return result;
}
async function login(username) {
  const response = await req('/api/auth/login', null, 'POST', { username, password });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get('set-cookie').split(';')[0];
}
const registration = (name, username) => ({ organizationType: 'organization', organizationName: name, representativeName: 'Иван Иванов', contact: '@test_contact', username, password });
try {
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, GUTV_DATABASE_PATH: dbPath, GUTV_UPLOAD_PATH: join(work, 'uploads'), GUTV_SESSION_SECRET: randomBytes(32).toString('base64url'), GUTV_ADMIN_USERNAME: 'studio', GUTV_PASSWORD_RECORD: passwordRecord, GUTV_TELEGRAM_BOT_TOKEN: '', GUTV_TELEGRAM_ADMIN_CHAT_ID: '', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', c => { logs += c; }); child.stderr.on('data', c => { logs += c; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/')).ok) break; } catch { /* booting */ } if (child.exitCode !== null || i === 99) throw new Error(logs); await new Promise(resolve => setTimeout(resolve, 150)); }
  const admin = await login('studio');
  await json('/api/auth/register', null, 'POST', registration('Съёмки тест', 'съёмки-тест'), 201);
  let dashboard = await json('/api/admin/dashboard', admin);
  const org = dashboard.organizations.find(item => item.name === 'Съёмки тест');
  await json(`/api/admin/organizations/${org.id}`, admin, 'PATCH', { status: 'active' });
  const member = await login('СЪЁМКИ-ТЕСТ');
  assert.equal((await json('/api/auth/session', member)).user.displayName, 'Съёмки тест');
  await json('/api/auth/register', null, 'POST', registration('Отклонение тест', 'отклонение-тест'), 201);
  dashboard = await json('/api/admin/dashboard', admin);
  const pending = dashboard.organizations.find(item => item.name === 'Отклонение тест');
  for (const decisionNote of ['', ' '.repeat(5), 'я'.repeat(501)]) await json(`/api/admin/organizations/${pending.id}`, admin, 'PATCH', { status: 'rejected', decisionNote }, 400);
  await json(`/api/admin/organizations/${pending.id}`, admin, 'PATCH', { telegramChatId: 'я'.repeat(81) }, 400);
  await json(`/api/admin/organizations/${pending.id}`, admin, 'PATCH', { decisionNote: 123 }, 400);
  await json(`/api/admin/organizations/${pending.id}`, admin, 'PATCH', { telegramChatId: '1'.repeat(80), decisionNote: 'я'.repeat(500) });
  await json(`/api/admin/organizations/${pending.id}`, admin, 'PATCH', { telegramChatId: '', decisionNote: '' });
  assert.equal((await json('/api/admin/dashboard', admin)).stats.pendingOrganizations, 1);
  const specialties = (await json('/api/applications', member)).specialties;
  assert.ok(specialties.some(item => item.name === 'Рилсмейкер'));
  assert.ok(specialties.some(item => item.name === 'Специалист по видеопоказу'));
  assert.ok(!specialties.some(item => item.name === 'Режиссёр трансляции'));
  const tomorrow = filmingDateBounds(new Date(Date.now() + 24 * 60 * 60 * 1000)).min;
  const bounds = filmingDateBounds();
  const afterMax = new Date(new Date(bounds.max + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const slot = { startsAt: tomorrow + 'T12:00', endsAt: tomorrow + 'T13:00', location: 'Актовый зал' };
  const nextDay = new Date(new Date(tomorrow + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const overnight = { startsAt: tomorrow + 'T23:00', endsAt: nextDay + 'T02:00', location: 'Выездная площадка' };
  const fields = { eventTitle: 'Тестовая съёмка', requestKind: 'event', slots: JSON.stringify([slot, overnight]), eventDescription: 'Описание тестового мероприятия', scenario: 'Открытие, выступления и интервью с участниками', participants: '5–10 человек', rulesAccepted: 'true', contactName: 'Иван Иванов', contactChannel: '@test_contact' };
  const form = (changes = {}) => { const value = new FormData(); Object.entries({ ...fields, ...changes }).forEach(([k, v]) => value.set(k, v)); return value; };
  for (const date of ['0001-01-01', '0000-01-01', '2026-02-31', '2027-02-29', afterMax]) await json('/api/applications', member, 'POST', form({ slots: JSON.stringify([{ ...slot, startsAt: date + 'T12:00', endsAt: date + 'T13:00' }]) }), 400);
  for (const slots of [[], [null], [slot, slot], [slot, { ...slot, location: 'я'.repeat(241) }], [{ ...slot, endsAt: slot.startsAt }], [{ ...slot, endsAt: tomorrow + 'T11:59' }], [{ ...slot, endsAt: afterMax + 'T12:00' }], Array.from({ length: 13 }, (_, i) => ({ ...slot, location: 'Место ' + i }))]) await json('/api/applications', member, 'POST', form({ slots: JSON.stringify(slots) }), 400);
  for (const rulesAccepted of ['', 'false', 'on']) await json('/api/applications', member, 'POST', form({ rulesAccepted }), 400);
  for (const requestKind of ['', 'unknown']) await json('/api/applications', member, 'POST', form({ requestKind }), 400);
  for (const participants of ['', '0', 'ни одного', '-5', '−5', '0.5', '0,5', 'abc1', '10–5', '1e3']) await json('/api/applications', member, 'POST', form({ participants }), 400);
  for (const [key, limit] of Object.entries({ eventTitle: 160, eventDescription: 4000, scenario: 4000, participants: 80, contactName: 120, contactChannel: 120 })) await json('/api/applications', member, 'POST', form({ [key]: '1'.repeat(limit + 1) }), 400);
  const tripSpecialists = [{ id: specialties[0].id, requestedCount: 2 }, { id: specialties[1].id, requestedCount: 1 }];
  for (const specialists of ['[]', 'null', '{', JSON.stringify([null]), JSON.stringify([{ id: 999999, requestedCount: 1 }]), JSON.stringify([tripSpecialists[0], tripSpecialists[0]]), ...[0, -1, 1.5, 100, '2'].map(requestedCount => JSON.stringify([{ id: specialties[0].id, requestedCount }]))]) await json('/api/applications', member, 'POST', form({ requestKind: 'trip', specialists }), 400);
  await json('/api/applications', member, 'POST', form({ specialists: JSON.stringify(tripSpecialists) }), 400);
  await json(`/api/admin/specialties/${specialties[0].id}`, admin, 'PATCH', { active: false });
  await json('/api/applications', member, 'POST', form({ requestKind: 'trip', specialists: JSON.stringify(tripSpecialists) }), 400);
  await json(`/api/admin/specialties/${specialties[0].id}`, admin, 'PATCH', { active: true });
  for (const [field, content] of [['attachments', 'test file'], ['otherFile', 'test file'], ['attachments', '']]) {
    const upload = form(); upload.append(field, new Blob([content], { type: 'application/pdf' }), 'test.pdf');
    const rejectedUpload = await json('/api/applications', member, 'POST', upload, 400);
    assert.equal(rejectedUpload.error, 'Загрузка файлов в заявки отключена');
  }
  assert.equal((await json('/api/applications', member)).applications.length, 0, 'Invalid inputs never insert applications');
  const application = (await json('/api/applications', member, 'POST', form(), 201)).application;
  assert.deepEqual(application.brief.slots, [slot, overnight]);
  assert.equal(application.brief.scenario, fields.scenario); assert.equal(application.brief.participants, '5–10 человек');
  assert.equal(application.specialists.length, 0); assert.equal(application.customerComment, '');
  assert.ok(Date.parse(application.brief.rulesAcceptedAt));
  assert.deepEqual(application.attachments, []);
  assert.deepEqual((await json('/api/admin/dashboard', admin)).applications[0].brief, application.brief);
  await json(`/api/admin/applications/${application.id}`, admin, 'PATCH', { eventDate: '0001-01-01' }, 400);
  await json(`/api/admin/applications/${application.id}`, admin, 'PATCH', { scenario: 'я'.repeat(4001) }, 400);
  await json(`/api/admin/applications/${application.id}`, admin, 'PATCH', { scenario: null }, 400);
  for (const participants of ['-5', '0.5', 'abc1', '10–5', 5]) await json(`/api/admin/applications/${application.id}`, admin, 'PATCH', { participants }, 400);
  await json(`/api/admin/applications/${application.id}`, admin, 'PATCH', { slots: [slot, { ...overnight, endsAt: '0001-01-01T12:00' }] }, 400);
  assert.deepEqual((await json('/api/applications', member)).applications[0].brief, application.brief, 'Rejected updates are atomic');
  const changed = { ...slot, location: 'Новая аудитория' };
  await json(`/api/admin/applications/${application.id}`, admin, 'PATCH', { requestKind: 'event_video', deliveryDate: tomorrow, slots: [changed, overnight], scenario: 'Обновлённый план мероприятия и интервью', participants: '20 человек' });
  const saved = (await json('/api/applications', member)).applications[0];
  assert.equal(saved.brief.requestKind, 'event_video'); assert.equal(saved.location, changed.location);
  assert.equal(saved.brief.rulesAcceptedAt, application.brief.rulesAcceptedAt, 'Admin edits cannot change original consent');
  for (const acceptRuleException of [undefined, false, 'true']) await json(`/api/admin/applications/${application.id}`, admin, 'PATCH', { status: 'approved', acceptRuleException }, 400);
  assert.equal((await json('/api/applications', member)).applications.find(item => item.id === application.id).status, 'review');
  for (const deliveryDate of ['not-a-date', '2026-02-31', '0001-01-01']) await json('/api/applications', member, 'POST', form({ requestKind: 'video', deliveryDate }), 400);

  assert.equal((await json('/api/admin/dashboard', admin)).stats.reviewApplications, 1);
  for (const requestKind of ['video', 'event_video', 'trip']) {
    const created = (await json('/api/applications', member, 'POST', form({ requestKind, eventTitle: requestKind + ' заявка', specialists: JSON.stringify(requestKind === 'trip' ? tripSpecialists : []) }), 201)).application;
    assert.equal(created.brief.deliveryDate, '', 'Removed delivery field remains empty');
    if (requestKind === 'video') {
      await json(`/api/admin/applications/${created.id}`, admin, 'PATCH', { status: 'approved' });
      await json(`/api/admin/applications/${created.id}`, admin, 'PATCH', { status: 'clarification', closingReason: 'Уточнить описание контента' });
      const currentVideo = (await json('/api/applications', member)).applications.find(item => item.id === created.id);
      await json(`/api/applications/${created.id}`, member, 'PATCH', { ...fields, eventTitle: 'video заявка', action: 'resubmit', requestKind: 'video', revision: currentVideo.revision, rulesAccepted: true, slots: [slot, overnight], specialists: [] });
    }
    if (requestKind === 'trip') {
      assert.deepEqual(created.specialists.map(({ id, requestedCount }) => ({ id, requestedCount })), tripSpecialists);
      await json(`/api/admin/applications/${created.id}`, admin, 'PATCH', { specialists: created.specialists.map(item => ({ ...item, assignedCount: 1, assignedNames: 'Тестовый специалист' })) });
      const stored = (await json('/api/admin/dashboard', admin)).applications.find(item => item.id === created.id);
      assert.equal(stored.specialists[0].assignedNames, 'Тестовый специалист');
    }
    await json(`/api/applications/${created.id}`, member, 'PATCH', {});
  }
  // Existing applications retain legacy storage and can still be processed.
  db = new DatabaseSync(dbPath);
  const oldId = Number(db.prepare("INSERT INTO portal_applications (organization_id,created_by,event_title,event_date,start_time,end_time,location,event_description,requested_equipment,contact_name,contact_channel,status) VALUES (?,?,'Старая заявка','0001-01-01','12:00','13:00','Студия','Старое описание мероприятия','Камера','Иван Иванов','@test_contact','in_progress')").run(org.id, org.account_id).lastInsertRowid);
  await json(`/api/admin/applications/${oldId}`, admin, 'PATCH', { status: 'completed', internalComment: 'Закрыта старая заявка' });
  assert.equal((await json('/api/applications', member)).applications.find(item => item.id === oldId).brief, null);
  await json(`/api/applications/${oldId}/review`, member, 'POST', { rating: 5, comment: 'я'.repeat(2001) }, 400);
  await json(`/api/applications/${oldId}/review`, member, 'POST', { rating: 5, comment: 'я'.repeat(2000) });
  assert.equal((await json('/api/admin/dashboard', admin)).stats.reviewApplications, 1);
  const historical = (await json('/api/applications', member, 'POST', form({ requestKind: 'trip', eventTitle: 'Историческая новая форма', specialists: JSON.stringify(tripSpecialists) }), 201)).application;
  db.prepare("UPDATE portal_filming_slots SET starts_at = '2020-01-01T23:00', ends_at = '2020-01-02T02:00' WHERE application_id = ? AND sort_order = 0").run(historical.id);
  await json(`/api/admin/applications/${historical.id}`, admin, 'PATCH', { status: 'approved', acceptRuleException: true });
  const exception = (await json('/api/admin/dashboard', admin)).applications.find(item => item.id === historical.id);
  assert.match(exception.history[0].note, /Согласовано исключение по срокам подачи/);
  await json(`/api/admin/applications/${historical.id}`, admin, 'PATCH', { status: 'in_progress' });
  await json(`/api/admin/applications/${historical.id}`, admin, 'PATCH', { status: 'completed' });
  assert.equal((await json('/api/admin/dashboard', admin)).stats.reviewApplications, 1);
  assert.equal((await req('/cabinet/rules', member)).status, 200);
  assert.equal((await req('/cabinet/contacts', member)).status, 200);
  console.log('PASS filming API: Cyrillic auth, four request kinds, multiple/overnight slots, 6-month bounds, consent, text limits, atomic admin edits, legacy and historical completion');
  if (process.env.GUTV_BROWSER_TEST === '1') {
    const { runBrowserChecks } = await import('./test-filming-browser.mjs');
    await runBrowserChecks({ base, adminCookie: admin, memberCookie: member, output: join(process.cwd(), 'outputs/filming-checks') });
  }
} finally {
  db?.close();
  if (child && child.exitCode === null) await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
  await rm(work, { recursive: true, force: true });
}
