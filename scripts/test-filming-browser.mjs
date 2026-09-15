import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Runs against the isolated fixture server owned by test-filming-validation.mjs.
// Override GUTV_PLAYWRIGHT_MODULE with a playwright/test module URL when needed.
export async function runBrowserChecks({ base, adminCookie, memberCookie, output }) {
  const moduleUrl = process.env.GUTV_PLAYWRIGHT_MODULE || pathToFileURL(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/test.mjs')).href;
  const { chromium, expect } = await import(moduleUrl);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.GUTV_CHROMIUM_EXECUTABLE ? { executablePath: process.env.GUTV_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const [cookieName, ...cookieValue] = adminCookie.split(';')[0].split('=');
  await context.addCookies([{ name: cookieName, value: cookieValue.join('='), url: base }]);
  const page = await context.newPage();
  const errors = [], failedLocal = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400 && !(response.status() === 400 && response.request().method() === 'PATCH' && response.url().includes('/api/admin/applications/'))) failedLocal.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const dashboard = async () => {
    const response = await context.request.get(`${base}/api/admin/dashboard`);
    assert.equal(response.status(), 200);
    return response.json();
  };
  const patchApplication = async (id, changes, expected = 200) => {
    const current = (await dashboard()).applications.find(item => item.id === id);
    assert.ok(current && Number.isSafeInteger(current.revision), 'Read the current authorized application revision');
    const data = Object.hasOwn(changes, 'revision') ? changes : { ...changes, revision: current.revision };
    const response = await context.request.patch(`${base}/api/admin/applications/${id}`, { headers: { origin: base }, data });
    const result = await response.json();
    assert.equal(response.status(), expected, `PATCH application ${id}: ${JSON.stringify(result)}`);
    return result;
  };
  const badge = (name) => page.getByRole('navigation', { name: 'Разделы управления' }).getByRole('button', { name, exact: true }).locator('i');
  const checkBadge = async (name, count) => {
    if (count) await expect(badge(name)).toHaveText(String(count));
    else await expect(badge(name)).toHaveCount(0);
  };
  const checkWidth = async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile page must not overflow horizontally');
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) {
      const box = await dialog.boundingBox();
      assert.ok(box && box.x >= -1 && box.x + box.width <= 391, 'Mobile dialog fits viewport');
    }
  };
  try {
    await page.goto(`${base}/management#organizations`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Факультеты и организации', exact: true }).waitFor();
    const state = await dashboard();
    const organization = state.organizations.find(item => item.name === 'Отклонение тест');
    const application = state.applications.find(item => item.eventTitle === 'Тестовая съёмка');
    assert.equal(organization?.status, 'pending', 'Pending organization fixture is ready');
    assert.equal(application?.status, 'review', 'Review application fixture is ready');
    await checkBadge('Организации', state.stats.pendingOrganizations);
    await checkBadge('Заявки', state.stats.reviewApplications);
    await writeFile(join(output, 'management-dom.json'), JSON.stringify(await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('button')].map(element => ({ text: element.textContent.trim(), label: element.getAttribute('aria-label') })),
      headings: [...document.querySelectorAll('h1,h2,h3')].map(element => element.textContent.trim()),
    })), null, 2));
    await page.screenshot({ path: join(output, 'management-organizations-desktop.png'), fullPage: true });
    const orgCard = page.locator('.management-org-list article').filter({ has: page.getByRole('heading', { name: 'Отклонение тест', exact: true }) });
    await orgCard.getByRole('button', { name: 'Отклонить', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Отклонение тест', exact: true });
    await expect(dialog.getByLabel('Статус аккаунта')).toHaveValue('rejected');
    const reason = dialog.getByRole('textbox', { name: /^Причина отклонения регистрации/ });
    await expect(reason).toHaveAttribute('required', '');
    await expect(reason).toHaveAttribute('maxlength', '500');
    let decisions = 0;
    page.on('request', request => { if (request.method() === 'PATCH' && request.url() === `${base}/api/admin/organizations/${organization.id}`) decisions++; });
    await dialog.getByRole('button', { name: 'Отклонить регистрацию', exact: true }).click();
    assert.ok(await reason.evaluate(element => !element.checkValidity()), 'Empty rejection reason is invalid');
    assert.equal((await dashboard()).organizations.find(item => item.id === organization.id).status, 'pending');
    assert.equal(decisions, 0, 'Empty rejection reason does not submit a mutation');
    await dialog.getByRole('button', { name: 'Закрыть организацию', exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await checkWidth();
    await orgCard.getByRole('button', { name: 'Отклонить', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Отклонение тест', exact: true });
    await checkWidth();
    await dialog.getByRole('textbox', { name: /^Причина отклонения регистрации/ }).fill('Пожалуйста, уточните название и контакт представителя.');
    await page.screenshot({ path: join(output, 'registration-rejection-mobile.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Отклонить регистрацию', exact: true }).click();
    await expect(dialog.locator('.portal-detail-head em')).toHaveText('Отклонён');
    await checkBadge('Организации', state.stats.pendingOrganizations - 1);
    const rejected = (await dashboard()).organizations.find(item => item.id === organization.id);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.decision_note, 'Пожалуйста, уточните название и контакт представителя.');
    await dialog.getByRole('button', { name: 'Закрыть организацию', exact: true }).click();

    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.getByRole('navigation', { name: 'Разделы управления' }).getByRole('button', { name: 'Заявки', exact: true }).click();
    const applicationRow = page.getByRole('row').filter({ hasText: 'Тестовая съёмка' });
    await applicationRow.getByRole('button', { name: `Открыть заявку ${application.number}`, exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Тестовая съёмка', exact: true });
    await checkWidth();
    const unconstrained = await dialog.locator('input:not([type]),input[type=text],textarea').evaluateAll(elements => elements.filter(element => element.maxLength < 1).map(element => element.name));
    assert.deepEqual(unconstrained, [], 'All management text fields have explicit limits');
    await expect(dialog.locator('[name=slotStart]')).toHaveCount(2);
    await expect(dialog.locator('[name=scenario]')).toContainText('Обновлённый план');
    await expect(dialog.locator('[name=participants]')).toHaveValue('20 человек');
    await dialog.locator('[name=participants]').fill('-5');
    await dialog.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    assert.equal((await dashboard()).applications.find(item => item.id === application.id).brief.participants, '20 человек');
    await dialog.locator('[name=participants]').fill('20 человек');

    await dialog.locator('[name=contactName]').fill('');
    await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await expect(dialog.locator('.portal-alert.error')).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[name=contactName]')).toHaveValue('');
    await dialog.locator('[name=contactName]').fill(application.contactName);
    await expect(dialog.locator('[name=requestedEquipment]')).toHaveCount(0);
    const decision = dialog.locator('.management-decision');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const status of ['review', 'clarification', 'rejected', 'approved']) {
        await dialog.locator('select[name=status]').selectOption(status);
        const token = { review: '--ds-link', clarification: '--ds-warning', rejected: '--ds-danger', approved: '--ds-success' }[status];
        await expect.poll(() => decision.evaluate((el, token) => {
          const css = getComputedStyle(el);
          return css.getPropertyValue('--decision-color').trim() === css.getPropertyValue(token).trim();
        }, token)).toBe(true);
        if (status === 'approved' || status === 'rejected') {
          await decision.screenshot({ path: join(output, `admin-decision-${theme}-${status}.png`) });
        }
      }
    }

    await dialog.locator('select[name=status]').selectOption('approved');
    await expect(dialog.locator('.request-rule-notice')).toContainText('Пункт 3.1');
    await expect(dialog.locator('.request-rule-notice')).toContainText('Пункт 3.2');
    await dialog.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    assert.equal((await dashboard()).applications.find(item => item.id === application.id).status, 'review');
    await dialog.locator('[name=acceptRuleException]').check();
    await dialog.locator('.request-rule-notice').scrollIntoViewIfNeeded();
    assert.ok(await dialog.locator('.request-rule-notice .portal-alert').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Warning content fits mobile card');
    assert.ok((await dialog.locator('.request-rule-notice li').first().boundingBox()).width > 230, 'Warning text gets readable width');
    await page.screenshot({ path: join(output, 'deadline-exception-mobile.png'), fullPage: false });

    await dialog.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/#applications$/);
    await expect(applicationRow).toContainText('Согласована');
    await checkBadge('Заявки', state.stats.reviewApplications - 1);
    assert.equal((await dashboard()).applications.find(item => item.id === application.id).status, 'approved');
    await checkWidth();
    await page.screenshot({ path: join(output, 'applications-badge-mobile.png'), fullPage: true });
    assert.ok(memberCookie, 'Member cookie is required for requester form checks');
    const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const [memberName, ...memberValue] = memberCookie.split(';')[0].split('=');
    await memberContext.addCookies([{ name: memberName, value: memberValue.join('='), url: base }]);
    const memberPage = await memberContext.newPage();
    memberPage.on('pageerror', error => errors.push(error.message));
    memberPage.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) failedLocal.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    await memberPage.goto(`${base}/cabinet?new=1`, { waitUntil: 'networkidle' });
    await memberPage.getByRole('heading', { name: 'Новая заявка', exact: true }).waitFor();
    const requestForm = memberPage.locator('.portal-request-form');
    await writeFile(join(output, 'requester-form-dom.json'), JSON.stringify(await requestForm.locator('input,textarea,button').evaluateAll(elements => elements.map(element => ({ name: element.name, type: element.type, label: element.closest('label')?.textContent.trim(), min: element.min, max: element.max, maxLength: element.maxLength, text: element.tagName === 'BUTTON' ? element.textContent.trim() : undefined }))), null, 2));
    assert.equal(await requestForm.locator('[name=requestKind]').count(), 4);
    assert.equal(await requestForm.locator('input[type=file]').count(), 0, 'Request upload control removed');
    assert.equal(await requestForm.locator('[name=requestedEquipment],[name=customerComment],.portal-specialty-grid').count(), 0);
    assert.equal(await requestForm.getByText('Команда', { exact: true }).count(), 0);
    assert.equal(await requestForm.locator('.trip-specialists').count(), 0);
    await requestForm.locator('[name=requestKind][value=trip]').check();
    await expect(requestForm).toContainText('Рилсмейкер');
    await expect(requestForm).toContainText('Специалист по видеопоказу');
    await expect(requestForm).not.toContainText('Режиссёр трансляции');
    await expect(requestForm).toContainText('не позднее чем за 14 дней');
    const specialistChoice = requestForm.locator('[name=specialtyId]').first();
    await specialistChoice.check();
    const specialistId = await specialistChoice.inputValue();
    const specialistName = await specialistChoice.locator('..').locator('span').innerText();
    await requestForm.locator(`[name="specialtyCount-${specialistId}"]`).fill('2');
    for (const kind of ['event', 'video', 'event_video']) {
      await requestForm.locator(`[name=requestKind][value=${kind}]`).check();
      assert.equal(await requestForm.locator('[name=specialtyId]').count(), 0);
      assert.equal(await requestForm.locator('[name=deliveryDate]').count(), 0);
    }
    await requestForm.locator('[name=requestKind][value=trip]').check();
    assert.equal(await requestForm.locator(`[name="specialtyCount-${specialistId}"]`).inputValue(), '2');
    const date = requestForm.locator('[name=slotStart]').first();
    const minDate = await date.getAttribute('min'), maxDate = await date.getAttribute('max');
    assert.match(minDate, /^\d{4}-\d{2}-\d{2}T00:00$/); assert.match(maxDate, /^\d{4}-\d{2}-\d{2}T23:59$/);
    const [minYear, minMonth] = minDate.split('-').map(Number), [maxYear, maxMonth] = maxDate.split('-').map(Number);
    assert.equal((maxYear - minYear) * 12 + maxMonth - minMonth, 6);
    const memberUnconstrained = await requestForm.locator('input:not([type]),input[type=text],textarea').evaluateAll(elements => elements.filter(element => element.maxLength < 1).map(element => element.name));
    assert.deepEqual(memberUnconstrained, []);
    const title = requestForm.locator('input[name=eventTitle]');
    await title.fill('Я'.repeat(161)); assert.equal((await title.inputValue()).length, 160);
    await title.fill('Браузерная многодневная заявка');
    await requestForm.locator('[name=eventDescription]').fill('Проверка ограничений новой заявки через браузер');
    await requestForm.locator('[name=scenario]').fill('Открытие мероприятия, интервью и выступления участников');
    await requestForm.locator('[name=participants]').fill('5–10 человек');
    await requestForm.locator('[name=slotLocation]').fill('Студия тестирования');
    const tomorrow = new Date(new Date(minDate.slice(0, 10) + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
    const dayAfter = new Date(new Date(tomorrow + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
    await date.fill('0001-01-01T12:00');
    await requestForm.locator('[name=slotEnd]').fill(tomorrow + 'T13:00');
    assert.ok(await date.evaluate(element => element.validity.rangeUnderflow));
    let creations = 0;
    memberPage.on('request', request => { if (request.method() === 'POST' && request.url() === `${base}/api/applications`) creations++; });
    await requestForm.getByRole('button', { name: /^Отправить заявку/ }).click();
    await expect(requestForm.locator('.requester-form-feedback [role=alert]')).toHaveAttribute('role', 'alert');
    assert.equal(creations, 0);
    await date.fill(tomorrow + 'T12:00');
    await requestForm.getByRole('button', { name: /^Отправить заявку/ }).click();
    assert.equal(creations, 0, 'Consent must be checked before submit');
    await requestForm.locator('[name=rulesAccepted]').check();
    await requestForm.getByRole('button', { name: /Добавить дату или площадку/ }).click();
    await requestForm.locator('[name=slotStart]').nth(1).fill(tomorrow + 'T23:00');
    await requestForm.locator('[name=slotEnd]').nth(1).fill(dayAfter + 'T02:00');
    await requestForm.locator('[name=slotLocation]').nth(1).fill('Ночная выездная площадка');
    await requestForm.getByRole('button', { name: /Добавить дату или площадку/ }).click();
    await requestForm.getByRole('button', { name: 'Удалить интервал 3' }).click();
    await expect(requestForm.locator('[name=slotStart]')).toHaveCount(2);
    assert.equal(await requestForm.locator('[name=slotLocation]').nth(1).inputValue(), 'Ночная выездная площадка');
    const rulesLink = requestForm.getByRole('link', { name: 'правилами подачи заявок' });
    assert.equal(await rulesLink.getAttribute('target'), '_blank', 'Reading rules preserves filled form');
    assert.equal(await rulesLink.getAttribute('href'), '/cabinet/rules');
    assert.ok(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await memberPage.screenshot({ path: join(output, 'requester-new-mobile.png'), fullPage: true });
    await memberPage.setViewportSize({ width: 1440, height: 1000 });
    await memberPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const sidebar = memberPage.locator('.portal-sidebar');
    const rect = await sidebar.boundingBox();
    assert.ok(rect && Math.abs(rect.y) < 1 && rect.height === 1000, 'Desktop sidebar stays fixed at bottom of long form');
    await expect(sidebar.getByRole('button', { name: 'Правила', exact: true })).toBeVisible();
    await memberPage.screenshot({ path: join(output, 'requester-sidebar-scrolled.png'), fullPage: false });
    await memberPage.evaluate(() => window.scrollTo(0, 0));
    await memberPage.screenshot({ path: join(output, 'requester-new-desktop.png'), fullPage: true });
    await memberPage.getByRole('button', { name: 'Тёмная тема', exact: true }).click();
    await memberPage.screenshot({ path: join(output, 'requester-new-dark.png'), fullPage: true });
    await specialistChoice.uncheck();
    await requestForm.getByRole('button', { name: /^Отправить заявку/ }).click();
    await expect(requestForm.locator('.requester-form-feedback [role=alert]')).toContainText('Выберите хотя бы одного специалиста');
    assert.equal(creations, 0);
    await specialistChoice.check();
    const countField = requestForm.locator(`[name="specialtyCount-${specialistId}"]`);
    await countField.fill('1.5');
    await requestForm.getByRole('button', { name: /^Отправить заявку/ }).click();
    assert.equal(creations, 0);
    await countField.fill('2');
    for (const invalidCount of ['-5', '0.5', 'abc1', '10–5']) {
      await requestForm.locator('[name=participants]').fill(invalidCount);
      await requestForm.getByRole('button', { name: /^Отправить заявку/ }).click();
      assert.equal(creations, 0, 'Invalid participant count blocked before POST');
      await expect.poll(() => requestForm.locator('[name=participants]').evaluate(el => ({ value: el.value, customError: el.validity.customError }))).toEqual({ value: invalidCount, customError: true });
    }
    await requestForm.locator('[name=participants]').fill('5–10 человек');
    const createdPromise = memberPage.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${base}/api/applications`);
    await requestForm.getByRole('button', { name: /^Отправить заявку/ }).click();
    const creationResponse = await createdPromise;
    assert.equal(creationResponse.status(), 201); const created = (await creationResponse.json()).application;
    assert.equal(created.brief.requestKind, 'trip');
    assert.equal(created.specialists[0].requestedCount, 2);
    assert.equal(created.specialists[0].id, Number(specialistId));
    assert.equal(created.brief.slots.length, 2); assert.equal(created.brief.participants, '5–10 человек');
    assert.equal(created.brief.slots[1].endsAt, dayAfter + 'T02:00');
    await memberPage.getByRole('navigation', { name: 'Разделы кабинета' }).getByRole('button', { name: 'История', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      await memberPage.setViewportSize({ width: 1440, height: 1000 });
      await memberPage.getByRole('button', { name: theme === 'light' ? 'Светлая тема' : 'Тёмная тема', exact: true }).click();
      await expect(memberPage.locator('html')).toHaveAttribute('data-theme', theme);
      for (const width of [1440, 390]) {
        await memberPage.setViewportSize({ width, height: 1000 });
        await memberPage.evaluate(() => window.scrollTo(0, 0));
        const success = memberPage.locator('.portal-alert.success');
        await expect(success).toBeVisible();
        await expect(success.locator('span')).toHaveCSS('color', theme === 'light' ? 'rgb(38, 117, 84)' : 'rgb(122, 213, 171)');
        const search = memberPage.getByRole('textbox', { name: 'Поиск по заявкам', exact: true });
        assert.equal(await search.evaluate(el => getComputedStyle(el).borderTopWidth), '0px', 'Search has a single outer border');
        assert.equal(await search.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
        const open = memberPage.getByRole('button', { name: `Открыть ${created.number}`, exact: true });
        await expect.poll(() => open.evaluate(button => {
          const buttonBox = button.getBoundingClientRect(), iconBox = button.querySelector('svg').getBoundingClientRect();
          return Math.max(Math.abs(buttonBox.x + buttonBox.width / 2 - iconBox.x - iconBox.width / 2), Math.abs(buttonBox.y + buttonBox.height / 2 - iconBox.y - iconBox.height / 2));
        })).toBeLessThan(0.6);
        await expect(memberPage.locator('.portal-status.status-review').first()).toHaveCSS('color', theme === 'light' ? 'rgb(41, 63, 224)' : 'rgb(156, 170, 255)');
        await expect(memberPage.locator('.portal-table-wrap th').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        assert.ok(await memberPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await memberPage.screenshot({ path: join(output, `requester-controls-${theme}-${width}.png`), fullPage: true });
      }
    }
    await memberPage.setViewportSize({ width: 1440, height: 1000 });
    for (const status of ['clarification', 'approved', 'clarification']) {
      await patchApplication(created.id, { status, acceptRuleException: true, ...(status === 'clarification' ? { closingReason: 'Уточните программу мероприятия и место съёмки' } : {}) });
    }
    await memberPage.reload({ waitUntil: 'networkidle' });
    await memberPage.getByRole('button', { name: `Открыть ${created.number}`, exact: true }).click();
    const detail = memberPage.getByRole('dialog');
    await expect(detail.locator('.portal-timeline > div b')).toHaveText(['На рассмотрении', 'Требует уточнения', 'Согласована', 'Требует уточнения']);
    await expect(detail.locator('.portal-timeline > div').first()).toContainText('Заявка создана');

    await expect(detail).toContainText('Ночная выездная площадка');
    await expect(detail).toContainText(`${specialistName} — 2`);
    await expect(detail).toContainText('Открытие мероприятия, интервью');
    for (const theme of ['light', 'dark']) {
      await memberPage.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [1440, 390]) {
        await memberPage.setViewportSize({ width, height: 1000 });
        await expect(detail.locator('#request-detail-title')).toHaveCSS('font-size', width === 390 ? '24px' : '28px');
        await expect(detail.locator('.portal-detail-grid')).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(24, 24, 27)');
        await expect(detail.locator('.portal-cancel')).toHaveCSS('color', theme === 'light' ? 'rgb(186, 52, 78)' : 'rgb(241, 138, 154)');
        await expect(detail.locator('.portal-timeline > div > i').first()).toHaveCSS('box-shadow', 'none');
        await expect(detail.locator('.portal-timeline > div > i').last()).toHaveCSS('background-color', theme === 'light' ? 'rgb(41, 63, 224)' : 'rgb(156, 170, 255)');
        await expect(detail.locator('.portal-timeline > div > i').first()).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(24, 24, 27)');
        assert.ok(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Request detail fits horizontally');
        assert.ok(await detail.locator('.portal-detail-grid').evaluate(el => [...el.children].every(card => Math.abs(card.getBoundingClientRect().width - el.clientWidth) <= 1)), 'Detail rows occupy the full width');
        await detail.evaluate(el => el.scrollTop = 0);
        await memberPage.screenshot({ path: join(output, `request-detail-${theme}-${width}-top.png`) });
        await detail.locator('.portal-cancel').scrollIntoViewIfNeeded();
        await memberPage.screenshot({ path: join(output, `request-detail-${theme}-${width}-bottom.png`) });
      }
    }
    await memberPage.setViewportSize({ width: 1440, height: 1000 });

    await detail.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `Открыть заявку ${created.number}`, exact: true }).click();
    const tripDialog = page.getByRole('dialog');
    await expect(tripDialog).toContainText('Специалисты для выездной учёбы');
    await expect(tripDialog.locator(`[name="requested-${specialistId}"]`)).toHaveValue('2');
    await tripDialog.locator(`[name="assigned-${specialistId}"]`).fill('1');
    await tripDialog.locator(`[name="names-${specialistId}"]`).fill('Назначенный специалист');
    await tripDialog.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await expect(tripDialog).toHaveCount(0);
    await expect(page).toHaveURL(/#applications$/);
    assert.equal((await dashboard()).applications.find(item => item.id === created.id).specialists[0].assignedCount, 1);
    assert.equal((await dashboard()).applications.find(item => item.id === created.id).specialists[0].assignedNames, 'Назначенный специалист');

    await memberPage.reload({ waitUntil: 'networkidle' });
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await memberPage.evaluate(() => window.scrollTo(0, 900));
    assert.ok(Math.abs((await sidebar.boundingBox()).y) < 1, 'Mobile menu stays at top');
    await memberPage.getByRole('button', { name: 'Открыть меню' }).click();
    await memberPage.getByRole('navigation', { name: 'Разделы кабинета' }).getByRole('button', { name: 'Правила', exact: true }).click();
    await expect(memberPage.getByRole('heading', { name: 'Правила работы со студией' })).toBeVisible();
    await expect(memberPage.locator('.rules-points > li')).toHaveCount(20);
    assert.equal(await memberPage.locator('a[href="https://event.gutv.tech/rules"]').count(), 0);
    assert.ok(memberPage.url().endsWith('/cabinet/rules'));
    await memberPage.reload({ waitUntil: 'networkidle' });
    await expect(memberPage.getByRole('heading', { name: 'Правила работы со студией' })).toBeVisible();
    await memberPage.screenshot({ path: join(output, 'rules-mobile.png'), fullPage: true });
    await memberPage.getByRole('button', { name: 'Открыть меню' }).click();
    await memberPage.getByRole('navigation', { name: 'Разделы кабинета' }).getByRole('button', { name: 'Контакты', exact: true }).click();
    await expect(memberPage.getByRole('heading', { name: 'Контакты для связи' })).toBeVisible();
    for (const handle of ['pzr_enjoyer', 'mspieler', 's1ash2k']) assert.equal(await memberPage.getByRole('link', { name: new RegExp(handle) }).getAttribute('href'), `https://t.me/${handle}`);
    assert.ok(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await memberPage.screenshot({ path: join(output, 'contacts-mobile.png'), fullPage: true });
    assert.equal(await memberPage.locator('a[href="https://event.gutv.tech/contacts"]').count(), 0);
    await memberPage.setViewportSize({ width: 1440, height: 1100 });
    await memberPage.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await memberPage.locator('.cabinet-contact-person > span').first().evaluate(el => getComputedStyle(el).color), 'rgb(244, 244, 245)');
    await expect(memberPage.locator('.cabinet-contacts')).toHaveCSS('max-width', '672px');
    await expect(memberPage.locator('.cabinet-contact-person').first()).toHaveCSS('font-size', '16px');
    await memberPage.locator('.cabinet-contacts').screenshot({ path: join(output, 'contacts-desktop-dark.png') });
    await memberPage.getByRole('button', { name: 'Светлая тема', exact: true }).click();
    await memberPage.locator('.cabinet-contacts').screenshot({ path: join(output, 'contacts-desktop-light.png') });

    // Exercise both mobile shells and the long text that previously escaped request cards.
    for (const [surface, path, navigation, section] of [
      [page, '/management#applications', 'Разделы управления', 'Заявки'],
      [memberPage, '/cabinet?view=history', 'Разделы кабинета', 'История'],
    ]) {
      await surface.goto(base + path, { waitUntil: 'networkidle' });
      for (const width of [360, 390, 760]) {
        await surface.setViewportSize({ width, height: 844 });
        for (const theme of ['light', 'dark']) {
          await surface.getByRole('button', { name: 'Открыть меню', exact: true }).click();
          const menu = surface.locator('.portal-mobile-menu');
          const links = surface.getByRole('navigation', { name: navigation }).getByRole('button');
          assert.ok(await links.count() >= 6);
          assert.ok(await links.evaluateAll(items => items.every(item => {
            const box = item.getBoundingClientRect(), nav = item.closest('nav').getBoundingClientRect();
            return box.width > 0 && box.left >= nav.left && box.right <= nav.right + 1 && box.bottom <= nav.bottom + 1;
          })), 'Every mobile section fits inside the expanded menu');
          await surface.getByRole('button', { name: theme === 'light' ? 'Светлая тема' : 'Тёмная тема', exact: true }).click();
          await expect(surface.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(links.filter({ hasText: section })).toHaveCSS('color', theme === 'light' ? 'rgb(41, 63, 224)' : 'rgb(156, 170, 255)');
          await expect(links.filter({ hasText: section })).toHaveCSS('background-color', theme === 'light' ? 'rgb(239, 240, 252)' : 'rgb(34, 36, 59)');
          await expect(surface.getByRole('button', { name: 'Закрыть меню', exact: true })).toBeInViewport();
          const toggleBounds = await surface.getByRole('button', { name: 'Закрыть меню', exact: true }).boundingBox();
          assert.ok(toggleBounds.x >= 0 && toggleBounds.x + toggleBounds.width <= width && toggleBounds.y >= 0, JSON.stringify(toggleBounds));
          await expect(menu.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
          assert.ok(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
          await surface.screenshot({ path: join(output, `mobile-menu-${navigation === 'Разделы управления' ? 'admin' : 'member'}-${theme}-${width}.png`) });
          await surface.getByRole('navigation', { name: navigation }).getByRole('button', { name: section, exact: true }).click();
          await expect(menu).toBeHidden();
          const row = surface.locator('.portal-table-wrap tbody tr').first();
          await expect(row).toBeVisible();
          await row.evaluate(el => {
            el.querySelector('td:nth-child(2) b').textContent = 'ДлинноеНазваниеМероприятия'.repeat(8);
            el.querySelector('td:nth-child(3) small').textContent = '11:00–12:00 · ' + 'ДлинныйАдресПлощадки'.repeat(10);
          });
          assert.ok(await row.evaluate(el => {
            const box = el.getBoundingClientRect();
            return el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll('td')].every(cell => {
              const rect = cell.getBoundingClientRect();
              return cell.scrollWidth <= cell.clientWidth + 1 && rect.left >= box.left && rect.right <= box.right;
            });
          }), 'Long title and location stay inside the mobile card');
          assert.ok(await row.evaluate(el => {
            const text = el.querySelector('td:nth-child(3)').getBoundingClientRect(), button = el.querySelector('td:last-child button').getBoundingClientRect();
            return text.right <= button.left;
          }), 'Open button has its own space beside the date and location');
          assert.ok(await surface.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await surface.screenshot({ path: join(output, `mobile-cards-${navigation === 'Разделы управления' ? 'admin' : 'member'}-${theme}-${width}.png`) });
        }
      }
    }
    await memberContext.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(failedLocal, [], 'No failed local browser requests');
    await writeFile(join(output, 'browser-result.json'), JSON.stringify({ passed: true, tripSpecialists: true, deadlineExceptionRequired: true, fileUploadRemoved: true, rejection: true, emptyReasonBlocked: true, applicationBadge: [state.stats.reviewApplications, state.stats.reviewApplications - 1], pendingOrganizationBadge: [state.stats.pendingOrganizations, state.stats.pendingOrganizations - 1], requesterDateRange: [minDate, maxDate], historicDateBlocked: true, requesterTitleLimit: 160, viewport: [390, 844], errors, failedLocal }, null, 2));
    console.log('PASS browser: visible registration rejection, required reason, live queue badges, field/date limits, four request kinds, two persisted intervals, consent, conditional trip specialists and counts, saved assignments, required deadline exception, fixed desktop/mobile menu, rules and contacts.');
  } catch (error) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'failure-dom.txt'), await page.locator('body').innerText()).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}
