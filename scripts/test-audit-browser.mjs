import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startAuditFixture } from './audit-fixture.mjs';
import { runAdminAuditChecks, runAdminBrowserChecks } from './test-audit-admin.mjs';

const playwright = process.env.GUTV_PLAYWRIGHT_MODULE || pathToFileURL(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/test.mjs')).href;
const { chromium, expect } = await import(playwright);
const output = process.env.GUTV_AUDIT_OUTPUT || '/tmp/gutv-audit-fixed';
await mkdir(output, { recursive: true });
const fixture = await startAuditFixture();
const { base, adminCookie, memberCookie, json } = fixture;
const browser = await chromium.launch({ headless: true, executablePath: process.env.GUTV_BROWSER_PATH || '/Users/cabinpxrn/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const errors = [], checks = [];
async function context(cookie, width = 1440) {
  const result = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, reducedMotion: 'reduce' });
  if (cookie) await result.addCookies([{ name: 'gutv_session', value: cookie.slice('gutv_session='.length), url: base }]);
  const page = await result.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(45000);
  page.on('pageerror', e => errors.push(e.message)); page.on('requestfailed', request => { if (!request.url().includes('_rsc=') && request.failure()?.errorText !== 'net::ERR_ABORTED') console.log('REQUEST FAILED', request.url().replace(base, ''), request.failure()?.errorText); });
  return { context: result, page };
}
async function widthCheck(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`);
}
function ratio(a, b) {
  const lum = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const [x, y] = [lum(a), lum(b)].sort((x, y) => y - x); return (x + .05) / (y + .05);
}
async function createApplication(title) {
  const date = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
  const form = new FormData();
  Object.entries({ eventTitle: title, requestKind: 'event', slots: JSON.stringify([{ startsAt: date + 'T12:00', endsAt: date + 'T14:00', location: 'Тестовая аудитория 301' }]), eventDescription: 'Съёмка выступлений и интервью для университета.', scenario: '12:00 — открытие; 13:00 — интервью; 14:00 — завершение.', participants: '50–70 человек', rulesAccepted: 'true', contactName: 'Тестовый представитель', contactChannel: '@audit_fixture' }).forEach(([k, v]) => form.set(k, v));
  return (await json('/api/applications', memberCookie, 'POST', form, 201)).application;
}

try {
  const guest = await context(); const page = guest.page;
  for (const theme of ['light', 'dark']) {
    await page.goto(base, { waitUntil: 'load' });
    await page.getByRole('button', { name: theme === 'light' ? 'Светлая тема' : 'Тёмная тема', exact: true }).click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      for (const path of ['/', '/studio', '/directions']) {
        await page.goto(base + path, { waitUntil: 'load' });
        console.log(`CHECK ${path} ${theme} ${width}`);
        await widthCheck(page, `${path} ${theme} ${width}`);
        const request = page.locator('header .studio-request-link');
        await expect(request).toBeVisible();
        const box = await request.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 240, 'Request action is in the visible header');
        const active = page.getByRole('navigation', { name: 'Основная навигация' }).locator('[aria-current=page]');
        await expect(active).toHaveCount(1);
        const themeButton = await page.getByRole('button', { name: 'Светлая тема', exact: true }).boundingBox();
        assert.ok(themeButton.width >= 44 && themeButton.height >= 44, 'Theme controls have a usable touch area');
        if (width === 390 || width === 1440) await page.screenshot({ path: join(output, `public-${path === '/' ? 'home' : path.slice(1)}-${theme}-${width}.png`), fullPage: true });
      }
    }
  }
  checks.push('Public pages: 320/390/768/1440, light/dark, header action, navigation, touch targets');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: 'load' });
  await page.getByRole('link', { name: /Создать кабинет/ }).click();
  let dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.locator('[name=organizationName]').fill('Черновик регистрации аудита');
  await dialog.locator('[name=contact]').fill('@audit_draft');
  await dialog.locator('[name=password]').fill('NeverPersistPassword2026!');
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'Registration focus stays inside dialog');
  }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Создать кабинет/ })).toBeFocused();
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('[name=organizationName]')).toHaveValue('Черновик регистрации аудита');
  assert.ok(!(await page.evaluate(() => JSON.stringify(sessionStorage))).includes('NeverPersistPassword2026!'), 'Registration password is never stored in sessionStorage');
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await expect(page.getByRole('dialog').locator('[name=contact]')).toHaveValue('@audit_draft');
  dialog = page.getByRole('dialog');
  await dialog.locator('[name=representativeName]').fill('Представитель теста регистрации');
  await dialog.locator('[name=username]').fill('audit-browser-registration');
  await dialog.locator('[name=password]').fill(fixture.password);
  await dialog.getByRole('button', { name: 'Отправить регистрацию', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Регистрация на проверке' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Уточнить у директора/ })).toBeVisible();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('gutv-registration-draft-v1')), null);
  await dialog.getByRole('button', { name: 'Войти после подтверждения' }).click();
  await dialog.locator('[name=password]').fill(fixture.password);
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('рассмотрении');
  await page.keyboard.press('Escape');
  checks.push('Registration: same-page entry, draft survives close/reload, password excluded, modal Tab and Escape');

  for (const theme of ['light', 'dark']) {
    await page.goto(`${base}/?auth=login`, { waitUntil: 'load' });
    dialog = page.getByRole('dialog');
    await dialog.locator('[name=username]').fill('invalid-login');
    await dialog.locator('[name=password]').fill('invalid-password');
    await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: theme === 'light' ? 'Светлая тема' : 'Тёмная тема', exact: true }).click();
    const css = await dialog.locator('.auth-error').evaluate(el => { const c = getComputedStyle(el); return { color: c.color, background: c.backgroundColor, font: parseFloat(c.fontSize) }; });
    assert.ok(css.font >= 14, 'Error is readable');
    if (!css.background.startsWith('rgba')) assert.ok(ratio(css.color, css.background) >= 4.5, 'Error meets ordinary text contrast');
    await widthCheck(page, 'Login dialog');
    await page.screenshot({ path: join(output, `login-error-${theme}-390.png`), fullPage: false });
  }
  await page.goto(base + '/directions', { waitUntil: 'load' });
  await page.getByRole('link', { name: 'Выбрать видеоролик', exact: true }).click();
  dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.locator('[name=username]').fill('audit-member');
  await dialog.locator('[name=password]').fill(fixture.password);
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/cabinet\?new=1&kind=video/);
  await expect(page.locator('input[name=requestKind][value=video]')).toBeChecked();
  await guest.context.close();
  checks.push('Direction selection passes video through real login into requester form');
  checks.push('Login errors: light/dark, readable size, contrast, mobile fit');

  const member = await context(memberCookie, 390); const p = member.page;
  await p.goto(`${base}/cabinet?new=1&kind=video`, { waitUntil: 'load' });
  await expect(p.locator('input[name=requestKind][value=video]')).toBeChecked();
  await p.locator('[name=eventTitle]').fill('Черновик после перехода и перезагрузки');
  await p.locator('[name=scenario]').fill('Сценарий сохраняется после перехода в контакты и обратно.');
  const tomorrow = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
  await p.locator('[name=slotStart]').fill(tomorrow + 'T12:00');
  await p.locator('[name=slotEnd]').fill(tomorrow + 'T13:00');
  await p.locator('[name=slotLocation]').fill('Черновая площадка');
  await p.locator('[name=requestKind][value=trip]').check();
  const tripChoice = p.locator('[name=specialtyId]').first();
  await tripChoice.check();
  const draftSpecialtyId = await tripChoice.inputValue();
  await p.locator(`[name="specialtyCount-${draftSpecialtyId}"]`).fill('3');
  await p.locator('[name=requestKind][value=video]').check();
  await expect(p.locator('[name=eventTitle]')).toHaveValue('Черновик после перехода и перезагрузки');
  await p.locator('[name=requestKind][value=trip]').check();
  await expect(p.locator(`[name="specialtyCount-${draftSpecialtyId}"]`)).toHaveValue('3');
  await p.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await p.getByRole('navigation', { name: 'Разделы кабинета' }).getByRole('button', { name: 'Контакты', exact: true }).click();
  await p.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await p.getByRole('navigation', { name: 'Разделы кабинета' }).getByRole('button', { name: 'Новая заявка', exact: true }).click();
  await expect(p.locator('[name=eventTitle]')).toHaveValue('Черновик после перехода и перезагрузки');
  await expect(p.locator('[name=slotLocation]')).toHaveValue('Черновая площадка');
  await p.reload({ waitUntil: 'load' });
  await expect(p.locator('[name=scenario]')).toHaveValue('Сценарий сохраняется после перехода в контакты и обратно.');
  await expect(p.locator('[name=slotStart]')).toHaveValue(tomorrow + 'T12:00');
  await expect(p.locator('[name=requestKind][value=trip]')).toBeChecked();
  await expect(p.locator(`[name="specialtyId"][value="${draftSpecialtyId}"]`)).toBeChecked();
  await expect(p.locator(`[name="specialtyCount-${draftSpecialtyId}"]`)).toHaveValue('3');
  await expect(p.locator('.requester-draft-note')).toContainText('Восстановлен предыдущий черновик');
  await widthCheck(p, 'Requester form');
  await p.screenshot({ path: join(output, 'requester-draft-390.png'), fullPage: true });
  checks.push('Requester draft: text, dates and trip count survive type switches, Contacts and reload; restoration is explicit');

  let clarification = await createApplication('Заявка для уточнения в браузере');
  clarification = (await json(`/api/admin/applications/${clarification.id}`, adminCookie, 'PATCH', { revision: clarification.revision, status: 'clarification', closingReason: 'Уточните аудиторию и программу' })).application;
  await p.goto(`${base}/cabinet?view=history`, { waitUntil: 'load' });
  await p.getByRole('button', { name: `Открыть ${clarification.number}`, exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Внести уточнения', exact: true }).click();
  await expect(p.locator('[name=eventTitle]')).toHaveValue(clarification.eventTitle);
  await p.locator('[name=slotLocation]').fill('Несохранённая правка до конфликта');
  await p.locator('[name=rulesAccepted]').check();
  const changedClarification = (await json(`/api/admin/applications/${clarification.id}`, adminCookie, 'PATCH', { revision: clarification.revision, eventTitle: 'Обновлённое название от студии', closingReason: 'Новая просьба: проверьте актуальную площадку', slots: [{ ...clarification.brief.slots[0], location: 'Актуальная площадка студии' }] })).application;
  await p.getByRole('button', { name: 'Отправить уточнение', exact: true }).click();
  await expect(p.getByRole('dialog').getByRole('alert')).toContainText('Заявка уже изменена');
  await expect(p.locator('[name=slotLocation]')).toHaveValue('Несохранённая правка до конфликта');
  p.once('dialog', prompt => prompt.accept());
  await p.getByRole('button', { name: 'Загрузить актуальную версию', exact: true }).click();
  await expect(p.locator('[name=eventTitle]')).toHaveValue(changedClarification.eventTitle);
  await expect(p.getByRole('dialog').getByRole('heading', { name: changedClarification.eventTitle, exact: true })).toBeVisible();
  await expect(p.locator('.requester-edit-form')).toContainText(changedClarification.closingReason);
  await expect(p.locator('[name=slotLocation]')).toHaveValue('Актуальная площадка студии');
  clarification = changedClarification;
  await p.locator('[name=slotLocation]').fill('Уточнённая аудитория 405');
  await p.locator('[name=rulesAccepted]').check();
  await p.getByRole('button', { name: /Отправить уточнени[ея]|Отправить повторно/ }).click();
  await expect.poll(async () => (await json('/api/applications', memberCookie)).applications.find(a => a.id === clarification.id).status).toBe('review');
  const resubmitted = (await json('/api/applications', memberCookie)).applications.find(a => a.id === clarification.id);
  assert.equal(resubmitted.location, 'Уточнённая аудитория 405');
  assert.equal(resubmitted.revision, clarification.revision + 1);
  checks.push('Clarification: original form, conflict preserves draft, explicit reload refreshes snapshot, same application returns to review');

  const completed = await createApplication('Проверка восстановления отзыва');
  let current = completed;
  for (const status of ['approved', 'in_progress', 'completed']) current = (await json(`/api/admin/applications/${current.id}`, adminCookie, 'PATCH', { revision: current.revision, status, acceptRuleException: true })).application;
  await p.goto(`${base}/cabinet?view=history`, { waitUntil: 'load' });
  await p.getByRole('button', { name: `Открыть ${current.number}`, exact: true }).click();
  dialog = p.getByRole('dialog'); await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'Requester focus stays in the modal'); }
  await expect(dialog.getByRole('radio', { name: /3.*5/ })).toHaveCount(1);
  await dialog.getByRole('radio', { name: /3.*5/ }).click();
  await p.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: /4.*5/ })).toHaveAttribute('aria-checked', 'true');
  await dialog.locator('[name=comment]').fill('Проверка повтора после восстановления соединения.');
  const reviewUrl = `**/api/applications/${current.id}/review`;
  await p.route(reviewUrl, route => route.abort('internetdisconnected'));
  await dialog.getByRole('button', { name: /Отправить отзыв/ }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Отправить отзыв/ })).toBeEnabled();
  await p.screenshot({ path: join(output, 'requester-offline-error-390.png'), fullPage: false });
  await p.unroute(reviewUrl);
  await p.route(reviewUrl, route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Проверка видимой ошибки сервера' }) }));
  await dialog.getByRole('button', { name: /Отправить отзыв/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('Проверка видимой ошибки сервера');
  await p.unroute(reviewUrl);
  await dialog.getByRole('button', { name: /Отправить отзыв/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Ваш отзыв' })).toBeVisible();
  const saved = (await json('/api/applications', memberCookie)).applications.find(a => a.id === current.id);
  assert.equal(saved.review.rating, 4);
  assert.equal(saved.review.comment, 'Проверка повтора после восстановления соединения.');
  await p.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(p.getByRole('button', { name: `Открыть ${current.number}`, exact: true })).toBeFocused();
  checks.push('Requester modal and rating: focus, arrows, offline/HTTP400 visible, successful retry preserves content');
  await member.context.close();
  const adminFixture = await runAdminAuditChecks(fixture);
  const admin = await context(adminCookie);
  await runAdminBrowserChecks({ page: admin.page, base, ...adminFixture });
  await admin.page.screenshot({ path: join(output, 'admin-specialty-offline-390.png'), fullPage: false });
  await admin.context.close();
  checks.push('Admin: dirty close protection, offline retry, real revision conflict, explicit reload, mobile fixed actions');
  assert.deepEqual(errors, [], 'No unhandled browser exceptions');
  await writeFile(join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(checks.map(c => 'PASS ' + c).join('\n'));
} finally {
  await browser.close();
  await fixture.close();
}
