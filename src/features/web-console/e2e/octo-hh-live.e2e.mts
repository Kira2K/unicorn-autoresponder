// Explicit one-off Kira acceptance. No scheduler, LinkedIn, or unrelated profile writes.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { signIn } from './octo-console.e2e.mts';
import { loadOctoHhTarget } from '../../hh-responses/octo/target.mts';
import { runOctoHh } from '../../hh-responses/octo/run.mts';
import { createOctoHhSession, createHhSubmissionGuard } from '../../hh-responses/octo/session.mts';
import { createCloudApi } from '../../octo-access/cloud-api.mts';
import { createOctoApi } from '../../octo-access-test/octo-api.mts';
import { createOctoPostgresStore } from '../../octo-access/postgres-store.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { closeRuntimePostgresDb } from '../../../platform/db/postgres/runtime.mts';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { inFolder } from '../../octo-access/provision.mts';

const verifyOnly = process.env.OCTO_E2E_HH_VERIFY_ONLY === '1';
const authOnly = verifyOnly || process.env.OCTO_E2E_HH_AUTH_ONLY === '1';
if (process.env.OCTO_E2E_KIRA !== '1' || (!authOnly && process.env.OCTO_E2E_HH_ONE_APPLICATION !== '1'))
  throw Error('kira_hh_apply_opt_in_required');
const profileId = 307, uuid = '904e6b14859245ac9a48cf54ffb82096', clientId = 1;
const output = 'tmp/octo-kira', url = 'http://127.0.0.1:4300';
const cfg = readPostgresAppDbConfig(process.env), pool = createPostgresPool(cfg);
const store = createOctoPostgresStore(pool, cfg.database), cloud = createCloudApi(process.env.OCTO_API_TOKEN!);
const desktop = createOctoApi(process.env.OCTO_API_TOKEN!, fetch, { debugPort: true });
const report: Record<string, any> = { passed: false, live: true, headful: true, clientId, profileId,
  market: 'En', testMode: verifyOnly ? 'read_only_evidence' : authOnly ? 'authentication_only' : 'single_application', responseLimit: authOnly ? 0 : 1,
  linkedinOpened: false, scheduleChanged: false };
const check = (ok: unknown, code: string) => { if (!ok) throw Error(code); };
const progress = (stage: string) => { report.stage = stage; console.log(JSON.stringify({ stage, profileId })); };
const until = async (read: () => Promise<boolean>, ms: number, code: string) => {
  const deadline = Date.now() + ms;
  do { if (await read()) return; await new Promise(done => setTimeout(done, 1000)); } while (Date.now() < deadline);
  throw Error(code);
};
const browser = await chromium.launch({ headless: false, slowMo: 100 });
let startAttempted = false, grantRequested = false, ledgerStarted = false;
try {
  progress('readiness');
  const ready = await loadOctoHhTarget({ clientId, market: 'En', allowDisabled: true,
    ...(process.env.OCTO_E2E_HH_COVER_TEXT === undefined ? {} : { coverTextOverride: process.env.OCTO_E2E_HH_COVER_TEXT }) });
  report.readiness = ready.readiness;
  check((ready.readiness.ready && ready.target || authOnly && ready.readiness.reason === 'cover_missing')
    && !ready.readiness.enabled, 'hh_target_not_ready');
  const credentials = authOnly ? await createRequire(import.meta.url)('../../../platform/db/index.ts')
    .createAppDb().getHHAuthCredentialsByClientName('Кира', 'En') : ready.target!.hhAuthCredentials;
  const managed = await store.get(profileId);
  check(managed?.clientId === clientId && managed.uuid === uuid && managed.phase === 'ready'
    && managed.proxyChange?.phase === 'complete' && (!managed.grant || managed.grant.phase === 'complete'), 'profile_not_idle');
  const live = await cloud.getProfile(uuid);
  check(live.status === 0 && inFolder(live, process.env.OCTO_HOME_FOLDER_UUID!) && live.start_pages.length === 0
    && live.proxy?.uuid === managed!.proxy?.uuid, 'profile_cloud_preflight_failed');
  check(!(await desktop.activeProfiles()).includes(uuid), 'profile_already_running');
  await mkdir(output, { recursive: true });
  // A lost/ambiguous run can never silently spend the one-application budget again.
  if (!authOnly) {
    await writeFile(`${output}/hh-run-once.json`, JSON.stringify({ clientId, profileId, startedAt: Date.now() }), { flag: 'wx' });
    ledgerStarted = true;
  }
  progress('console_login');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.route(/https?:\/\/([^/]+\.)?linkedin\.com(?::\d+)?\//i, route => route.abort());
  const page = await signIn(context, url, 'kitsunewebdeveloper@gmail.com', '1234');
  const me = await (await context.request.get(`${url}/api/auth/me`)).json();
  check(me.clientId === clientId && me.role === 'client', 'console_owner_mismatch');
  const card = page.getByTestId(`octo-profile-${profileId}`);
  progress('grant_via_ui'); grantRequested = true;
  await card.getByRole('button', { name: 'Получить доступ', exact: true }).click();
  const passwordInput = card.getByRole('textbox', { name: 'Пароль к профилям (пароли идентичны для всех твоих профилей)', exact: true });
  await passwordInput.waitFor({ timeout: 90_000 });
  const password = await passwordInput.inputValue();
  check(/^\d{5}$/.test(password) && password === managed!.password, 'profile_password_mismatch');
  progress('open_octobrowser'); startAttempted = true;
  const started = await desktop.startProfile(uuid, password);
  check(started.debug_port, 'octo_debug_port_missing'); report.profileOpened = true;
  if (authOnly) {
    progress('hh_en_authentication_only');
    const session = await createOctoHhSession(started.debug_port!, 15_000);
    try {
      await session.navigate('https://hh.ru', 60_000);
      const state = await session.authenticate(credentials, 60_000);
      report.hh = { authenticated: state === 'logged_in', authState: state, responseCount: 0, submissionAttempts: 0 };
      report.hhPassed = state === 'logged_in';
      if (verifyOnly && state === 'logged_in') {
        const reader = await chromium.connectOverCDP(`http://127.0.0.1:${started.debug_port!}`);
        const c = reader.contexts()[0], guard = createHhSubmissionGuard(); guard.activate('preview', 1);
        const route = (r: any) => guard.handle(r); await c.route('**/*', route);
        const readPage = await c.newPage();
        try {
          report.applicationEvidence = [];
          for (const vacancyId of ['138412478', '138428628']) {
            await readPage.goto(`https://hh.ru/vacancy/${vacancyId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await readPage.waitForTimeout(3000);
            const evidence = await readPage.evaluate(() => ({
              title: document.title,
              responseControls: Array.from(document.querySelectorAll('[data-qa*="response"]')).map(e => ({
                qa: e.getAttribute('data-qa'), text: (e.textContent || '').trim().slice(0,200),
                href: e.getAttribute('href')?.split('?')[0]
              }))
            }));
            report.applicationEvidence.push({ vacancyId, ...evidence });
          }
          await readPage.goto('https://hh.ru/applicant/negotiations', { waitUntil: 'domcontentloaded', timeout: 60_000 });
          await readPage.waitForTimeout(3000);
          report.negotiations = await readPage.locator('a[href*="/vacancy/"]').evaluateAll(els => els.slice(0,30).map(e => ({
            href: e.getAttribute('href')?.split('?')[0], text: (e.textContent || '').trim().slice(0,150)
          })));
          await readPage.screenshot({ path: `${output}/hh-negotiations.png`, mask: [readPage.locator('input,textarea')] });
          report.readOnlyGuard = guard.snapshot();
        } finally { await readPage.close(); await c.unroute('**/*', route); await reader.close(); }
      }
    } finally { session.cancel(); await session.dispose(); }
  } else {
  progress('hh_en_single_application');
  report.hh = await runOctoHh({ port: started.debug_port!, target: ready.target!, mode: 'apply', responseLimit: 1, timeoutMs: 180_000 });
  check(report.hh.submissionAttempts <= 1 && report.hh.responseCount <= 1, 'hh_application_budget_exceeded');
  report.hhPassed = report.hh.authenticated && report.hh.indexScriptInjected && report.hh.started
    && report.hh.responseCount === 1 && !report.hh.cleanupFailed;
  }
} catch (error) {
  const message = (error as Error)?.message, code = (error as any)?.code;
  report.error = /^[a-z_]+$/.test(message) ? message : /^[a-z_.]+$/.test(code ?? '') ? code
    : message?.match(/ERR_(?:PROXY|TUNNEL|SOCKS|NETWORK|CONNECTION|TIMED|NAME)_[A-Z_]+/)?.[0] ?? 'driver_failed';
  if (code === 'selector_missing') {
    const selector = (error as any)?.details?.selector;
    if (typeof selector === 'string' && /^[\w\s\[\]="':,./#>-]{1,300}$/.test(selector)) report.missingSelector = selector;
    const qa = (error as any)?.details?.dataQa;
    if (Array.isArray(qa)) report.authControls = qa.filter(value => typeof value === 'string'
      && /^[a-zA-Z_-]{1,100}$/.test(value) && /login|account|password|captcha|auth/i.test(value)).slice(0,30);
  }
} finally {
  if (startAttempted) {
    progress('ordinary_close');
    try {
      if ((await desktop.activeProfiles()).includes(uuid)) {
        const stopped = await fetch('http://127.0.0.1:58888/api/profiles/stop', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uuid }), signal: AbortSignal.timeout(55_000) });
        check(stopped.ok, 'ordinary_close_rejected');
      }
      await until(async () => !(await desktop.activeProfiles()).includes(uuid), 90_000, 'ordinary_close_timeout');
      report.ordinaryClose = true;
    } catch { report.cleanupError = 'ordinary_close_failed'; }
  }
  if (grantRequested && !report.cleanupError) {
    progress('cloud_cleanup');
    try {
      await until(async () => (await store.get(profileId))?.grant?.phase === 'complete', 210_000, 'grant_cleanup_timeout');
      const live = await cloud.getProfile(uuid), managed = await store.get(profileId);
      check(live.status === 0 && !live.has_user_password && inFolder(live, process.env.OCTO_HOME_FOLDER_UUID!)
        && live.title === managed?.original.title && live.proxy?.uuid === managed?.proxy?.uuid, 'cloud_cleanup_mismatch');
      report.cloudCleanup = true;
    } catch { report.cleanupError = 'cloud_cleanup_failed'; }
  }
  try {
    const after = await loadOctoHhTarget({ clientId, market: 'En', allowDisabled: true });
    report.scheduleStillDisabled = after.readiness.enabled === false;
  } catch { report.scheduleVerificationFailed = true; }
  report.passed = !!report.hhPassed && !!report.ordinaryClose && !!report.cloudCleanup && report.scheduleStillDisabled && !report.error;
  if (!report.passed) process.exitCode = 1;
  await mkdir(output, { recursive: true });
  if (ledgerStarted || authOnly) await writeFile(`${output}/${verifyOnly ? 'hh-evidence-report' : authOnly ? 'hh-auth-report' : 'hh-report'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close(); await pool.end(); await closeRuntimePostgresDb();
}
