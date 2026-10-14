// Explicit Kira pilot: headful Console form -> real SQL -> cloud proxy attachment.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createCloudApi } from '../../octo-access/cloud-api.mts';
import { createOctoPostgresStore } from '../../octo-access/postgres-store.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
const require = createRequire(import.meta.url);
const { getDolphinProfileWithProxy } = require('../../../integrations/dolphin/profile-proxy.ts');
const { parseProxyInput } = await import('../../octo-access/proxy-input.mts');
if (process.env.OCTO_E2E_KIRA !== '1') throw Error('kira_e2e_opt_in_required');
const cfg = readPostgresAppDbConfig(process.env), pool = createPostgresPool(cfg), store = createOctoPostgresStore(pool, cfg.database);
const cloud = createCloudApi(process.env.OCTO_API_TOKEN ?? '');
const report: Record<string, unknown> = { passed: false, headful: true, clientId: 1, linkedinOpened: false };
const browser = await chromium.launch({ headless: false, slowMo: 100 });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const check = (ok: unknown, code: string) => { if (!ok) throw new Error(code); };
let stage = 'preflight';
try {
  await context.route(/https?:\/\/([^/]+\.)?linkedin\.com(?::\d+)?\//i, route => route.abort());
  const resumeId = Number(process.env.OCTO_E2E_RESUME_PROFILE_ID || 0);
  const before = await store.list(1);
  check(resumeId ? before.length === 1 && before[0].id === resumeId : before.length === 0, 'kira_profile_already_exists');
  if (resumeId) {
    const prior = JSON.parse(await readFile('tmp/octo-kira/proxy-report.json', 'utf8'));
    check(prior.profileId === resumeId && prior.octoUuid === before[0].uuid
      && (prior.error === 'kira_proxy_e2e_failed_at_verify_cloud_proxy' || prior.proxySavedThroughUi), 'resume_evidence_missing');
    report.resumedVerification = true;
  }
  const source = await getDolphinProfileWithProxy(770032142);
  const input = parseProxyInput({ ...source.proxy, type: source.proxy?.type, changeIpUrl: source.proxy?.changeIpUrl });
  const page = await context.newPage(), url = 'http://127.0.0.1:4300';
  await page.goto(url); stage = 'console_login';
  await page.getByTestId('email-input').fill('kitsunewebdeveloper@gmail.com');
  await page.locator('#password').fill('1234');
  await page.getByTestId('login-button').click();
  await page.locator('.octo-card').waitFor({ timeout: 20_000 });
  const session = await (await context.request.get(url + '/api/auth/me')).json();
  check(session.role === 'client' && session.clientId === 1, 'kira_session_mismatch');
  stage = 'create_profile';
  if (!resumeId) {
    await page.locator('.octo-card').getByRole('checkbox', { name: 'Использовать свой прокси' }).check();
    await page.locator('.octo-card').getByRole('button', { name: 'Создать профили', exact: true }).click();
  }
  let managed;
  const createdDeadline = Date.now() + 120_000;
  do {
    const rows = await store.list(1); check(rows.length <= 1, 'unexpected_extra_profile'); managed = rows[0];
    if (managed?.phase === 'ready') break;
    check(managed?.phase !== 'blocked', 'profile_creation_blocked');
    await new Promise(done => setTimeout(done, 500));
  } while (Date.now() < createdDeadline);
  check(managed?.uuid && managed.phase === 'ready' && managed.locale === 'ru', 'kira_profile_not_ready');
  const id = managed!.id, uuid = managed!.uuid!; report.profileId = id; report.octoUuid = uuid;
  stage = 'fill_proxy_form';
  if (!resumeId) {
  await page.getByTestId(`octo-proxy-type-${id}`).selectOption(input.type);
  for (const [field, value] of Object.entries({ host: input.host, port: input.port, login: input.login, password: input.password, 'change-ip-url': input.changeIpUrl ?? '' }))
    await page.getByTestId(`octo-proxy-${field}-${id}`).fill(String(value));
  const savedResponse = page.waitForResponse(res => res.url().endsWith(`/api/octo/profiles/${id}/proxy`) && res.request().method() === 'POST');
  await page.getByTestId(`octo-proxy-save-${id}`).click();
  check((await savedResponse).status() === 202, 'proxy_save_rejected');
  }
  report.proxySavedThroughUi = true;
  stage = 'verify_cloud_proxy';
  const deadline = Date.now() + 120_000;
  do {
    managed = (await store.get(id))!;
    if (managed.proxyChange?.phase === 'complete') break;
    check(managed.proxyChange?.phase !== 'blocked', 'proxy_attachment_blocked');
    await new Promise(done => setTimeout(done, 500));
  } while (Date.now() < deadline);
  check(managed.proxyChange?.phase === 'complete' && !!managed.proxy, 'proxy_not_completed');
  const live = await cloud.getProfile(uuid), proxies = await cloud.proxyConnections(`unicorn-octo-proxy:${managed.proxyChange!.id}`);
  check(live.proxy?.uuid === managed.proxy!.uuid && proxies.length === 1 && proxies[0].profiles_count === 1, 'cloud_proxy_binding_mismatch');
  for (const field of ['type', 'host', 'port', 'login', 'password'] as const) check(proxies[0][field] === input[field], 'proxy_connection_mismatch');
  const original = await getDolphinProfileWithProxy(770032142);
  check(original.proxy.id === source.proxy.id && original.proxy.host === source.proxy.host && original.proxy.password === source.proxy.password, 'dolphin_proxy_changed');
  const statusResponse = await context.request.get(url + '/api/octo/profiles/status');
  const statusText = await statusResponse.text();
  check((!input.password || !statusText.includes(input.password)) && (!input.login || !statusText.includes(input.login)), 'proxy_credentials_in_status');
  stage = 'verify_ui_cleared';
  check(await page.getByTestId(`octo-proxy-password-${id}`).inputValue() === '', 'form_retains_proxy_password');
  await page.getByTestId(`octo-proxy-status-${id}`).getByText('Прокси сохранён', { exact: true }).waitFor({ timeout: 10_000 });
  await mkdir('tmp/octo-kira', { recursive: true });
  await page.locator('.octo-card').screenshot({ path: resolve('tmp/octo-kira/proxy-ui.png'),
    mask: [page.getByTestId(`octo-proxy-login-${id}`), page.getByTestId(`octo-proxy-password-${id}`)] });
  Object.assign(report, { passed: true, proxySavedThroughUi: true, cloudBindingVerified: true, dolphinUnchanged: true, credentialsRedacted: true });
} catch (error) {
  report.error = `kira_proxy_e2e_failed_at_${stage}`;
  const code = (error as Error)?.message;
  report.reason = /^[a-z_]+$/.test(code) ? code : 'driver_assertion_failed';
  process.exitCode = 1;
}
finally {
  await mkdir('tmp/octo-kira', { recursive: true });
  await writeFile('tmp/octo-kira/proxy-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  await browser.close(); await pool.end();
}
