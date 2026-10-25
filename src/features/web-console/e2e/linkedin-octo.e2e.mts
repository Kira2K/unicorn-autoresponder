import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import type { OctoService } from '../../octo-access/service.mts';
import { createLinkedInIntakeService } from '../../linkedin-automation/console-intake/service.mts';
import type { LinkedInIntake } from '../../linkedin-automation/console-intake/contracts.mts';
const require = createRequire(import.meta.url);
const { createMockNocoClient } = require('../backend/mock-data.ts');
const { createWebConsoleRepository } = require('../backend/repository.ts');
const { createWebConsoleApp } = require('../backend/app.ts');
const express = require('express') as typeof import('express');
const noco = createMockNocoClient(), rows = await noco.fetchRecords('mxza381054ldlza');
for (const [id, market] of [[903,'En'],[904,'Both'],[905,'Ru'],[906,'En']] as const) rows.push({ Id: id, first_name: 'Alex', last_name: 'Test',
  client_name: `Intake ${id}`, calendar_email: `intake-${id}@example.com`, market,
  real_location: 'Tbilisi', telegram_general_chat_id: `intake-test-${id}`, rel_clients_primary_stack: { Id: 14, name: 'REACT' } });
const { TABLES } = require('../../../integrations/noco/core/schema.ts');
(await noco.fetchRecords(TABLES.dolphinProfiles.id)).push({ Id: 999, clients_id: 906, locale: 'En', browser: 'dolphin', dolphin_profile_id: '999' });
const repository = createWebConsoleRepository({ nocoClient: noco });
const saved = new Map<number, LinkedInIntake>(), requests: Array<{ id: number; payload: unknown }> = [];
const profiles = new Map<number, any[]>();
const empty = { url: '', login: '', hasPassword: false, outlookLogin: '', hasOutlookPassword: false,
  firstName: '', lastName: '', realLocation: '', blockedAccounts: [] };
const intake = createLinkedInIntakeService({ allowed: () => true, getClient: id => repository.getClientById(id),
  hasDolphin: async id => (await repository.getDolphinProfilesForClient(id)).length > 0, store: {
    async load(id) { const data = saved.get(id); return data ? { ...empty, ...data, password: undefined, outlookPassword: undefined,
      hasPassword: !!data.password, hasOutlookPassword: !!data.outlookPassword } : empty; },
    async save(id, data, _locales, options) { saved.set(id, structuredClone(data)); if (data.scenario === 'new' && options?.createOctoProfiles) profiles.set(id, readyProfiles(false));
      return { saved: true, linkedinAccountId: id }; }
  } });
function readyProfiles(proxy: boolean) { return [ { id: 1, locale: 'ru', title: 'RU test', phase: 'ready', canEditProxy: true, proxy: { configured: false } },
  { id: 2, locale: 'en', title: 'EN test', phase: 'ready', canEditProxy: true, proxy: { configured: proxy, ...(proxy ? { host: 'proxy.example.com', type: 'http', port: 8080 } : {}) } } ]; }
const status = (id: number) => ({ profiles: profiles.get(id) || [], requiredLocales: id === 905 ? ['ru'] : ['ru','en'], onboarding: { phase: 'idle' }, provisioning: { phase: 'ready' } });
const octo = {
  allowed: () => true, status: async (id: number) => status(id),
  async startOnboarding(id: number, payload: unknown) { requests.push({ id, payload }); profiles.set(id, readyProfiles(true)); return status(id); },
  async acquire() { return { id: 'grant-test', phase: 'preparing' }; },
  async grant() { return { id: 'grant-test', phase: 'granted', expiresAt: Date.now() + 120000, password: '01234' }; }
} as unknown as OctoService;
const app = createWebConsoleApp({ useMockData: true, repository, octoService: octo, linkedinIntake: intake });
app.use(express.static(resolve('dist/web-console')));
app.use((_req: unknown, res: import('express').Response) => res.sendFile(resolve('dist/web-console/index.html')));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(done => server.once('listening', done));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ headless: true });
async function login(id: number, context: BrowserContext) {
  await context.addInitScript(id => localStorage.setItem(`webConsole.octoWelcome.v1.${id}`, 'closed'), id);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(url); await page.getByTestId('email-input').fill(`intake-${id}@example.com`);
  await page.locator('#password').fill('1234'); await page.getByTestId('login-button').click();
  return page;
}
try {
  const context = await browser.newContext(), page = await login(903, context);
  const card = page.getByTestId('linkedin-octo-workflow');
  await card.getByRole('button', { name: 'У меня есть LinkedIn', exact: true }).click();
  assert.equal(await card.getByTestId('linkedin-existing-form').count(), 0);
  const setup = card.getByTestId('octo-manual-setup');
  await setup.getByLabel('Адрес прокси', { exact: true }).fill('proxy.example.com');
  await setup.getByLabel('Порт прокси', { exact: true }).fill('8080');
  await setup.getByLabel('Логин прокси', { exact: true }).fill('proxy-user');
  await setup.getByLabel('Пароль прокси', { exact: true }).fill('proxy-secret');
  await setup.getByRole('button', { name: 'Создать профили Octo' }).click();
  const existing = card.getByTestId('linkedin-existing-form'); await existing.waitFor();
  assert.equal((requests[0].payload as { source: string }).source, 'manual');
  assert.equal(await card.getByText('NodeMaven', { exact: false }).count(), 0);
  await existing.getByLabel('Ссылка на профиль', { exact: true }).fill('https://linkedin.com/in/test');
  await existing.getByLabel('Логин LinkedIn (email или телефон)', { exact: true }).fill('test@example.com');
  await existing.getByLabel('Пароль LinkedIn', { exact: true }).fill('li-secret');
  assert.equal(await existing.getByRole('button', { name: 'Сохранить', exact: true }).isDisabled(), true);
  assert.equal(await existing.getByRole('checkbox').isDisabled(), true);
  await card.getByTestId('octo-profile-2').getByRole('button', { name: 'Получить доступ', exact: true }).click();
  await existing.getByRole('checkbox').check();
  await existing.getByLabel('Ссылка на профиль', { exact: true }).fill('https://linkedin.com/in/test-new');
  assert.equal(await existing.getByRole('checkbox').isChecked(), false);
  await existing.getByRole('checkbox').check(); await existing.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await card.getByText('Данные LinkedIn сохранены.', { exact: true }).waitFor();
  assert.equal(saved.get(903)?.url, 'https://linkedin.com/in/test-new');
  await page.reload(); await card.getByTestId('linkedin-existing-form').waitFor();
  assert.equal(await card.getByRole('button', { name: 'Нет LinkedIn / аккаунт заблокирован', exact: true }).count(), 0);
  await context.close();
  const second = await browser.newContext(), newPage = await login(904, second);
  const newCard = newPage.getByTestId('linkedin-octo-workflow');
  await newCard.getByRole('button', { name: 'Нет LinkedIn / аккаунт заблокирован', exact: true }).click();
  const form = newCard.getByTestId('linkedin-new-form');
  await form.getByLabel('Логин от новой почты Outlook', { exact: true }).fill('new@outlook.com');
  await form.getByLabel('Пароль от новой почты Outlook', { exact: true }).fill('outlook-secret');
  await form.getByLabel('Имя латиницей (как в иностранных документах)', { exact: true }).fill('Alex');
  await form.getByLabel('Фамилия латиницей (как в иностранных документах)', { exact: true }).fill('Test');
  assert.equal(await form.getByLabel('Реальная локация', { exact: true }).inputValue(), 'Tbilisi');
  for (let i = 0; i < 3; i++) await form.getByRole('button', { name: '＋ Добавить заблокированный аккаунт', exact: true }).click();
  await form.locator('.blocked-account').nth(0).getByLabel('Какие имя и фамилия стояли?', { exact: true }).fill('First');
  await form.locator('.blocked-account').nth(1).getByLabel('Какая страна была указана?', { exact: true }).fill('UK');
  await form.getByRole('button', { name: 'Удалить аккаунт 3', exact: true }).click();
  assert.equal(await form.locator('.blocked-account').count(), 2);
  assert.equal(await form.getByText('Желаемый стек', { exact: false }).count(), 0);
  await form.getByRole('button', { name: 'Сохранить и подготовить Octo', exact: true }).click();
  await newCard.getByText('Данные сохранены. Подготавливаем профили Octo.', { exact: true }).waitFor();
  assert.deepEqual(saved.get(904)?.blockedAccounts, [{ fullName: 'First' }, { country: 'UK' }]);
  assert.equal(requests.length, 1, 'new intake does not start a second manual proxy setup');
  await newPage.reload();
  await newCard.getByRole('button', { name: 'Нет LinkedIn / аккаунт заблокирован', exact: true }).click();
  assert.equal(await newCard.locator('.blocked-account').count(), 2);
  assert.equal(await newCard.locator('.octo-proxy-settings[open]').count(), 0);
  await mkdir('tmp/linkedin-octo', { recursive: true });
  await newPage.screenshot({ path: 'tmp/linkedin-octo/new-account.png', fullPage: true });
  assert.ok(await newCard.evaluate(element => element.getBoundingClientRect().width > 800), 'desktop intake spans the dashboard');
  await newPage.setViewportSize({ width: 390, height: 844 });
  await newPage.screenshot({ path: 'tmp/linkedin-octo/new-account-mobile.png', fullPage: true });
  const dimensions = await newCard.evaluate(element => ({ width: element.getBoundingClientRect().width, scroll: element.scrollWidth, client: element.clientWidth }));
  assert.ok(dimensions.width <= 390 && dimensions.scroll <= dimensions.client, `mobile intake has no horizontal overflow: ${JSON.stringify(dimensions)}`);
  const stored = await newPage.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!stored.includes('outlook-secret') && !stored.includes('li-secret') && !stored.includes('proxy-secret'));
  await second.close();
  const ru = await browser.newContext(), ruPage = await login(905, ru);
  await ruPage.locator('.octo-card').waitFor();
  assert.equal(await ruPage.getByTestId('linkedin-octo-workflow').count(), 0);
  await ru.close();
  const dolphin = await browser.newContext(), dolphinPage = await login(906, dolphin);
  await dolphinPage.getByTestId('open-dolphin-client-button').waitFor();
  assert.equal(await dolphinPage.getByTestId('linkedin-octo-workflow').count(), 0);
  assert.equal(saved.has(906), false);
  assert.equal(profiles.has(906), false, 'Outlook preparation cannot create Octo replacements for Dolphin');
  assert.equal(await dolphinPage.locator('.octo-card').count(), 0);
  saved.set(906, { ...empty, scenario: 'existing', password: '', outlookPassword: '', loggedIn: false, url: 'https://linkedin.com/in/existing-dolphin' });
  await dolphinPage.reload(); await dolphinPage.getByTestId('open-dolphin-client-button').waitFor();
  assert.equal(await dolphinPage.getByTestId('linkedin-octo-workflow').count(), 0, 'Dolphin with existing LinkedIn keeps its current workflow');
  await dolphin.close();
  console.log('LinkedIn/Octo mock browser flow passed: setup, checkpoint, two scenarios, blocked arrays, reload, RU/Dolphin routing, desktop/mobile.');
} finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
