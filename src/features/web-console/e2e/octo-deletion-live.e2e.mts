// Explicit live acceptance: only the existing, paused proxy-onboarding test client.
// Creates through the real UI; cloud deletion simulates an operator deleting in Octo.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { signIn } from './octo-console.e2e.mts';
import { createOctoApi } from '../../octo-access-test/octo-api.mts';
import { createCloudApi } from '../../octo-access/cloud-api.mts';
import { createOctoPostgresStore } from '../../octo-access/postgres-store.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import type { ManagedProfile } from '../../octo-access/contracts.mts';

if (process.env.OCTO_E2E_DELETION !== '1' || !process.env.NODEMAVEN_API_KEY) throw Error('octo_deletion_e2e_opt_in_required');
const url = 'http://127.0.0.1:4300', clientId = 250, output = 'tmp/octo-deletion-live';
const cfg = readPostgresAppDbConfig(process.env), pool = createPostgresPool(cfg), store = createOctoPostgresStore(pool, cfg.database);
const cloud = createCloudApi(process.env.OCTO_API_TOKEN!), operator = createOctoApi(process.env.OCTO_API_TOKEN!, fetch, { cloudOnly: true });
const report: Record<string, any> = { passed: false, headful: true, live: true, linkedinOpened: false, cycles: [] };
const check = (value: unknown, code: string) => { if (!value) throw Error(code); };
const stage = (value: string) => { report.stage = value; console.log(JSON.stringify({ stage: value })); };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const until = async (read: () => Promise<boolean>, ms: number, code: string) => {
  const deadline = Date.now() + ms;
  do { if (await read()) return; await new Promise(done => setTimeout(done, 1000)); } while (Date.now() < deadline);
  throw Error(code);
};
const browser = await chromium.launch({ headless: false, slowMo: 80 });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
let page: import('playwright').Page | undefined;
const createdIds: number[] = [], deletedUuids: string[] = [], deletedProxies: string[] = [];
try {
  await mkdir(output, { recursive: true });
  await store.checkSchema();
  const s = await pool.connect();
  try {
    const row = (await s.query('SELECT client_name,calendar_email,client_status,legend_info FROM noco.clients WHERE id=$1', [clientId])).rows[0];
    check(row?.client_name === 'Test For Octo Proxy creation' && row.calendar_email === 'octo.proxy.test@example.com' &&
      row.client_status === 'paused' && row.legend_info === 'octo-proxy-fixture-v1:proxy-creation', 'fixture_scope_mismatch');
  } finally { s.release(); }
  check((await store.list(clientId)).length === 0 && !(await store.clientState(clientId))?.setup, 'fixture_not_empty');
  const clientBefore = (await store.clientState(clientId))!;
  const others = (await store.list()).filter(p => p.clientId !== clientId), othersBefore = hash(others);
  const otherCloud = await Promise.all(others.map(p => cloud.getProfile(p.uuid!)));
  const beforeCloud = hash(otherCloud);
  await context.route(/https?:\/\/([^/]+\.)?linkedin\.com(?::\d+)?\//i, r => { report.linkedinOpened = true; return r.abort(); });
  stage('login'); page = await signIn(context, url, 'octo.proxy.test@example.com', '1234'); page.setDefaultTimeout(60_000);
  page.on('pageerror', () => { report.frontendError = true; });
  let retainedRu: ManagedProfile | undefined;
  for (let cycle = 1; cycle <= 2; cycle++) {
    stage(`cycle_${cycle}_ui_create`);
    await page.getByRole('button', { name: 'Сгенерировать NodeMaven прокси или протестировать свой', exact: true }).click();
    if (cycle === 1) {
      if (await page.getByRole('button', { name: 'Изменить ключ', exact: true }).count())
        await page.getByRole('button', { name: 'Изменить ключ', exact: true }).click();
      await page.getByLabel('Ключ NodeMaven', { exact: true }).fill(process.env.NODEMAVEN_API_KEY!);
      const saved = page.waitForResponse(r => r.url().endsWith('/api/octo/nodemaven-key') && r.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Сохранить ключ', exact: true }).click(); check((await saved).ok(), 'key_save_failed');
    }
    await page.getByRole('combobox', { name: 'Страна', exact: true }).selectOption('ge');
    await page.getByRole('combobox', { name: 'Регион', exact: true }).selectOption('tbilisi');
    await page.getByRole('combobox', { name: 'Город', exact: true }).selectOption('tbilisi');
    const submitted = page.waitForResponse(r => r.url().endsWith('/api/octo/onboarding') && r.request().method() === 'POST');
    await page.getByTestId('octo-setup-form').getByRole('button', { name: 'Проверить прокси и создать профили', exact: true }).click();
    check((await submitted).status() === 202, 'onboarding_rejected');
    stage(`cycle_${cycle}_checking_proxies`);
    await until(async () => {
      const setup = (await store.clientState(clientId))?.setup;
      if (['blocked', 'unknown'].includes(setup?.phase ?? '')) { report.externalError = setup?.error; throw Error('onboarding_failed'); }
      return setup?.phase === 'complete';
    }, 900_000, 'onboarding_timeout');
    const pair = await store.list(clientId), en = pair.find(p => p.locale === 'en')!, ru = pair.find(p => p.locale === 'ru')!;
    check(pair.length === 2 && en?.uuid && en.proxy && ru?.uuid && pair.every(p => p.phase === 'ready'), 'profiles_not_ready');
    check(pair.every(p => p.password === clientBefore.password), 'client_password_changed');
    if (retainedRu) check(hash(ru) === hash(retainedRu), 'remaining_ru_changed');
    retainedRu = ru;
    for (const p of pair) if (!createdIds.includes(p.id)) createdIds.push(p.id);
    check((await cloud.getProfile(en.uuid!)).proxy?.uuid === en.proxy!.uuid, 'proxy_not_attached');
    stage(`cycle_${cycle}_ui_access`);
    const card = page.getByTestId(`octo-profile-${en.id}`);
    await card.getByRole('button', { name: 'Получить доступ', exact: true }).click();
    const password = card.getByRole('textbox', { name: 'Пароль к профилям (пароли идентичны для всех твоих профилей)', exact: true });
    await password.waitFor(); check(await password.inputValue() === clientBefore.password, 'displayed_password_changed');
    const grantId = (await store.get(en.id))!.grant!.id;
    stage(`cycle_${cycle}_cloud_delete`);
    const deleted = await operator.cloudRequest('/profiles', 'DELETE', { uuids: [en.uuid], skip_trash_bin: false });
    check(deleted.deleted_uuids?.includes(en.uuid) && !deleted.active_uuids?.length, 'cloud_delete_not_confirmed');
    await until(async () => {
      const p = await store.get(en.id);
      if (p?.deletion?.phase === 'blocked') { report.cleanupError = p.deletion.error; throw Error('automatic_cleanup_blocked'); }
      return !p;
    }, 120_000, 'automatic_cleanup_timeout');
    check(!(await cloud.listProxies()).some(p => p.uuid === en.proxy!.uuid), 'saved_proxy_left_behind');
    check((await store.events(en.uuid!)).length === 0, 'events_left_behind');
    check(!(await store.clientState(clientId))?.setup, 'setup_left_behind');
    await card.waitFor({ state: 'detached' });
    check((await context.request.get(`${url}/api/octo/grants/${grantId}`)).status() === 404, 'old_grant_not_missing');
    check((await context.request.post(`${url}/api/octo/grants`, { data: { profileId: en.id } })).status() === 404, 'old_profile_not_missing');
    check(await page.getByRole('textbox', { name: 'Пароль к профилям (пароли идентичны для всех твоих профилей)', exact: true }).count() === 0, 'credentials_left_in_ui');
    check(hash((await store.list()).filter(p => p.clientId !== clientId)) === othersBefore, 'other_profile_changed');
    deletedUuids.push(en.uuid!); deletedProxies.push(en.proxy!.uuid);
    report.cycles.push({ cycle, profileId: en.id, profileDeleted: true, proxyDeleted: true, uiCleared: true, oldIds404: true });
  }
  stage('delete_remaining_ru');
  const remaining = (await store.list(clientId))[0];
  check(remaining?.id === retainedRu?.id && !remaining.proxy, 'remaining_scope_mismatch');
  const deleted = await operator.cloudRequest('/profiles', 'DELETE', { uuids: [remaining.uuid], skip_trash_bin: false });
  check(deleted.deleted_uuids?.includes(remaining.uuid), 'ru_cloud_delete_failed');
  await until(async () => (await store.list(clientId)).length === 0, 120_000, 'ru_cleanup_timeout');
  deletedUuids.push(remaining.uuid!);
  await page.locator('.octo-profile').waitFor({ state: 'detached' });
  const sql = await pool.connect();
  try {
    check((await sql.query('SELECT count(*)::integer AS n FROM noco.dolphin_profiles WHERE id=ANY($1::bigint[])', [createdIds])).rows[0].n === 0, 'common_bindings_left');
    check((await sql.query('SELECT count(*)::integer AS n FROM noco.octo_event_inbox WHERE object_uuid=ANY($1::text[])', [deletedUuids])).rows[0].n === 0, 'event_rows_left');
  } finally { sql.release(); }
  const clientAfter = (await store.clientState(clientId))!;
  check(clientAfter.password === clientBefore.password && clientAfter.nodeMavenKey === process.env.NODEMAVEN_API_KEY && !clientAfter.setup, 'client_credentials_not_preserved');
  check(hash(await Promise.all(others.map(p => cloud.getProfile(p.uuid!)))) === beforeCloud, 'other_cloud_profile_changed');
  check(!report.frontendError && !report.linkedinOpened, 'unexpected_ui_activity');
  await page.screenshot({ path: output + '/clean-console.png', fullPage: true });
  report.passed = true; report.remainingFixtureProfiles = 0; report.deletedProfileCount = deletedUuids.length;
  report.deletedProxyCount = deletedProxies.length; report.otherProfilesUnchanged = true;
} catch (error) {
  const code = String((error as any)?.code ?? (error as Error)?.message ?? 'unknown');
  report.error = /^[a-z_]{1,100}$/.test(code) ? code : 'e2e_failed';
  // Keep incomplete operations for diagnosis; do not manually purge SQL to fabricate success.
  process.exitCode = 1;
} finally {
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  await context.close(); await browser.close(); await pool.end();
}
