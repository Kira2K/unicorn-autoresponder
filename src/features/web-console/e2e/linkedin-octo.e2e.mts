import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import type { OctoService } from '../../octo-access/service.mts';
import { createLinkedInIntakeService } from '../../linkedin-automation/console-intake/service.mts';
import type { LinkedInIntake } from '../../linkedin-automation/console-intake/contracts.mts';
import {blockedHistoryCard} from '../../linkedin-automation/creation-tasks/blocked-history.mts';
const require = createRequire(import.meta.url);
const { createMockNocoClient } = require('../backend/mock-data.ts');
const { createWebConsoleRepository } = require('../backend/repository.ts');
const { createWebConsoleApp } = require('../backend/app.ts');
const express = require('express') as typeof import('express');
const noco = createMockNocoClient(), rows = await noco.fetchRecords('mxza381054ldlza');
const loginEmail = (id: number) => `intake-${id}@example.com`;
for (const [id, market] of [[903,'En'],[904,'Both'],[905,'Ru'],[906,'En'],[907,'En']] as const) rows.push({ Id: id, first_name: 'Alex', last_name: 'Test',
  client_name: `Intake ${id}`, calendar_email: loginEmail(id), market,
  real_location: 'Tbilisi', telegram_general_chat_id: `intake-test-${id}`, rel_clients_primary_stack: { Id: 14, name: 'REACT' } });
const { TABLES } = require('../../../integrations/noco/core/schema.ts');
(await noco.fetchRecords(TABLES.dolphinProfiles.id)).push({ Id: 999, clients_id: 906, locale: 'En', browser: 'dolphin', dolphin_profile_id: '999' });
const repository = createWebConsoleRepository({ nocoClient: noco });
const saved = new Map<number, LinkedInIntake>(), requests: Array<{ id: number; payload: unknown }> = [];
const recoveryTasks=new Map<number,any>();
const previousProfiles=new Map<number,number[]>(),priorLinkedIn=new Set<number>();
const profiles = new Map<number, any[]>();
const banned = new Set<number>();
const banVersions=new Map<number,string>(),archivedAccounts=new Map<number,any[]>();let banVersion=0;
function historyCard(id:number,data:LinkedInIntake,archived=false){return blockedHistoryCard({id,url:data.url,login:data.login,
  linkedin_first_name:data.firstName,linkedin_last_name:data.lastName,real_location:data.realLocation,has_password:!!data.password},archived)!;}
const empty = { url: '', login: '', hasPassword: false, outlookLogin: '', hasOutlookPassword: false,
  firstName: '', lastName: '', realLocation: '', blockedAccounts: [] };
const intake = createLinkedInIntakeService({ allowed: () => true, getClient: id => repository.getClientById(id),
  hasDolphin: async id => (await repository.getDolphinProfilesForClient(id)).length > 0, store: {
    async load(id) { const data = saved.get(id),task=recoveryTasks.get(id),history=[...(archivedAccounts.get(id)||[]),...(data&&banned.has(id)?[historyCard(id,data)]:[])]; return data ? { ...empty, ...data, linkedinAccountId:id,task,
      editableBlockedAccounts:data.blockedAccounts,archivedBlockedAccounts:history,blockedAccounts:[...data.blockedAccounts,...history],
      isBanned:banned.has(id),registrationPending:!!task&&task.status!=='выполнение подтверждено',completionConfirmed:task?.status==='выполнение подтверждено',
      editLocked:['сделана экспертом','выполнение подтверждено'].includes(task?.status),
      hadLinkedInBeforeTask:priorLinkedIn.has(id),previousOctoProfileIds:previousProfiles.get(id)||[],password: undefined, outlookPassword: undefined,
      octoConnectionPending:data.scenario==='existing'&&data.stage==='credentials', hasPassword: !!data.password, hasOutlookPassword: !!data.outlookPassword } : empty; },
    async reportBan(id,accountId){assert.equal(id,accountId);const wasBanned=banned.has(id);banned.add(id);if(!wasBanned)banVersions.set(id,`ban-version-${++banVersion}`);
      return{reported:true,linkedinAccountId:accountId,isBanned:true,...(!wasBanned?{banUndoVersion:banVersions.get(id)}:{})};},
    async cancelBan(id,accountId,version){assert.equal(id,accountId);assert.equal(version,banVersions.get(id));banned.delete(id);return{cancelled:true,linkedinAccountId:accountId,isBanned:false};},
    async save(id, data, _locales, options) {
      const created=data.scenario==='new'&&(!recoveryTasks.has(id)||!!data.replacesLinkedInAccountId);
      if(data.replacesLinkedInAccountId){priorLinkedIn.add(id);previousProfiles.set(id,(profiles.get(id)||[]).map(p=>p.id));
        archivedAccounts.set(id,[...(archivedAccounts.get(id)||[]),historyCard(id,saved.get(id)!,true)]);banned.delete(id);}
      saved.set(id, { ...structuredClone(data), password:data.password||saved.get(id)?.password||'' });
      if(created&&options?.createOctoProfiles&&!profiles.has(id))profiles.set(id,readyProfiles(false));
      if(created)recoveryTasks.set(id,{id,clientId:id,linkedinAccountId:id,outlookAccountId:id+1,status:'не начата',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      if(created)(await noco.fetchRecords(TABLES.platformAccounts.id)).push({Id:id,clients_id:id,platforms_id:16,
        rel_platformAccounts_platform:{Id:16,name:'linkedin'},url:'',login:''});
      return { saved: true, linkedinAccountId: id,...(recoveryTasks.has(id)?{task:{...recoveryTasks.get(id),created}}:{}) }; }
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
const preview = process.argv.includes('--preview');
const server = app.listen(preview ? 4317 : 0, '127.0.0.1');
await new Promise<void>(done => server.once('listening', done));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
if (preview) {
  console.log(`LinkedIn intake MOCK preview: ${url}`);
  console.log(`Login: ${loginEmail(907)}; password: 1234. Changes are stored in memory only.`);
  await new Promise<void>(() => {});
}
const browser = await chromium.launch({ headless: true });
async function login(id: number, context: BrowserContext) {
  await context.addInitScript(id => localStorage.setItem(`webConsole.octoWelcome.v1.${id}`, 'closed'), id);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(url); await page.getByTestId('email-input').fill(loginEmail(id));
  await page.locator('#password').fill('1234'); await page.getByTestId('login-button').click();
  return page;
}
try {
  for (const id of [907, 904]) {
    const instructionContext = await browser.newContext({ timezoneId: 'Europe/Warsaw' }), instructionPage = await login(id, instructionContext);
    const instructionCard = instructionPage.getByTestId('linkedin-octo-workflow');
    await instructionPage.getByTestId('telegram-card').waitFor();
    assert.equal(await instructionPage.locator('.accounts-card').evaluate(element =>
      !!(element.compareDocumentPosition(document.querySelector('[data-testid="telegram-card"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)), true,
      'platform accounts appear before Telegram for both EN and Both clients');
    await instructionCard.getByRole('button', { name: 'Нет LinkedIn / аккаунт заблокирован', exact: true }).click();
    const instruction = instructionCard.locator('details ol');
    assert.equal(await instruction.isVisible(), true);
    assert.deepEqual(await instruction.locator('li').allTextContents(), [
      'Создай новую почту на outlook.com с телефона через мобильный интернет. VPN выключи, твоя локация не имеет значения. Если ты в РФ, оставь VPN включенным.',
      'Адрес — имя.фамилия латиницей. Если занят — добавь цифры.',
      'Номер телефона к почте привязывать не нужно.',
      'Почте нужно «полежать» хотя бы сутки до регистрации LinkedIn, поэтому сделай её сегодня.',
      'Двухфакторку не ставь.'
    ]);
    const registration = instructionCard.getByLabel('Дата и время регистрации Outlook-почты', { exact: true });
    await instructionCard.getByRole('checkbox',{name:'У меня есть заблокированные аккаунты',exact:true}).check();
    assert.equal(await instructionCard.getByLabel('Имя и фамилия латиницей для нового аккаунта', { exact: true }).count(), 0);
    assert.equal(await instructionCard.getByLabel('Какие имя и фамилия стояли?', { exact: true }).count(), 1);
    await instructionCard.getByRole('button', { name: 'Удалить аккаунт 1', exact: true }).click();
    await instructionCard.getByRole('checkbox',{name:'У меня есть заблокированные аккаунты',exact:true}).uncheck();
    await registration.waitFor();
    assert.equal(await instructionCard.getByLabel('Город и страна проживания', { exact: true }).inputValue(), 'Tbilisi');
    assert.equal(await instructionCard.getByLabel('Город и страна проживания', { exact: true }).getAttribute('placeholder'), null);
    const form = instructionCard.getByTestId('linkedin-new-form');
    const submit = form.getByRole('button', { name: 'Сохранить и подготовить Octo', exact: true });
    await form.getByLabel('Город и страна проживания', { exact: true }).fill('Tbilisi');
    await form.getByLabel('Пароль от новой почты Outlook', { exact: true }).fill('outlook-secret');
    await form.getByLabel('Имя латиницей (как в иностранных документах)', { exact: true }).fill('Alex');
    await form.getByLabel('Фамилия латиницей (как в иностранных документах)', { exact: true }).fill('Test');
    const outlook = form.getByLabel('Логин от новой почты Outlook', { exact: true });
    await outlook.fill('test@outlook.com');
    await submit.click();
    assert.equal(saved.has(id), false, 'missing registration time prevents submission');
    assert.equal(await registration.getAttribute('type'), 'date');
    await form.getByText('Дата не может быть в будущем', { exact: true }).waitFor();
    await registration.fill('2099-01-01');
    await form.getByLabel('Часы регистрации Outlook-почты', { exact: true }).selectOption('10');
    await form.getByLabel('Минуты регистрации Outlook-почты', { exact: true }).selectOption('30');
    assert.equal(await registration.evaluate(input => (input as HTMLInputElement).checkValidity()), false);
    await submit.click();
    assert.equal(saved.has(id), false, 'future registration date prevents submission');
    await registration.fill('2026-10-25');
    await outlook.fill('test@gmail.com');
    await registration.focus();
    await form.getByRole('alert').waitFor();
    await submit.click();
    assert.equal(saved.has(id), false, 'non-Outlook address cannot be saved');
    await outlook.fill('test@outlook.com');
    await instructionPage.route('**/api/client/linkedin-intake', async route => {
      if (route.request().method() === 'PUT') await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"linkedin_intake_unavailable"}' });
      else await route.continue();
    });
    await submit.click();
    await instructionCard.getByText('Не удалось сохранить.', { exact: false }).waitFor();
    assert.equal(await instructionPage.getByRole('dialog').count(), 0, 'failure must not show success');
    await instructionPage.unroute('**/api/client/linkedin-intake');
    await submit.click();
    const dialog = instructionPage.getByRole('dialog', { name: 'Спасибо, данные сохранены ✅' });
    await dialog.waitFor();
    assert.equal(saved.get(id)?.outlookRegisteredAt, '2026-10-25T09:30:00.000Z');
    assert.ok((await dialog.textContent())?.includes('Мы начали создавать твой аккаунт LinkedIn. Обычно это занимает до 3 суток. Когда всё будет готово, мы тебе напишем.'));
    assert.ok((await dialog.textContent())?.includes('Пока ждёшь, пожалуйста, не заходи в профиль Octo: это может помешать регистрации.'));
    await instructionPage.setViewportSize({ width: 390, height: 844 });
    assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().width <= 390));
    await mkdir('tmp/linkedin-octo', { recursive: true });
    await instructionPage.screenshot({ path: 'tmp/linkedin-octo/outlook-saved-mobile.png', fullPage: true, animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Понятно', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await instructionPage.reload();
    await instructionCard.getByTestId('linkedin-new-form').waitFor();
    assert.equal(await instructionCard.locator('.scenario-buttons').count(),0);
    assert.equal(await registration.inputValue(), '2026-10-25');
    assert.equal(await instructionCard.getByLabel('Часы регистрации Outlook-почты', { exact: true }).inputValue(), '10');
    assert.equal(await instructionCard.getByLabel('Минуты регистрации Outlook-почты', { exact: true }).inputValue(), '30');
    assert.equal(await instructionPage.getByRole('dialog').count(), 0, 'reload does not reopen confirmation');
    const accountRow=instructionPage.getByTestId('accounts-table').locator('tbody tr').filter({has:instructionPage.getByRole('cell',{name:/^linkedin$/i})});
    await accountRow.getByText('В процессе создания',{exact:true}).waitFor();
    if(id===907){
      saved.set(id,{...saved.get(id)!,url:'https://linkedin.com/in/expert-draft',login:'draft@outlook.com'});
      for(const nextStatus of ['блок','сделана экспертом','выполнение подтверждено','блок']){
        recoveryTasks.get(id).status=nextStatus;
        await accountRow.getByText(nextStatus==='выполнение подтверждено'?'Активен':'В процессе создания',{exact:true}).waitFor({timeout:20000});
        assert.equal(await accountRow.getByText(nextStatus==='выполнение подтверждено'?'В процессе создания':'Активен',{exact:true}).count(),0);
      }
      await instructionPage.reload();await accountRow.getByText('В процессе создания',{exact:true}).waitFor();
      const record=(await noco.fetchRecords(TABLES.platformAccounts.id)).find((row:any)=>row.Id===id)!;
      record.is_banned=true;await instructionPage.reload();await accountRow.getByText('Заблокирован',{exact:true}).waitFor();
      assert.equal(await accountRow.getByText('В процессе создания',{exact:true}).count(),0,'ban status takes precedence');
      record.is_banned=false;
    }
    await instructionContext.close();
  }
  const context = await browser.newContext(), page = await login(903, context);
  const card = page.getByTestId('linkedin-octo-workflow');
  await card.getByRole('button', { name: 'У меня есть LinkedIn', exact: true }).click();
  await card.getByTestId('linkedin-step-1').locator(':scope > summary').click();
  const existing = card.getByTestId('linkedin-existing-form'); await existing.waitFor();
  assert.equal(await card.getByTestId('octo-manual-setup').count(),0,'LinkedIn comes before Octo');
  await existing.getByLabel('Ссылка на профиль',{exact:true}).fill('https://linkedin.com/in/test');
  await existing.getByLabel('Логин LinkedIn (email или телефон)',{exact:true}).fill('test@example.com');
  await existing.getByLabel('Пароль LinkedIn',{exact:true}).fill('li-secret');
  await existing.getByRole('button',{name:'Сохранить и перейти к Octo',exact:true}).click();
  await card.getByTestId('linkedin-step-2').locator(':scope > summary').click();
  const setup=card.getByTestId('octo-manual-setup');await setup.waitFor();
  assert.equal(saved.get(903)?.stage,'credentials');assert.equal(profiles.has(903),false);
  assert.equal(await page.getByTestId('linkedin-existing-saved-dialog').count(),0,'draft credentials do not confirm the connection');
  await page.reload();
  await card.getByTestId('linkedin-step-1').locator(':scope > summary').click();
  await card.getByTestId('linkedin-step-2').locator(':scope > summary').click();
  await existing.waitFor();await setup.waitFor();
  assert.equal(await existing.getByLabel('Логин LinkedIn (email или телефон)',{exact:true}).inputValue(),'test@example.com');
  await page.route('**/api/octo/profiles/status*',async route=>route.fulfill({json:{...status(903),onboarding:{id:'legacy-manual',source:'manual',phase:'awaiting_confirmation',score:64}}}));
  await setup.getByText('Предыдущая проверка остановилась на оценке качества.',{exact:false}).waitFor();
  assert.equal(await setup.getByRole('button',{name:'Проверить и подключить прокси',exact:true}).isEnabled(),true,'a legacy manual score gate must allow connectivity recheck');
  await setup.getByRole('button',{name:'Проверить и подключить прокси',exact:true}).click();
  await setup.getByText('Данные не отправлены.',{exact:false}).waitFor();
  await setup.getByLabel('Адрес прокси',{exact:true}).fill('proxy.example.com');
  await setup.getByLabel('Порт прокси',{exact:true}).fill('8080');
  await setup.getByLabel('Логин прокси',{exact:true}).fill('proxy-user');
  await setup.getByLabel('Пароль прокси',{exact:true}).fill('proxy-secret');
  await page.setViewportSize({width:393,height:852});
  await page.route('**/api/octo/onboarding',async route=>route.fulfill({status:422,contentType:'application/json',body:'{"error":"octo_proxy_check_failed"}'}));
  await setup.getByRole('button',{name:'Проверить и подключить прокси',exact:true}).click();
  await setup.getByText('Прокси не прошёл проверку.',{exact:false}).waitFor();
  assert.equal(await setup.getByLabel('Пароль прокси',{exact:true}).inputValue(),'proxy-secret');
  assert.equal(await setup.getByLabel('Адрес прокси',{exact:true}).inputValue(),'proxy.example.com');
  assert.ok(await setup.getByLabel('Пароль прокси',{exact:true}).evaluate(el=>el.getBoundingClientRect().width)>=120);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'tmp/linkedin-octo/existing-iphone15.png',fullPage:true,mask:[page.locator('input[type=password]')]});
  await page.unroute('**/api/octo/onboarding');
  await page.unroute('**/api/octo/profiles/status*');
  await setup.getByRole('button',{name:'Проверить и подключить прокси',exact:true}).click();
  await card.getByTestId('linkedin-step-3').locator(':scope > summary').click();
  await card.getByTestId('linkedin-step-4').locator(':scope > summary').click();
  await card.getByTestId('octo-profile-2').waitFor();
  assert.equal((requests[0].payload as {source:string}).source,'manual');
  assert.equal(await card.locator('.octo-proxy-settings').count(),0,'no duplicate editors in profile cards');
  assert.equal(await card.getByTestId('linkedin-existing-confirm').isDisabled(),true);
  await card.getByTestId('octo-profile-2').getByRole('button',{name:'Получить доступ',exact:true}).click();
  await card.getByRole('checkbox',{name:'Я успешно вошёл/вошла в LinkedIn через Octo',exact:true}).check();
  await page.route('**/api/client/linkedin-intake',async route=>route.request().method()==='PUT'
    ?route.fulfill({status:409,json:{error:'linkedin_intake_infrastructure_required'}}):route.continue());
  await card.getByTestId('linkedin-existing-confirm').click();
  await card.getByText('Сначала дождись настройки Octo и войди в LinkedIn через EN-профиль.',{exact:true}).waitFor();
  assert.equal(await page.getByTestId('linkedin-existing-saved-dialog').count(),0,'a rejected confirmation shows no success modal');
  await page.unroute('**/api/client/linkedin-intake');
  await card.getByTestId('linkedin-existing-confirm').click();
  await page.getByRole('dialog',{name:'LinkedIn успешно подключён ✅'}).waitFor();
  assert.equal(saved.get(903)?.stage,'complete');
  assert.equal(saved.get(903)?.password,'li-secret');
  assert.equal(recoveryTasks.has(903),false,'successful existing connection does not create an expert request');
  await page.getByRole('dialog',{name:'LinkedIn успешно подключён ✅'}).getByRole('button',{name:'Понятно',exact:true}).click();
  await page.reload(); await card.getByTestId('linkedin-step-1').locator(':scope > summary').click();
  await card.getByTestId('linkedin-existing-form').waitFor();
  assert.equal(await card.getByRole('button',{name:'Нет LinkedIn / аккаунт заблокирован',exact:true}).count(),0);
  await context.close();
  const second = await browser.newContext(), newPage = await login(904, second);
  const newCard = newPage.getByTestId('linkedin-octo-workflow');
  await newCard.getByTestId('linkedin-new-form').waitFor();
  assert.equal(await newCard.locator('.scenario-buttons').count(),0);
  const form = newCard.getByTestId('linkedin-new-form');
  await form.getByLabel('Логин от новой почты Outlook', { exact: true }).fill('new@outlook.com');
  await form.getByLabel('Пароль от новой почты Outlook', { exact: true }).fill('outlook-secret');
  await form.getByLabel('Имя латиницей (как в иностранных документах)', { exact: true }).fill('Alex');
  await form.getByLabel('Фамилия латиницей (как в иностранных документах)', { exact: true }).fill('Test');
  assert.equal(await form.getByLabel('Город и страна проживания', { exact: true }).inputValue(), 'Tbilisi', 'the saved intake location is restored on reopening');
  await form.getByLabel('Дата и время регистрации Outlook-почты', { exact: true }).fill('2026-10-25');
  await form.getByLabel('Часы регистрации Outlook-почты', { exact: true }).selectOption('10');
  await form.getByLabel('Минуты регистрации Outlook-почты', { exact: true }).selectOption('30');
  await form.getByRole('checkbox',{name:'У меня есть заблокированные аккаунты',exact:true}).check();
  for (let i = 0; i < 2; i++) await form.getByRole('button', { name: '＋ Добавить заблокированный аккаунт', exact: true }).click();
  const histories=[{fullName:'First',country:'UK',company:'One',position:'Developer',blockedAt:'2025-01-01'},
    {fullName:'Second',country:'Georgia',company:'Two',position:'Engineer',blockedAt:'2025-02-01'}];
  for(const [index,history] of histories.entries()){
    const inputs=form.locator('.blocked-account').nth(index).locator('input');
    for(const [field,value] of Object.values(history).entries())await inputs.nth(field).fill(value);
  }
  await form.getByRole('button', { name: 'Удалить аккаунт 3', exact: true }).click();
  assert.equal(await form.locator('.blocked-account').count(), 2);
  assert.equal(await form.getByText('Желаемый стек', { exact: false }).count(), 0);
  await form.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await newCard.getByText('Заявка обновлена', { exact: true }).waitFor();
  assert.deepEqual(saved.get(904)?.blockedAccounts, histories);
  assert.equal(requests.length, 1, 'new intake does not start a second manual proxy setup');
  await newPage.reload();
  await newCard.getByTestId('linkedin-new-form').waitFor();
  assert.equal(await newCard.locator('.blocked-account').count(), 2);
  assert.equal(await newCard.locator('.octo-card').count(), 0,'first registration hides freshly prepared profiles');
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
  (await noco.fetchRecords(TABLES.platformAccounts.id)).push({Id:9906,clients_id:906,platforms_id:16,
    rel_platformAccounts_platform:{Id:16,name:'linkedin'},url:'https://linkedin.com/in/existing-dolphin',login:'old@example.invalid'});
  await dolphinPage.reload(); await dolphinPage.getByTestId('open-dolphin-client-button').waitFor();
  const recovery=dolphinPage.getByTestId('linkedin-octo-workflow');
  await recovery.getByRole('button',{name:'Меня забанили',exact:true}).waitFor();
  assert.equal(await dolphinPage.getByRole('button',{name:'Меня забанили',exact:true}).count(),1);
  assert.equal(await dolphinPage.locator('.octo-card').count(),0);
  await recovery.getByRole('button',{name:'Меня забанили',exact:true}).click();
  await dolphinPage.getByRole('dialog',{name:'Попробуй восстановить LinkedIn'}).waitFor();
  assert.equal(banned.has(906),true,'ban is recorded before a replacement application');
  assert.equal(recoveryTasks.has(906),false,'ban alone does not create an application');
  await dolphinPage.getByRole('button',{name:'Прошла неделя — подать заявку',exact:true}).click();
  const recoveryForm=recovery.getByTestId('linkedin-new-form');await recoveryForm.waitFor();
  assert.equal(profiles.has(906),false,'opening recovery does not provision or mutate anything');
  const reported=recoveryForm.getByTestId('student-archived-account');
  await reported.getByText('Ссылка LinkedIn: https://linkedin.com/in/existing-dolphin',{exact:false}).waitFor();
  assert.equal(await reported.count(),1,'the reported account appears automatically before being archived');
  await dolphinPage.route('**/api/client/linkedin-intake/ban',async route=>route.request().method()==='DELETE'
    ?route.fulfill({status:409,json:{error:'linkedin_intake_ban_changed'}}):route.continue());
  await recovery.getByRole('button',{name:'Отмена',exact:true}).click();
  await recovery.getByText('Не удалось отменить блокировку:',{exact:false}).waitFor();
  assert.equal(banned.has(906),true);assert.equal(await recoveryForm.isVisible(),true,'failed cancellation keeps the draft visible');
  await dolphinPage.unroute('**/api/client/linkedin-intake/ban');
  await recovery.getByRole('button',{name:'Отмена',exact:true}).click();
  await recovery.getByTestId('linkedin-report-ban').waitFor();
  assert.equal(banned.has(906),false,'cancel restores the status changed by the same action');
  assert.equal(await recoveryForm.count(),0);assert.equal(recoveryTasks.has(906),false);assert.equal(profiles.has(906),false);
  await dolphinPage.reload();await recovery.getByTestId('linkedin-report-ban').waitFor();assert.equal(banned.has(906),false);
  banned.add(906);
  await recovery.getByTestId('linkedin-report-ban').click();
  await dolphinPage.getByRole('button',{name:'Прошла неделя — подать заявку',exact:true}).click();
  await recoveryForm.waitFor();await recovery.getByRole('button',{name:'Отмена',exact:true}).click();
  await recovery.getByTestId('linkedin-report-ban').waitFor();assert.equal(banned.has(906),true,'cancellation cannot undo a ban that already existed');
  await recovery.getByTestId('linkedin-report-ban').click();
  await dolphinPage.getByRole('button',{name:'Прошла неделя — подать заявку',exact:true}).click();
  await recoveryForm.waitFor();
  await recoveryForm.getByLabel('Логин от новой почты Outlook',{exact:true}).fill('replacement@outlook.com');
  await recoveryForm.getByLabel('Пароль от новой почты Outlook',{exact:true}).fill('replacement-fixture');
  await recoveryForm.getByLabel('Дата и время регистрации Outlook-почты',{exact:true}).fill('2026-10-25');
  await recoveryForm.getByLabel('Часы регистрации Outlook-почты',{exact:true}).selectOption('10');
  await recoveryForm.getByLabel('Минуты регистрации Outlook-почты',{exact:true}).selectOption('30');
  await recoveryForm.getByLabel('Город и страна проживания',{exact:true}).fill('Tbilisi');
  await recoveryForm.getByLabel('Имя латиницей (как в иностранных документах)',{exact:true}).fill('Alex');
  await recoveryForm.getByLabel('Фамилия латиницей (как в иностранных документах)',{exact:true}).fill('Test');
  await recoveryForm.getByRole('button',{name:'Сохранить данные',exact:true}).click();
  await dolphinPage.getByRole('dialog',{name:'Спасибо, данные сохранены ✅'}).waitFor();
  assert.equal(saved.get(906)?.replacesLinkedInAccountId,906);
  assert.equal(await recoveryForm.getByTestId('student-archived-account').count(),1,'archival retains one history entry for the reported account');
  assert.equal(await dolphinPage.getByTestId('open-dolphin-client-button').count(),1,'pending recovery retains access to the old Dolphin profiles');
  assert.equal(await dolphinPage.locator('.octo-card').count(),0,'new Octo profiles for Dolphin recovery stay hidden');
  assert.equal((await repository.getDolphinProfilesForClient(906)).length,1);
  await dolphin.close();
  console.log('LinkedIn/Octo mock browser flow passed: setup, checkpoint, two scenarios, blocked arrays, reload, RU/Dolphin routing, desktop/mobile.');
} finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
