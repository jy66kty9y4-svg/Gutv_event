import assert from 'node:assert/strict';
import { filmingDateBounds } from '../app/filming-validation.ts';

// Called by the shared isolated fixture runner; never target production data.
export async function runAdminAuditChecks({ base, adminCookie, memberCookie }) {
  async function request(path, cookie, method = 'GET', body, expected = 200) {
    const response = await fetch(base + path, {
      method, headers: { cookie, origin: base, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  const dashboard = () => request('/api/admin/dashboard', adminCookie);
  const memberState = await request('/api/applications', memberCookie);
  const specialty = memberState.specialties[0];
  assert.ok(specialty, 'Fixture has at least one specialty');
  const date = filmingDateBounds(new Date(Date.now() + 14 * 86400000)).min;
  const fields = {
    eventTitle: `Аудит управления ${Date.now()}`, requestKind: 'trip',
    eventDescription: 'Изолированная проверка защиты изменений заявки', scenario: 'Выступления участников и интервью после мероприятия',
    participants: '12 человек', rulesAccepted: 'true', contactName: 'Тестовый представитель', contactChannel: '@audit_test',
    slots: JSON.stringify([{ startsAt: `${date}T12:00`, endsAt: `${date}T13:00`, location: 'Проверочная площадка' }]),
    specialists: JSON.stringify([{ id: specialty.id, requestedCount: 2 }]),
  };
  const form = new FormData(); Object.entries(fields).forEach(([key, value]) => form.set(key, value));
  let application = (await request('/api/applications', memberCookie, 'POST', form, 201)).application;
  const path = `/api/admin/applications/${application.id}`;
  const latest = async () => (await dashboard()).applications.find(item => item.id === application.id);
  const notifications = async () => (await request('/api/notifications', memberCookie)).notifications;
  assert.equal(application.revision, 1);
  const pristine = await latest();
  const untouchedNotifications = await notifications();
  for (const revision of [undefined, null, '1', 0, -1, 1.5]) {
    const result = await request(path, adminCookie, 'PATCH', { revision, eventTitle: 'Не должно сохраниться' }, 409);
    assert.equal(result.code, 'revision_conflict');
  }
  assert.deepEqual(await latest(), pristine, 'Missing/invalid revisions cannot mutate the application');
  assert.deepEqual(await notifications(), untouchedNotifications, 'Rejected revisions create no notifications');

  const first = (await request(path, adminCookie, 'PATCH', {
    revision: application.revision, scenario: 'Новый сценарий первого редактора, который необходимо сохранить',
  })).application;
  assert.equal(first.revision, application.revision + 1);
  const stale = await request(path, adminCookie, 'PATCH', {
    revision: application.revision, eventTitle: 'Старое название второго редактора', scenario: fields.scenario,
    status: 'approved', acceptRuleException: true,
    specialists: [{ id: specialty.id, requestedCount: 3, assignedCount: 1, assignedNames: 'Тестовый специалист' }],
  }, 409);
  assert.equal(stale.code, 'revision_conflict');
  assert.deepEqual(await latest(), first, 'Stale form preserves base fields, brief, slots, specialists and history');
  assert.deepEqual(await notifications(), untouchedNotifications, 'Stale decisions create no notification');

  await request(path, adminCookie, 'PATCH', {
    revision: first.revision, scenario: 'Этот сценарий тоже не должен сохраниться после rollback',
    status: 'approved', acceptRuleException: true,
    specialists: [{ id: specialty.id, requestedCount: 0, assignedCount: 1, assignedNames: 'Невалидное назначение' }],
  }, 400);
  assert.deepEqual(await latest(), first, 'Invalid assignment rolls back revision, brief, slots and decision');
  assert.deepEqual(await notifications(), untouchedNotifications, 'Rollback creates no notification');

  const simultaneous = await Promise.all(['Редактор А', 'Редактор Б'].map(internalComment => fetch(base + path, {
    method: 'PATCH', headers: { cookie: adminCookie, origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: first.revision, internalComment }),
  })));
  assert.deepEqual(simultaneous.map(response => response.status).sort(), [200, 409], 'Only one save can consume a revision');
  const winner = await simultaneous.find(response => response.status === 200).json();
  application = await latest();
  assert.equal(application.revision, first.revision + 1);
  assert.deepEqual(application, winner.application);

  await request(path, adminCookie, 'PATCH', { revision: application.revision, status: 'clarification', closingReason: '' }, 400);
  assert.deepEqual(await latest(), application, 'Clarification cannot be sent without a clear instruction');
  application = (await request(path, adminCookie, 'PATCH', {
    revision: application.revision, status: 'clarification', closingReason: 'Уточните место и программу съёмки',
  })).application;
  assert.ok(application.history.some(item => item.toStatus === 'clarification' && item.note === 'Уточните место и программу съёмки'));
  const clarificationNotice = (await notifications()).find(item => item.application_id === application.id && item.body?.includes('Внести уточнения'));
  assert.ok(clarificationNotice, 'Clarification directs the requester back to the application');

  for (const status of ['approved', 'in_progress', 'completed']) {
    application = (await request(path, adminCookie, 'PATCH', {
      revision: application.revision, status, ...(status === 'approved' ? { acceptRuleException: true } : {}),
    })).application;
    const state = await dashboard();
    const expected = state.applications.filter(item => item.eventDate >= filmingDateBounds().min && ['approved', 'in_progress'].includes(item.status)).length;
    assert.equal(state.stats.upcomingApplications, expected, `Upcoming count at ${status}`);
    assert.equal(application.status, status);
  }
  console.log('PASS admin audit API: revision conflicts, atomic rollback, simultaneous saves, upcoming statuses');
  return { applicationId: application.id, applicationNumber: application.number };
}

// page must already carry the synthetic admin cookie supplied by the fixture runner.
export async function runAdminBrowserChecks({ page, base, applicationId, applicationNumber }) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/management#applications`);
  const open = page.getByRole('button', { name: `Открыть заявку ${applicationNumber}`, exact: true });
  await open.waitFor(); await open.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.match(await dialog.locator('fieldset').first().locator('legend').textContent(), /Решение/);
  const title = dialog.locator('input[name="eventTitle"]');
  const originalTitle = await title.inputValue();
  await title.fill('Несохранённый черновик администратора');
  page.once('dialog', prompt => prompt.dismiss());
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await title.inputValue(), 'Несохранённый черновик администратора');
  page.once('dialog', prompt => prompt.dismiss());
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  assert.equal(await dialog.isVisible(), true, 'Dismissed confirmation preserves draft');

  const endpoint = `**/api/admin/applications/${applicationId}`;
  await page.route(endpoint, route => route.abort('failed'));
  await dialog.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  await page.waitForFunction(() => !document.querySelector('.management-drawer-actions button[type="submit"]')?.disabled);
  assert.equal(await title.inputValue(), 'Несохранённый черновик администратора');
  await page.unroute(endpoint);

  // Another editor saves while the first form remains open.
  const state = await (await page.request.get(`${base}/api/admin/dashboard`)).json();
  const latest = state.applications.find(item => item.id === applicationId);
  const otherSave = await page.request.patch(`${base}/api/admin/applications/${applicationId}`, {
    headers: { origin: base }, data: { revision: latest.revision, internalComment: 'Изменение другого редактора' },
  });
  assert.equal(otherSave.status(), 200);
  await dialog.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  const reload = dialog.getByRole('button', { name: 'Загрузить актуальную версию', exact: true });
  await reload.waitFor();
  assert.equal(await title.inputValue(), 'Несохранённый черновик администратора', 'Conflict never replaces the local form');
  page.once('dialog', prompt => prompt.dismiss());
  await reload.click();
  assert.equal(await title.inputValue(), 'Несохранённый черновик администратора');
  page.once('dialog', prompt => prompt.accept());
  await reload.click();
  await page.waitForFunction(expected => document.querySelector('.management-request-form input[name="eventTitle"]')?.value === expected, originalTitle);

  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.evaluate(element => { element.scrollTop = 0; });
  const saveBox = await dialog.getByRole('button', { name: 'Сохранить изменения', exact: true }).boundingBox();
  assert.ok(saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= 845, 'Save stays visible at 390px before scrolling');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.goto(`${base}/management#specialties`);
  const specialty = page.locator('form.management-add-specialty');
  await specialty.waitFor();
  await specialty.locator('input[name="name"]').fill('Несохранённая тестовая специальность');
  await page.route('**/api/admin/specialties', route => route.abort('failed'));
  await specialty.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('form.management-add-specialty button[type="submit"]')?.disabled);
  assert.match(await page.locator('.portal-alert.error').first().textContent(), /соединение|добавить/);
  assert.equal(await specialty.locator('input[name="name"]').inputValue(), 'Несохранённая тестовая специальность');
  await page.unroute('**/api/admin/specialties');
  console.log('PASS admin audit browser: dirty close, offline retry, conflict preserves form, explicit reload, mobile actions');
}
