// Explicit, headful acceptance for the single operator-seeded proxy fixture.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { signIn } from './octo-console.e2e.mts';
import { createCloudApi } from '../../octo-access/cloud-api.mts';
import { createOctoApi } from '../../octo-access-test/octo-api.mts';
import { createOctoPostgresStore } from '../../octo-access/postgres-store.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { inFolder } from '../../octo-access/provision.mts';
import { OCTO_PROXY_CANDIDATE_COUNT } from '../../octo-access/proxy-checker.mts';

if (process.env.OCTO_E2E_PROXY_ONBOARDING !== '1' || !process.env.NODEMAVEN_API_KEY)
  throw Error('octo_proxy_fixture_opt_in_required');
const output = `tmp/octo-onboarding-live-${OCTO_PROXY_CANDIDATE_COUNT}`, url = 'http://127.0.0.1:4300';
const config = readPostgresAppDbConfig(process.env), pool = createPostgresPool(config);
const store = createOctoPostgresStore(pool, config.database), cloud = createCloudApi(process.env.OCTO_API_TOKEN!);
const desktop = createOctoApi(process.env.OCTO_API_TOKEN!, fetch, { debugPort: true });
const report: Record<string, any> = { passed: false, live: true, headful: true, candidateCount: OCTO_PROXY_CANDIDATE_COUNT,
  location: { country: 'ge', region: 'tbilisi', city: 'tbilisi' }, linkedinOpened: false };
const check = (ok: unknown, code: string) => { if (!ok) throw Error(code); };
const stage = (value: string) => { report.stage = value; console.log(JSON.stringify({ stage: value })); };
const until = async (read: () => Promise<boolean>, ms: number, code: string) => {
  const end = Date.now() + ms;
  do { if (await read()) return; await new Promise(done => setTimeout(done, 1000)); } while (Date.now() < end);
  throw Error(code);
};
const browser = await chromium.launch({ headless: false, slowMo: 100 });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
let opened: string | undefined, cdp: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
let consolePage: import('playwright').Page | undefined;
const granted: number[] = [];
try {
  await mkdir(output, { recursive: true });
  await context.route(/https?:\/\/([^/]+\.)?linkedin\.com(?::\d+)?\//i, r => r.abort());
  stage('login');
  const page = await signIn(context, url, 'octo.proxy.test@example.com', '1234');
  page.setDefaultTimeout(60_000);
  consolePage = page;
  page.on('response', async response => {
    if (response.url().includes('/api/octo/') && response.status() >= 400) {
      const body = await response.json().catch(() => ({}));
      const code = body?.error;
      report.apiError = { status: response.status(), path: new URL(response.url()).pathname,
        code: typeof code === 'string' && /^[a-z_]{1,100}$/.test(code) ? code : 'unknown' };
    }
  });
  const me = await (await context.request.get(url + '/api/auth/me')).json();
  check(me.role === 'client' && me.clientId > 0, 'fixture_session_invalid');
  const clientId = me.clientId; report.clientId = clientId;
  const sql = await pool.connect();
  try {
    const row = (await sql.query('SELECT client_name,calendar_email,client_status FROM noco.clients WHERE id=$1', [clientId])).rows[0];
    check(row?.client_name === 'Test For Octo Proxy creation' && row.calendar_email === 'octo.proxy.test@example.com'
      && row.client_status === 'paused', 'fixture_scope_invalid');
  } finally { sql.release(); }
  const previousSetup = (await store.clientState(clientId))?.setup;
  const resumeId = process.env.OCTO_E2E_RESUME_SETUP_ID;
  if (resumeId) {
    check(previousSetup?.id === resumeId && previousSetup.source === 'nodemaven' &&
      ['checking','provisioning','complete'].includes(previousSetup.phase) && previousSetup.location?.country === 'ge' &&
      previousSetup.location.region === 'tbilisi' && previousSetup.location.city === 'tbilisi', 'resume_setup_mismatch');
    report.resumedSetup = resumeId;
  } else check((await store.list(clientId)).length === 0 && !previousSetup, 'fixture_already_used');
  await page.locator('.octo-card').waitFor();
  check(await page.getByText('Профили Dolphin', { exact: true }).count() === 0, 'dolphin_visible_without_profiles');
  let startedAt = previousSetup?.createdAt ?? Date.now();
  if (!resumeId) {
  stage('proxy_wizard');
  await page.getByRole('button', { name: 'Сгенерировать NodeMaven прокси или протестировать свой', exact: true }).click();
  stage('save_key');
  if (await page.getByRole('button', { name: 'Изменить ключ', exact: true }).count())
    await page.getByRole('button', { name: 'Изменить ключ', exact: true }).click();
  await page.getByLabel('Ключ NodeMaven', { exact: true }).fill(process.env.NODEMAVEN_API_KEY!);
  await page.getByRole('button', { name: 'Сохранить ключ', exact: true }).click();
  stage('select_country');
  await page.getByRole('combobox', { name: 'Страна', exact: true }).selectOption('ge');
  stage('select_region');
  await page.getByRole('combobox', { name: 'Регион', exact: true }).selectOption('tbilisi');
  stage('select_city');
  await page.getByRole('combobox', { name: 'Город', exact: true }).selectOption('tbilisi');
  stage('submit_setup');
  startedAt = Date.now();
  const response = page.waitForResponse(r => r.url().endsWith('/api/octo/onboarding') && r.request().method() === 'POST');
  await page.getByTestId('octo-setup-form').getByRole('button', { name: 'Проверить прокси и создать профили', exact: true }).click();
  check((await response).status() === 202, 'onboarding_rejected');
  stage(`checking_${OCTO_PROXY_CANDIDATE_COUNT}_proxies`);
  await page.getByText('Проверка может занять до 4 минут.', { exact: true }).waitFor();
  }
  await until(async () => {
    const state = await store.clientState(clientId);
    if (['blocked','unknown'].includes(state?.setup?.phase ?? '')) {
      report.externalError = state?.setup?.error; throw Error('onboarding_failed');
    }
    if (state?.setup?.phase === 'complete') { report.checkScore = state.setup.score; return true; }
    return false;
  }, 900_000, 'onboarding_timeout');
  report.onboardingSeconds = Math.round((Date.now() - startedAt) / 1000);
  const profiles = await store.list(clientId), en = profiles.find(p => p.locale === 'en');
  check(profiles.length === 2 && profiles.some(p => p.locale === 'ru') && en?.uuid && en.proxy && profiles.every(p => p.phase === 'ready'), 'profiles_not_ready');
  check(profiles.every(p => p.password === en!.password) && /^\d{5}$/.test(en!.password), 'client_passwords_differ');
  report.profileIds = profiles.map(p => p.id); report.sharedPasswordVerified = true;
  const status = await (await context.request.get(url + '/api/octo/profiles/status')).text();
  check(!status.includes(process.env.NODEMAVEN_API_KEY!) && !status.includes(en!.password), 'status_leaks_credentials');
  await page.getByText('Профили созданы, прокси подключён.', { exact: false }).waitFor();
  stage('grant_via_ui');
  for (const profile of profiles) {
    const card = page.getByTestId(`octo-profile-${profile.id}`);
    await card.getByRole('button', { name: 'Получить доступ', exact: true }).click(); granted.push(profile.id);
    const field = card.getByRole('textbox', { name: 'Пароль к профилям (пароли идентичны для всех твоих профилей)', exact: true });
    await field.waitFor({ timeout: 90_000 });
    check(await field.inputValue() === en!.password, 'ui_password_mismatch');
  }
  await page.locator('.octo-card').screenshot({ path: `${output}/console.png`, mask: [page.locator('input')] });
  stage('open_en'); opened = en!.uuid!;
  const started = await desktop.startProfile(opened, en!.password);
  check(started.debug_port, 'debug_port_missing');
  cdp = await chromium.connectOverCDP(`http://127.0.0.1:${started.debug_port}`);
  const remote = cdp.contexts()[0];
  await remote.route(/https?:\/\/([^/]+\.)?linkedin\.com(?::\d+)?\//i, r => r.abort());
  const checkPage = await remote.newPage();
  stage('outbound_ip');
  await checkPage.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const ip = JSON.parse(await checkPage.locator('body').innerText()).ip;
  check(typeof ip === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip), 'outbound_ip_invalid');
  report.exitIp = ip;
  stage('scamalytics');
  await checkPage.goto(`https://scamalytics.com/ip/${ip}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const content = await checkPage.locator('body').innerText();
  await checkPage.screenshot({ path: `${output}/scamalytics.png`, fullPage: true });
  check(content.includes(ip) && /\bTbilisi\b/i.test(content), 'scamalytics_tbilisi_not_confirmed');
  report.scamalyticsTbilisi = true;
} catch (error) {
  if (consolePage) await consolePage.screenshot({ path: `${output}/failure.png`, fullPage: true, mask: [consolePage.locator('input')] }).catch(() => {});
  const code = (error as any)?.code ?? (error as Error)?.message ?? '';
  report.error = /^[a-z_]{1,100}$/.test(code) ? code : 'driver_failed';
} finally {
  if (cdp) await cdp.close().catch(() => {});
  if (opened) {
    try {
      if ((await desktop.activeProfiles()).includes(opened)) {
        const response = await fetch('http://127.0.0.1:58888/api/profiles/stop', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uuid: opened }), signal: AbortSignal.timeout(55_000) });
        check(response.ok, 'ordinary_close_failed');
      }
      report.ordinaryClose = true;
    } catch { report.cleanupError = 'ordinary_close_failed'; }
  }
  if (granted.length && !report.cleanupError) {
    try {
      await until(async () => (await Promise.all(granted.map(id => store.get(id)))).every(p => p?.grant?.phase === 'complete'), 210_000, 'cleanup_timeout');
      for (const id of granted) {
        const p = (await store.get(id))!, live = await cloud.getProfile(p.uuid!);
        check(live.status === 0 && !live.has_user_password && inFolder(live, process.env.OCTO_HOME_FOLDER_UUID!)
          && live.title === p.original.title, 'cleanup_mismatch');
      }
      report.cloudCleanup = true;
    } catch { report.cleanupError = 'cloud_cleanup_failed'; }
  }
  report.passed = !!report.scamalyticsTbilisi && !!report.cloudCleanup && !report.error && !report.cleanupError;
  if (!report.passed) process.exitCode = 1;
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  await browser.close(); await pool.end();
}
