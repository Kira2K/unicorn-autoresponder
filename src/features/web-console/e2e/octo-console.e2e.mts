import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import { createOctoPostgresStore } from '../../octo-access/postgres-store.mts';
import { createCloudApi, normalizeUuid } from '../../octo-access/cloud-api.mts';
import { createOctoApi } from '../../octo-access-test/octo-api.mts';
import { readOctoConfig } from '../../octo-access/config.mts';
import { inFolder } from '../../octo-access/provision.mts';
import type { ManagedProfile } from '../../octo-access/contracts.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';

type Name = 'Alex' | 'Bob';
type Fixture = { name: Name; email: string; clientId: number; profileId: number; page: Page; context: BrowserContext };
type Access = { fixture: Fixture; password: string; alias: string; expiresAt: number };
export interface ConsoleDriver {
  readonly kind: 'live' | 'mock';
  readonly resumeProfileIds?: readonly number[];
  beforeEnsure(clientId: number): Promise<void>;
  bind(fixtures: Fixture[], startedAt: number): Promise<void>;
  open(access: Access, secondCycle: boolean, otherPassword: string): Promise<void>;
  afterExpiry(access: Access): Promise<void>;
  stop(access: Access): Promise<void>;
  afterComplete(access: Access): Promise<void>;
  cleanup(): Promise<void>;
}
const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
class AcceptanceFailure extends Error {}
function check(condition: unknown, code: string): asserts condition { if (!condition) throw new AcceptanceFailure(code); }
function readResumeProfileIds(value: string | undefined): number[] {
  if (!value?.trim()) return [];
  const parts = value.split(',').map(part => part.trim());
  check(parts.length <= 2 && parts.every(part => /^[1-9]\d*$/.test(part)), 'invalid_resume_profile_ids');
  const ids = parts.map(Number);
  check(ids.every(Number.isSafeInteger) && new Set(ids).size === ids.length, 'invalid_resume_profile_ids');
  return ids;
}
function progress(stage: 'login' | 'ensure' | 'grant' | 'open' | 'expiry' | 'close', client: Name | 'Other', cycle?: number) {
  console.log(JSON.stringify({ stage, client, ...(cycle === undefined ? {} : { cycle }) }));
}
function resumableProfile(p: ManagedProfile, now = Date.now()): boolean {
  const g = p.grant;
  return p.phase === 'ready' && !p.pending && (!g || g.phase === 'complete' && !g.pending &&
    typeof g.completedAt === 'number' && typeof g.expiresAt === 'number' &&
    g.expiresAt <= now && g.completedAt >= g.expiresAt && g.completedAt <= now);
}
async function until(operation: () => Promise<boolean>, timeout: number, code: string) {
  const deadline = Date.now() + timeout;
  do { if (await operation()) return; await delay(500); } while (Date.now() < deadline);
  throw new AcceptanceFailure(code);
}
async function untilRead(operation: () => Promise<boolean>, timeout: number, code: string) {
  await until(async () => { try { return await operation(); } catch { return false; } }, timeout, code);
}
function card(page: Page) { return page.locator('.octo-card'); }
function profile(page: Page) { return card(page).locator('.octo-profile').first(); }
async function jsonGet(context: BrowserContext, url: string) {
  const response = await context.request.get(url);
  check(response.ok(), 'console_read_failed');
  return response.json();
}
export async function signIn(context: BrowserContext, url: string, email: string, password: string) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(url);
  await page.getByTestId('email-input').fill(email);
  await page.locator('#password').fill(password);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
  await page.getByTestId('login-button').click();
  check((await login).ok(), 'console_login_failed');
  const welcome = page.getByTestId('octo-welcome');
  // The real SQL dashboard can load after the login response; wait for its UI,
  // not an arbitrary five-second window that misses the later modal.
  await welcome.or(page.locator('.octo-card')).first().waitFor({ state: 'visible', timeout: 60_000 });
  if (await welcome.isVisible()) await page.getByRole('button', { name: 'Понятно, продолжить', exact: true }).click();
  return page;
}
async function accessFor(fixture: Fixture, url: string): Promise<Access> {
  await profile(fixture.page).getByRole('button', { name: 'Получить доступ', exact: true }).click();
  await until(async () => await profile(fixture.page).getByRole('textbox', { name: 'Пароль к профилям (пароли идентичны для всех твоих профилей)', exact: true }).count() === 1,
    90_000, 'grant_not_displayed');
  const password = await profile(fixture.page).getByRole('textbox', { name: 'Пароль к профилям (пароли идентичны для всех твоих профилей)', exact: true }).inputValue();
  check(/^\d{5}$/.test(password), 'invalid_displayed_password');
  const status = await jsonGet(fixture.context, `${url}/api/octo/profiles/status`);
  const grantId = status.profiles.find((p: { id: number }) => p.id === fixture.profileId)?.grantId;
  check(typeof grantId === 'string', 'grant_id_missing');
  const grant = await jsonGet(fixture.context, `${url}/api/octo/grants/${encodeURIComponent(grantId)}`);
  check(grant.phase === 'granted' && grant.password === password && typeof grant.alias === 'string' &&
    typeof grant.expiresAt === 'number' && grant.expiresAt > Date.now(), 'grant_ui_api_mismatch');
  // API and form values stay in memory; neither response body nor credentials are written to artifacts.
  return { fixture, password, alias: grant.alias, expiresAt: grant.expiresAt };
}

export async function runConsoleFlow(options: {
  url?: string; password?: string; driver?: ConsoleDriver; unauthorizedEmail?: string; outputDir?: string; headful?: boolean;
} = {}) {
  const url = (options.url ?? process.env.OCTO_E2E_CONSOLE_URL ?? 'http://127.0.0.1:4300').replace(/\/$/, '');
  const consoleUrl = new URL(url);
  check(['127.0.0.1', 'localhost', '::1'].includes(consoleUrl.hostname), 'console_target_must_be_local');
  const resumeIds = new Set(options.driver?.resumeProfileIds ?? readResumeProfileIds(process.env.OCTO_E2E_RESUME_PROFILE_IDS));
  check(resumeIds.size === 0 || options.driver?.kind === 'live', 'resume_requires_live_driver');
  const startedAt = Date.now(), output = options.outputDir ?? 'tmp/octo-console';
  const browser = await chromium.launch({ headless: !options.headful });
  const fixtures: Fixture[] = [];
  const contexts: BrowserContext[] = [];
  const report = { passed: false, live: options.driver?.kind === 'live', users: ['Alex', 'Bob'], cycles: 0,
    unauthorizedHidden: false, passwordPersistent: false, aliasChanged: false, openAfterExpiry: false,
    localStorageRestored: false, otherClientPasswordRejected: false, screenshots: [] as string[], error: undefined as string | undefined,
    cleanup: 'not_needed', cleanupError: undefined as string | undefined, resumedProfileIds: [] as number[] };
  try {
    await mkdir(output, { recursive: true });
    for (const name of ['Alex', 'Bob'] as const) {
      const email = `${name.toLowerCase()}.octo@example.com`;
      progress('login', name);
      const context = await browser.newContext({ viewport: { width: 1450, height: 1100 } });
      contexts.push(context);
      const page = await signIn(context, url, email, options.password ?? '1234');
      const session = await jsonGet(context, `${url}/api/auth/me`);
      check(session.role === 'client' && session.email === email && Number.isSafeInteger(session.clientId), 'fixture_session_mismatch');
      const dashboard = await jsonGet(context, `${url}/api/client/me`);
      check(dashboard.client?.id === session.clientId && dashboard.client?.calendarEmail === email, 'fixture_client_mismatch');
      const before = await jsonGet(context, `${url}/api/octo/profiles/status`);
      const resumed = before.profiles.length === 1 && resumeIds.has(before.profiles[0].id);
      check(before.requiredLocales.length === 1 && (before.profiles.length === 0 || resumed), 'fixtures_must_have_no_previous_profiles');
      if (resumed) {
        check(before.profiles[0].phase === 'ready', 'resume_profile_not_ready');
        if (before.profiles[0].grantId) {
          const oldGrant = await jsonGet(context, `${url}/api/octo/grants/${encodeURIComponent(before.profiles[0].grantId)}`);
          check(oldGrant.phase === 'complete' && typeof oldGrant.expiresAt === 'number' && oldGrant.expiresAt <= Date.now(), 'resume_grant_not_completed');
        }
        report.resumedProfileIds.push(before.profiles[0].id);
      }
      await options.driver?.beforeEnsure(session.clientId);
      await card(page).waitFor();
      progress('ensure', name);
      if (!resumed) {
        await card(page).getByRole('button', { name: 'Создать профили', exact: true }).click();
      }
      await until(async () => {
        const status = await jsonGet(context, `${url}/api/octo/profiles/status`);
        return status.profiles.length === 1 && status.profiles[0].phase === 'ready';
      }, 120_000, 'new_profile_not_ready');
      const ready = await jsonGet(context, `${url}/api/octo/profiles/status`);
      fixtures.push({ name, email, clientId: session.clientId, profileId: ready.profiles[0].id, page, context });
      await until(async () => await profile(page).getByRole('button', { name: 'Получить доступ', exact: true }).isEnabled(),
        10_000, 'profile_button_not_ready');
    }
    check(fixtures[0].clientId !== fixtures[1].clientId && fixtures[0].profileId !== fixtures[1].profileId, 'fixture_isolation_failed');
    check(report.resumedProfileIds.length === resumeIds.size && report.resumedProfileIds.every(id => resumeIds.has(id)), 'resume_profile_ids_unused_or_unknown');
    await options.driver?.bind(fixtures, startedAt);
    const third = await browser.newContext(); contexts.push(third);
    progress('login', 'Other');
    const unauthorized = await signIn(third, url, options.unauthorizedEmail ?? process.env.OCTO_E2E_UNAUTHORIZED_EMAIL ?? 'alexeevalydia@gmail.com',
      process.env.OCTO_E2E_UNAUTHORIZED_PASSWORD ?? options.password ?? '1234');
    const denied = await third.request.get(`${url}/api/octo/profiles/status`);
    check(denied.status() === 403, 'unauthorized_capability_not_forbidden');
    const deniedGrant = await third.request.post(`${url}/api/octo/grants`, { data: { profileId: fixtures[0].profileId } });
    check(deniedGrant.status() === 403, 'unauthorized_grant_not_forbidden');
    await delay(2500);
    check(await card(unauthorized).count() === 0, 'unauthorized_card_visible');
    report.unauthorizedHidden = true;
    const first: Access[] = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      const accesses: Access[] = [];
      for (const fixture of fixtures) {
        progress('grant', fixture.name, cycle + 1);
        const access = await accessFor(fixture, url);
        if (cycle === 0) first.push(access);
        else {
          const previous = first.find(p => p.fixture.name === fixture.name)!;
          check(access.password === previous.password, 'password_changed_between_grants');
          check(access.alias !== previous.alias, 'alias_reused_between_grants');
        }
        accesses.push(access);
        const screenshot = `${fixture.name.toLowerCase()}-cycle-${cycle + 1}.png`;
        await card(fixture.page).screenshot({ path: resolve(output, screenshot), mask: [card(fixture.page).locator('.octo-credentials')] });
        report.screenshots.push(screenshot);
      }
      check(accesses[0].password !== accesses[1].password, 'fixture_passwords_not_independent');
      if (options.driver) {
        // Each UUID is separately guarded. Start in parallel within the same lease window.
        const opened = await Promise.allSettled(accesses.map((access, index) => {
          progress('open', access.fixture.name, cycle + 1);
          return options.driver!.open(access, cycle === 1, accesses[1 - index].password);
        }));
        const failure = opened.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected' && failure.reason instanceof AcceptanceFailure) throw failure.reason;
        check(!failure, 'scoped_profile_open_acceptance_failed');
        report.otherClientPasswordRejected = options.driver.kind === 'live';
      }
      const bobStatus = await jsonGet(fixtures[1].context, `${url}/api/octo/profiles/status`);
      const bobGrantId = bobStatus.profiles.find((p: { id: number }) => p.id === fixtures[1].profileId)?.grantId;
      check(typeof bobGrantId === 'string', 'bob_grant_id_missing');
      const crossGrant = await fixtures[0].context.request.get(`${url}/api/octo/grants/${encodeURIComponent(bobGrantId)}`);
      check(crossGrant.status() === 404, 'cross_client_grant_not_hidden');
      for (const access of accesses) {
        progress('expiry', access.fixture.name, cycle + 1);
        await until(async () => Date.now() >= access.expiresAt &&
          await profile(access.fixture.page).getByRole('textbox', { name: 'Пароль к профилям (пароли идентичны для всех твоих профилей)', exact: true }).count() === 0,
        Math.max(15_000, access.expiresAt - Date.now() + 20_000), 'credentials_not_removed_at_expiry');
        await options.driver?.afterExpiry(access);
        if (!options.driver) {
          // Mock runtime is responsible for producing its normal stopped event.
          await until(async () => (await jsonGet(access.fixture.context, `${url}/api/octo/profiles/status`)).profiles[0].phase === 'ready',
            90_000, 'mock_grant_not_completed');
        } else { progress('close', access.fixture.name, cycle + 1); await options.driver.stop(access); }
        await until(async () => await profile(access.fixture.page).getByRole('button', { name: 'Получить доступ', exact: true }).isEnabled(),
          90_000, 'grant_not_completed');
        await options.driver?.afterComplete(access);
      }
      report.cycles += 1;
    }
    report.passwordPersistent = true; report.aliasChanged = true;
    report.openAfterExpiry = options.driver?.kind === 'live'; report.localStorageRestored = options.driver?.kind === 'live';
    report.passed = true;
  } catch (error) {
    // Playwright and upstream errors can include form values: never serialize them.
    // Only our explicit acceptance failures are safe to report.
    report.error = error instanceof AcceptanceFailure ? error.message : 'octo_console_acceptance_failed';
  } finally {
    try { await options.driver?.cleanup(); report.cleanup = options.driver ? 'ordinary_close_completed' : 'not_needed'; }
    catch (error) {
      report.passed = false; report.cleanup = 'cleanup_pending_review';
      report.cleanupError = error instanceof AcceptanceFailure ? error.message : 'octo_cleanup_failed';
    }
    await Promise.all(contexts.map(context => context.close().catch(() => {})));
    await browser.close();
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  return report;
}

export function createLiveConsoleDriver(env: NodeJS.ProcessEnv = process.env): ConsoleDriver & { close(): Promise<void> } {
  const config = readOctoConfig(env);
  check(config?.enabled && config.allowedClientIds.size === 2, 'exactly_two_allowed_clients_required');
  const resumeIds = new Set(readResumeProfileIds(env.OCTO_E2E_RESUME_PROFILE_IDS));
  const dbConfig = readPostgresAppDbConfig(env), pool = createPostgresPool(dbConfig);
  const store = createOctoPostgresStore(pool, dbConfig.database);
  const cloud = createCloudApi(env.OCTO_API_TOKEN ?? '');
  const localApi = createOctoApi(env.OCTO_API_TOKEN ?? '', fetch, { debugPort: true });
  const allowed = config.allowedClientIds;
  const homeFolder = config.homeFolder;
  const bound = new Map<number, ManagedProfile>();
  const opened = new Set<string>();
  const windows = new Map<number, Page>();
  const expiries = new Map<string, number>();
  const markerKey = 'unicorn-octo-console-e2e';
  const markerValue = new Map<number, string>();
  async function local(path: string, body?: object) {
    try {
      const response = await fetch(`http://127.0.0.1:58888${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(55_000),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      });
      const result = await response.json();
      return { ok: response.ok && result?.success !== false && !result?.error && !result?.error_code, result };
    } catch { throw new AcceptanceFailure('local_octo_request_failed'); }
  }
  async function active() {
    const response = await local('/api/profiles/active');
    check(response.ok && Array.isArray(response.result), 'local_active_read_failed');
    return new Set(response.result.map((p: { uuid: string }) => normalizeUuid(p.uuid)));
  }
  function guard(id: number) {
    const p = bound.get(id);
    check(bound.size === 2 && p?.uuid && allowed.has(p.clientId), 'unscoped_local_profile');
    return p;
  }
  async function closeUuid(uuid: string) {
    check([...bound.values()].some(p => p.uuid === uuid) && opened.has(uuid), 'unscoped_stop_rejected');
    const response = await local('/api/profiles/stop', { uuid });
    check(response.ok, 'ordinary_stop_failed');
    await untilRead(async () => !(await active()).has(normalizeUuid(uuid)), 90_000, 'ordinary_stop_not_finished');
    opened.delete(uuid);
  }
  return {
    kind: 'live',
    resumeProfileIds: [...resumeIds],
    async beforeEnsure(clientId) {
      const existing = await store.list(clientId);
      check(allowed.has(clientId) && (existing.length === 0 || existing.length === 1 && resumeIds.has(existing[0].id) &&
        existing[0].clientId === clientId && resumableProfile(existing[0]) &&
        existing[0].original.description === `unicorn-octo:${existing[0].operationId}`), 'preexisting_fixture_profiles_rejected');
    },
    async bind(fixtures, startedAt) {
      check(fixtures.length === 2 && fixtures.every(f => allowed.has(f.clientId)), 'allowed_fixture_ids_mismatch');
      const identity = await local('/api/username');
      check(identity.ok && typeof identity.result?.username === 'string' &&
        identity.result.username.toLowerCase() === config.guest.email.toLowerCase(), 'local_octo_guest_session_required');
      for (const fixture of fixtures) {
        const p = await store.get(fixture.profileId);
        check(p && p.clientId === fixture.clientId && p.uuid && (p.createdAt >= startedAt || resumeIds.has(p.id)) &&
          resumableProfile(p) && (!p.grant || resumeIds.has(p.id)) &&
          p.original.description === `unicorn-octo:${p.operationId}` &&
          p.original.start_pages.some(url => new URL(url).searchParams.get('search') === fixture.name.toLowerCase()), 'new_profile_binding_failed');
        const remote = await cloud.getProfile(p.uuid);
        check(remote.description === p.original.description && remote.title === p.original.title && inFolder(remote, homeFolder) &&
          remote.has_user_password === !p.grant && remote.status === 0 && !(await active()).has(normalizeUuid(p.uuid)),
          'new_profile_cloud_binding_failed');
        bound.set(p.id, p);
      }
      check(new Set([...bound.values()].map(p => normalizeUuid(p.uuid!))).size === 2, 'two_unique_profile_uuids_required');
      check([...resumeIds].every(id => bound.has(id)), 'resume_profile_ids_unused_or_unknown');
    },
    async open(access, secondCycle, otherPassword) {
      const p = guard(access.fixture.profileId), uuid = p.uuid!;
      check(!(await active()).has(normalizeUuid(uuid)), 'profile_must_be_stopped_before_open');
      check(access.password === p.password, 'stored_password_ui_mismatch');
      expiries.set(uuid, access.expiresAt);
      const published = await cloud.getProfile(uuid);
      check(inFolder(published, config.guestFolder) && published.title === access.alias && published.has_user_password && published.status === 0,
        'profile_not_published_before_password_check');
      check(/^\d{5}$/.test(otherPassword) && otherPassword !== access.password, 'other_client_password_invalid');
      const wrongResult = await local('/api/profiles/start', { uuid, password: otherPassword, headless: false, debug_port: true, only_local: true, timeout: 50 });
      if ((await active()).has(normalizeUuid(uuid))) { opened.add(uuid); throw new AcceptanceFailure('other_client_password_opened_profile'); }
      check(!wrongResult.ok, 'wrong_password_not_rejected');
      // Track before attempting a possibly uncertain start, so failures can close only our own scoped UUID.
      opened.add(uuid);
      const started = await localApi.startProfile(uuid, access.password).catch(() => {
        throw new AcceptanceFailure('profile_start_failed');
      });
      check(normalizeUuid(started.uuid) === normalizeUuid(uuid) && started.state === 'STARTED' &&
        Number.isInteger(started.debug_port) && started.debug_port! > 0 && started.debug_port! <= 65535, 'profile_start_failed');
      const remote = await chromium.connectOverCDP(`http://127.0.0.1:${started.debug_port}`);
      const page = remote.contexts()[0]?.pages()[0] ?? await remote.contexts()[0].newPage();
      await page.goto(`https://en.wikipedia.org/w/index.php?search=${access.fixture.name.toLowerCase()}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const heading = await page.locator('#firstHeading').innerText();
      const content = await page.locator('#mw-content-text').innerText();
      const identity = new RegExp(`\\b${access.fixture.name}\\b`, 'i');
      check(identity.test(heading) && identity.test(content), 'wikipedia_fixture_identity_mismatch');
      windows.set(p.id, page);
      if (secondCycle) {
        const saved = await page.evaluate(key => localStorage.getItem(key), markerKey);
        check(saved === markerValue.get(p.id), 'local_storage_marker_not_restored');
      } else {
        const value = `${access.fixture.name}:${Date.now()}`;
        markerValue.set(p.id, value);
        await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: markerKey, value });
      }
    },
    async afterExpiry(access) {
      const p = guard(access.fixture.profileId);
      check(Date.now() >= access.expiresAt, 'expiry_not_reached');
      await until(async () => {
        const remote = await cloud.getProfile(p.uuid!);
        return inFolder(remote, homeFolder) && remote.title === p.original.title && remote.description === p.original.description &&
          remote.has_user_password === true && remote.status === 1;
      }, 90_000, 'expired_running_profile_not_private');
      check((await active()).has(normalizeUuid(p.uuid!)), 'browser_closed_at_expiry');
      const page = windows.get(p.id)!;
      check(!page.isClosed() && await page.evaluate(key => localStorage.getItem(key), markerKey) === markerValue.get(p.id), 'browser_not_usable_after_expiry');
      const afterHideValue = `${access.fixture.name}:after-hide:${Date.now()}`;
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: markerKey, value: afterHideValue });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      check(await page.evaluate(key => localStorage.getItem(key), markerKey) === afterHideValue, 'after_hide_marker_reload_failed');
      markerValue.set(p.id, afterHideValue);
    },
    async stop(access) { await closeUuid(guard(access.fixture.profileId).uuid!); },
    async afterComplete(access) {
      const p = guard(access.fixture.profileId);
      await until(async () => (await store.get(p.id))?.grant?.phase === 'complete', 90_000, 'sql_grant_not_complete');
      const saved = await store.get(p.id), remote = await cloud.getProfile(p.uuid!);
      check(saved?.password === p.password && remote.has_user_password === false && remote.status === 0 && inFolder(remote, homeFolder) &&
        remote.title === p.original.title && remote.description === p.original.description, 'cleanup_readback_failed');
      expiries.delete(p.uuid!);
    },
    async cleanup() {
      let failure: AcceptanceFailure | undefined;
      for (const uuid of [...opened]) {
        try {
          let running = false;
          await untilRead(async () => { running = (await active()).has(normalizeUuid(uuid)); return true; },
            90_000, 'cleanup_active_read_deadline_exceeded');
          if (running) await closeUuid(uuid);
          else opened.delete(uuid);
        } catch (error) {
          // A stop is never retried after an uncertain result. Continue readback/other scoped closes.
          failure ??= error instanceof AcceptanceFailure ? error : new AcceptanceFailure('octo_cleanup_failed');
        }
      }
      for (const p of bound.values()) {
        // A resumed baseline grant is already complete; its old expiry cannot bound a newly requested grant.
        const expiry = expiries.get(p.uuid!) ?? Date.now() + config.leaseMs;
        const deadline = Math.max(Date.now(), expiry) + 90_000;
        try {
          await untilRead(async () => {
            const saved = await store.get(p.id);
            if (saved && !saved.grant) return true;
            const remote = await cloud.getProfile(p.uuid!);
            return saved?.grant?.phase === 'complete' && remote.status === 0 && !remote.has_user_password && inFolder(remote, homeFolder);
          }, deadline - Date.now(), 'cleanup_deadline_exceeded');
        } catch (error) {
          failure ??= error instanceof AcceptanceFailure ? error : new AcceptanceFailure('octo_cleanup_failed');
        }
      }
      if (failure) throw failure;
    },
    close: () => pool.end()
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let driver: ReturnType<typeof createLiveConsoleDriver> | undefined;
  try {
    if (process.env.OCTO_E2E_LIVE === '1') driver = createLiveConsoleDriver();
    const report = await runConsoleFlow({ driver });
    console.log(JSON.stringify(report));
    if (!report.passed) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ passed: false, error: 'octo_console_runner_initialization_failed' }));
    process.exitCode = 1;
  } finally { await driver?.close(); }
}
