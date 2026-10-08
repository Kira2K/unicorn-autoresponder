import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkStudentEducation } from './student-education-check.mts';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const express = require('express');
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const artifacts = path.join(root, 'tmp/student-profile-e2e');
fs.mkdirSync(artifacts, { recursive: true });
// Serve only built assets; all API requests are intercepted. No backend, database or providers run.
const app = express(); app.use(express.static(path.join(root, 'dist/web-console')));
const server = await new Promise<any>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const url = `http://127.0.0.1:${server.address().port}`;
let browser: any;
let clientId = 1, enabled = true, failProfile = false, failAccount = false, pendingAccount = false;
let role = 'client', dolphinReads = 0, telegramReads = 0;
let failSecrets = false, pendingSecrets = false, releaseAccount: (() => void) | undefined, releaseSecrets: (() => void) | undefined;
const profileWrites: any[] = [], accountWrites: any[] = [], unexpected: string[] = [], errors: string[] = [];
const client = () => ({ id: clientId, studentProfileEnabled: enabled, clientName: 'Тестовый ученик',
  firstName: 'Кира', lastName: 'Самсонова', middleName: '', birthDate: '2000-04-20', englishLevelId: 1,
  readyForInterviewInEnglishIn2Months: 'No', realLocation: 'Moscow, Russia', desiredLocation: 'Remote',
  calendarEmail: `student${clientId}@gmail.com`, telegramPersonalChatId: '@kira_test', noHigherEducation: true,
  educationEntries: [], currentCompany: 'Alpha,Beta', previousCompanies: 'Gamma,Delta', stopListCompany: 'Alpha,Beta,Gamma,Delta' });
let dashboard: any = { client: client(), platformAccounts: [], linkedInEmail: '' };
const platforms = [{ id: 30, label: 'phone_ru' }, { id: 28, label: 'phone_en' }, { id: 24, label: 'telegram_ru' },
  { id: 10, label: 'hh_en' }, { id: 11, label: 'hh_ru' }, { id: 16, label: 'linkedin' }, { id: 29, label: 'github' }];
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', (error: Error) => errors.push(error.message));
  await page.route('**/*', async (route: any) => {
    const request = route.request(), parsed = new URL(request.url()), pathname = parsed.pathname;
    if (parsed.origin !== url) { unexpected.push(parsed.origin); return route.abort(); }
    if (!pathname.startsWith('/api/')) return route.continue();
    const reply = (body: any, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/auth/me') return reply({ role, email: `student${clientId}@gmail.com` });
    if (pathname === '/api/provider/clients') return reply({ clients: [] });
    if (pathname === '/api/admin/latest-client') return reply(dashboard);
    if (pathname === '/api/admin/telegram/senders') return reply({ senders: [] });
    if (pathname === '/api/telegram/status') { telegramReads++; return reply({ status: 'disconnected' }); }
    if (pathname === '/api/client/profile-options') return reply({ englishLevels: [{ id: 1, label: 'A1' }], platforms });
    if (pathname.startsWith('/api/dolphin/profiles/status')) { dolphinReads++; return reply({ action: 'open_existing' }); }
    if (pathname === '/api/client/me') {
      if (request.method() === 'PATCH') {
        const payload = request.postDataJSON(); profileWrites.push(payload);
        if (failProfile) return reply({ message: 'Тестовая ошибка профиля' }, 500);
        dashboard.client = { ...dashboard.client, ...payload };
      }
      return reply(dashboard);
    }
    if (/\/secrets$/.test(pathname)) {
      if (pendingSecrets) await new Promise<void>(resolve => { releaseSecrets = resolve; });
      return failSecrets ? reply({ message: 'Тестовая ошибка загрузки пароля' }, 500) : reply({ password: 'saved-secret', emailPassword: '' });
    }
    if (pathname.startsWith('/api/client/platform-accounts')) {
      const payload = request.postDataJSON(); accountWrites.push(payload);
      if (pendingAccount) await new Promise<void>(resolve => { releaseAccount = resolve; });
      if (failAccount) return reply({ message: 'Тестовая ошибка аккаунта' }, 500);
      const id = request.method() === 'POST' ? 1000 + accountWrites.length : Number(pathname.split('/').at(-1));
      const account = { id, ...dashboard.platformAccounts.find((a: any) => a.id === id), ...payload };
      dashboard.platformAccounts = [...dashboard.platformAccounts.filter((a: any) => a.id !== id), account];
      return reply(dashboard);
    }
    unexpected.push(pathname); return reply({ message: 'Unexpected test API' }, 500);
  });
  const byId = (id: string) => page.getByTestId(id);
  const submitAccount = () => byId('account-form').dispatchEvent('submit');
  await page.goto(url);
  await byId('validated-student-profile').waitFor();
  assert.equal(await byId('profile-form').count(), 0);
  assert.equal(await byId('accounts-table').getByText('Название', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(artifacts, 'desktop-profile.png'), fullPage: true });
  await byId('open-profile-editor-button').click();
  await byId('workplaces-editor').waitFor();
  assert.equal(await page.locator('[data-profile-field="realAge"] .auto-badge').count(), 0);
  const telegram = byId('profile-telegram'); await telegram.fill('@@kira_test'); assert.equal(await telegram.inputValue(), '@kira_test');
  const checks = byId('workplaces-editor').locator('input[type="checkbox"]');
  assert.deepEqual(await checks.evaluateAll((items: HTMLInputElement[]) => items.map(e => e.checked)), [true, true, false, false]);
  await checks.nth(0).uncheck(); await checks.nth(2).check();
  failProfile = true; await byId('profile-form').dispatchEvent('submit');
  await page.getByText('Тестовая ошибка профиля', { exact: true }).waitFor();
  assert.equal(await byId('profile-form').count(), 1);
  failProfile = false; await byId('profile-form').dispatchEvent('submit');
  await byId('profile-form').waitFor({ state: 'detached' });
  assert.equal(profileWrites.at(-1).currentCompany, 'Beta,Gamma');
  assert.equal(profileWrites.at(-1).previousCompanies, 'Alpha,Delta');
  await byId('open-profile-editor-button').click();
  assert.deepEqual(await checks.evaluateAll((items: HTMLInputElement[]) => items.map(e => e.checked)), [false, true, true, false]);
  await page.locator('#student-firstName').fill('123'); await byId('profile-form').dispatchEvent('submit');
  await byId('profile-validation-summary').waitFor(); assert.equal(profileWrites.length, 2);
  await page.locator('#student-firstName').fill('Кира');
  await byId('profile-form').getByRole('button', { name: 'Отмена', exact: true }).click();

  await checkStudentEducation(page, profileWrites);

  await byId('open-account-editor-button').click();
  await page.getByRole('dialog').waitFor();
  await page.locator('.p-dialog-mask').click({ position: { x: 5, y: 5 } });
  assert.equal(await page.getByRole('dialog').count(), 1);
  await byId('account-platform').selectOption('10');
  assert.match(await page.getByRole('dialog').innerText(), /Email для зарубежного рынка/);
  await byId('account-platform').selectOption('11'); assert.match(await page.getByRole('dialog').innerText(), /Email для ру рынка/);
  for (const platform of ['16', '29']) {
    await byId('account-platform').selectOption(platform);
    assert.match(await page.getByRole('dialog').innerText(), /ссылка без https:\/\//);
    assert.equal(await byId('account-url-info').count(), 0);
  }
  await byId('account-platform').selectOption('24');
  assert.match(await page.getByRole('dialog').innerText(), /Номер телефона/);
  await byId('account-nickname').fill('@@AliceЯ12_'); assert.equal(await byId('account-nickname').inputValue(), '@Alice12_');
  await byId('account-platform').selectOption('28');
  await byId('account-phone').fill('+44 (123) abc 45'); assert.equal(await byId('account-phone').inputValue(), '+4412345');
  await byId('account-platform').selectOption('30');
  await submitAccount(); assert.equal(accountWrites.length, 0);
  await byId('account-phone').fill('8 (999) 123-45-67'); assert.equal(await byId('account-phone').inputValue(), '+79991234567');
  failAccount = true; await submitAccount(); await byId('account-form-error').waitFor();
  assert.equal(await byId('account-phone').inputValue(), '+79991234567');
  failAccount = false; pendingAccount = true; await submitAccount();
  await page.waitForFunction(() => document.querySelector<HTMLFieldSetElement>('.account-form-fields')?.disabled);
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1);
  await submitAccount(); assert.equal(accountWrites.length, 2);
  assert.ok(releaseAccount); releaseAccount(); pendingAccount = false;
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await byId('edit-account-button').first().click();
  assert.equal(await byId('account-platform-locked').isDisabled(), true);
  await byId('account-phone').fill('+71111111111'); await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' }); assert.equal(accountWrites.length, 2);
  await byId('edit-account-button').first().click(); assert.equal(await byId('account-phone').inputValue(), '+79991234567');
  await byId('close-account-editor-button').click();

  // Preserve master password-loading behavior after extracting the form.
  dashboard.platformAccounts = [{ id: 2001, platformId: 10, platform: 'hh_en', accountLabel: 'hh_en', login: 'test@example.invalid', phone: '+4412345', password: '********' }];
  await page.reload(); await byId('edit-account-button').first().waitFor();
  pendingSecrets = true; await byId('edit-account-button').first().click();
  assert.equal(await byId('save-account-button').isDisabled(), true);
  await submitAccount(); assert.equal(accountWrites.length, 2);
  await page.waitForTimeout(50); assert.ok(releaseSecrets); releaseSecrets(); pendingSecrets = false;
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-testid="save-account-button"]')?.disabled);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, 'mobile-account.png'), fullPage: true });
  const box = await page.getByRole('dialog').boundingBox(); assert.ok(box && box.width <= 390 && box.x >= 0);
  await byId('save-account-button').click(); await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(accountWrites.at(-1).password, 'saved-secret');
  failSecrets = true; await byId('edit-account-button').first().click(); await byId('account-form-error').waitFor();
  assert.equal(await byId('save-account-button').isDisabled(), true); await byId('close-account-editor-button').click(); failSecrets = false;
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(artifacts, 'mobile-profile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  clientId = 2; dashboard = { client: client(), platformAccounts: [{ id: 2010, platformId: 24, platform: 'telegram_ru', isTelegramAccount: true }], linkedInEmail: '' };
  const priorDolphinReads = dolphinReads;
  await page.reload(); await byId('open-account-editor-button').waitFor();
  await byId('validated-student-profile').waitFor();
  assert.ok(dolphinReads > priorDolphinReads);
  await page.waitForTimeout(100); assert.ok(telegramReads > 0);
  await byId('open-profile-editor-button').click();
  await page.locator('#student-firstName').fill('Анна');
  await byId('profile-form').dispatchEvent('submit');
  await byId('profile-form').waitFor({ state: 'detached' });
  assert.equal(dashboard.client.id, 2); assert.equal(profileWrites.at(-1).firstName, 'Анна');
  await byId('open-account-editor-button').click(); await byId('account-form').waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1);
  await byId('account-platform').selectOption('24'); await byId('account-nickname').fill('@@Other123');
  assert.equal(await byId('account-nickname').inputValue(), '@Other123');
  await byId('close-account-editor-button').click();
  dashboard.platformAccounts = [];
  for (const nextRole of ['provider', 'admin']) {
    role = nextRole;
    await page.reload(); await byId(`${role}-dashboard`).waitFor();
    assert.equal(await byId('validated-student-profile').count(), 0);
    assert.equal(await page.locator('.student-preview').count(), 0);
  }
  role = 'client';
  clientId = 1; enabled = false; dashboard.client = client();
  await page.reload(); await byId('open-account-editor-button').waitFor();
  assert.equal(await byId('validated-student-profile').count(), 0);
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  console.log('Student profile browser checks passed: education T15/T15a/T16, two unrelated students, companies, modal, passwords, phone/Username, mobile, status loading and unchanged admin/provider views.');
} finally { releaseAccount?.(); releaseSecrets?.(); await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
