// Explicit operator E2E for the two approved fixtures. Default: read-only preflight.
// Uses the published worker; desktop switching requires --switch-desktop and an isolated bridge journal.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { ManagedProfile, ProxyInput } from '../../octo-access/contracts.mts';
import { createCreatorDesktopSession, assertCreatorGuestProof } from './linkedin-creator-session.mts';
const require = createRequire(import.meta.url), express = require('express');
const { createWebConsoleApp } = require('../backend/app.ts');
const { openSqlConsole } = await import('../backend/postgres/runtime.mts');
const { readOctoConfig } = await import('../../octo-access/config.mts');
const { readControlConfig } = await import('../../octo-access/control-config.mts');
const { controlPath } = await import('../../octo-access/control-routes.mts');
const { controlIdentity } = await import('../../octo-access/control-identity.mts');
const { createOctoPostgresStore } = await import('../../octo-access/postgres-store.mts');
const { createCloudApi } = await import('../../octo-access/cloud-api.mts');
const { reserveClientProfiles } = await import('../../octo-access/profile-reservation.mts');
const { parseProxyInput } = await import('../../octo-access/proxy-input.mts');
const { inFolder } = await import('../../octo-access/provision.mts');
const { createOctoApi } = await import('../../octo-access-test/octo-api.mts');
const { readPostgresAppDbConfig } = await import('../../../platform/db/postgres/config.mts');
const { createPostgresPool } = await import('../../../integrations/postgres/pg-pool.mts');
const { createReadSession } = await import('../../../integrations/postgres/read-session.mts');
const apply = process.argv.includes('--apply-denis');
const switching = process.argv.includes('--switch-desktop');
if (process.argv.slice(2).some(v => !['--apply-denis', '--preflight', '--proxy-from-octon', '--switch-desktop'].includes(v))) throw Error('invalid_e2e_argument');
const config = readOctoConfig(process.env), control = readControlConfig(process.env);
if (!config) throw Error('octo_configuration_required');
const db = readPostgresAppDbConfig(process.env), pool = createPostgresPool(db), read = createReadSession(pool, db.database);
const profiles = createOctoPostgresStore(pool, db.database), cloud = createCloudApi(process.env.OCTO_API_TOKEN!);
const desktop = createOctoApi(process.env.OCTO_API_TOKEN!, fetch, { debugPort: true });
const report = { passed: false, apply, blockers: [] as string[], desktopRole: 'unknown',
  independentGuestDesktopVerified: false, results: [] as object[], error: undefined as string | undefined };
const output = 'tmp/linkedin-creation/denis-access';
let runtime: Awaited<ReturnType<typeof openSqlConsole>> | undefined;
let server: import('node:http').Server | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let stage = 'preflight';
let session: ReturnType<typeof createCreatorDesktopSession> | undefined;
let journal: any, bridgeAgent: any;
const attempted = new Set<string>(), stopSent = new Set<string>();
function check(value: unknown, code: string): asserts value { if (!value) throw Object.assign(Error(code), { code }); }
async function until(fn: () => Promise<boolean>, code: string, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  do { if (await fn()) return; await new Promise(r => setTimeout(r, 1000)); } while (Date.now() < deadline);
  check(false, code);
}
async function local(path: string, body?: unknown) {
  const response = await fetch('http://127.0.0.1:58888' + path, { method: body ? 'POST' : 'GET', redirect: 'error',
    signal: AbortSignal.timeout(55_000), ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json(); check(response.ok && !data?.error && !data?.error_code && data?.success !== false, 'denis_e2e_desktop_failed'); return data;
}
async function closeAttempt(uuid: string) {
  if (!attempted.has(uuid) || !(await desktop.activeProfiles()).includes(uuid)) return;
  check(!stopSent.has(uuid), 'denis_e2e_close_uncertain'); stopSent.add(uuid);
  await local('/api/profiles/stop', { uuid });
  await until(async () => !(await desktop.activeProfiles()).includes(uuid), 'denis_e2e_close_timeout', 90_000);
  attempted.delete(uuid);
}
async function workerReady(p: ManagedProfile) {
  if (!config || !control?.url) return false;
  const identity = controlIdentity(p, config);
  const response = await fetch(control.url + controlPath + '/ready', { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${control.secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: p.clientId, profileId: p.id, identity }) });
  const body = await response.json().catch(() => null);
  return response.ok && body?.ready === true && body.identity === identity;
}
try {
  const targets = await read(async s => (await s.query(`SELECT t.id,t.client_id,t.status,c.calendar_email,c.legend_info,c.client_status
    FROM noco.linkedin_creation_task t JOIN noco.clients c ON c.id=t.client_id WHERE t.id IN (1,9) ORDER BY t.id`)).rows);
  check(targets.length === 2 && Number(targets[0].client_id) === 261 && String(targets[0].calendar_email).trim().toLowerCase() === 'octoguide@julian.com' &&
    Number(targets[1].client_id) === 266 && targets[1].legend_info === 'linkedin-creation-demo:v1:denis' &&
    targets[1].client_status === 'paused', 'denis_e2e_fixture_mismatch');
  check(targets.every(t => t.status !== 'выполнение подтверждено'), 'denis_e2e_fixture_confirmed');
  const before = await profiles.list(), first = before.find(p => p.clientId === 261 && p.locale === 'en');
  check(first?.uuid && first.phase === 'ready', 'denis_e2e_original_en_missing');
  check(before.filter(p => p.clientId === 261 && p.locale === 'en').length === 1, 'denis_e2e_ambiguous_profile');
  const originalRu = before.filter(p => p.clientId === 261 && p.locale === 'ru');
  const originalProxy = (await cloud.readProfileProxy!(first.uuid)).saved;
  check(originalProxy && originalProxy.uuid === first.proxy?.uuid, 'denis_e2e_original_proxy_mismatch');
  check(!before.some(p => p.grant && p.grant.phase !== 'complete' || p.proxyChange && p.proxyChange.phase !== 'complete' || p.pending || p.deletion),
    'denis_e2e_other_operation_active');
  await cloud.validateGuest(config.guest.email, config.guestFolder);
  let proxy: ProxyInput | undefined;
  let proxySourceUuid = originalProxy.uuid;
  let proxySourceProfile: ManagedProfile | undefined;
  if (process.env.LINKEDIN_CREATOR_E2E_PROXY_JSON) {
    try { proxy = parseProxyInput(JSON.parse(process.env.LINKEDIN_CREATOR_E2E_PROXY_JSON)); }
    catch { check(false, 'denis_e2e_test_proxy_invalid'); }
  }
  // Октон (257) and OctoGuide (261) are different clients. Never infer the source from a similar name.
  if (process.argv.includes('--proxy-from-octon')) {
    const sources = before.filter(p => p.clientId === 257 && p.locale === 'en');
    check(sources.length === 1 && sources[0].uuid, 'denis_e2e_proxy_source_missing');
    const name = await read(async s => (await s.query('SELECT client_name FROM noco.clients WHERE id=257')).rows[0]);
    check(String(name?.client_name).trim() === 'Октон Октонович', 'denis_e2e_proxy_source_mismatch');
    proxySourceProfile = sources[0];
    const source = (await cloud.readProfileProxy!(proxySourceProfile.uuid!)).saved;
    check(source, 'denis_e2e_proxy_source_missing');
    proxy = parseProxyInput(source); proxySourceUuid = source.uuid;
  }
  if (!proxy) report.blockers.push('demo_proxy_form_input_required');
  if (!control?.url) report.blockers.push('shared_worker_control_not_configured');
  else if (!(await workerReady(first))) report.blockers.push('shared_worker_control_not_ready');
  const identity = await local('/api/username'), username = String(identity.username || '').toLowerCase();
  if (username === config.guest.email.toLowerCase()) report.desktopRole = 'guest';
  else {
    const bridge = JSON.parse(await readFile('octo-bridge/bridge.config.json', 'utf8'));
    if (username === String(bridge.ownerEmail || '').toLowerCase()) report.desktopRole = 'owner';
    else report.blockers.push('desktop_account_not_recognized');
  }
  if ((await desktop.activeProfiles()).length) report.blockers.push('desktop_has_active_profiles');
  if (switching && !process.env.LINKEDIN_CREATOR_E2E_BRIDGE_CONFIG) report.blockers.push('desktop_bridge_configuration_required');
  if (switching && !process.env.OCTO_E2E_OWNER_PASSWORD) report.blockers.push('owner_desktop_credentials_required');
  if (!switching && report.desktopRole !== 'guest') report.blockers.push('guest_desktop_required');
  if (!apply) { report.passed = report.blockers.length === 0; }
  else {
    check(report.blockers.length === 0, 'denis_e2e_preflight_blocked');
    if (switching) {
      const path = resolve(process.env.LINKEDIN_CREATOR_E2E_BRIDGE_CONFIG!);
      const bridge = JSON.parse(await readFile(path, 'utf8'));
      check(new URL(bridge.backendUrl).origin === control!.url, 'denis_e2e_bridge_target_mismatch');
      check(bridge.allowAllManagedProfiles !== true && Array.isArray(bridge.allowedProfileUuids) &&
        bridge.allowedProfileUuids.length === 2 && bridge.allowedProfileUuids.every((uuid: string) =>
          before.some(p => [261,266].includes(p.clientId) && p.locale === 'en' && p.uuid === uuid)), 'denis_e2e_bridge_scope_mismatch');
      const { createAgent } = require(resolve('octo-bridge/agent.mjs'));
      const { openJournal } = require(resolve('octo-bridge/journal.mjs'));
      journal = await openJournal(resolve(path, '../.state/journal.json'), bridge);
      bridgeAgent = createAgent({ config: bridge, journal });
      session = createCreatorDesktopSession({ local, guest: config.guest,
        owner: { email: bridge.ownerEmail, token: process.env.OCTO_API_TOKEN!, password: process.env.OCTO_E2E_OWNER_PASSWORD } });
      await session.owner();
      await bridgeAgent.check();
    }
    runtime = await openSqlConsole(process.env); // No startBackground(): the published worker performs all work.
    const app = createWebConsoleApp({ ...runtime.options, useMockData: true, initializeConnectionInviter: false });
    app.use(express.static(resolve('dist/web-console')));
    app.use((r: import('express').Request, s: import('express').Response) => r.path.startsWith('/api/')
      ? s.status(404).json({ error: 'not_found' }) : s.sendFile(resolve('dist/web-console/index.html')));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server!.once('listening', r));
    const url = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    browser = await chromium.launch({ headless: false }); const context = await browser.newContext();
    const page = await context.newPage(); page.setDefaultTimeout(30_000); await page.goto(url);
    await page.getByTestId('email-input').fill(process.env.LINKEDIN_CREATOR_LOGIN!);
    await page.locator('#password').fill(process.env.LINKEDIN_CREATOR_PASSWORD!); await page.getByTestId('login-button').click();
    await page.getByTestId('linkedin-creator-console').waitFor();
    for (const [taskId, clientId] of [[1, 261], [9, 266]] as const) {
      stage = `task-${taskId}-prepare`; console.log(JSON.stringify({ stage }));
      if (taskId === 9 && !(await profiles.list(266)).length) {
        const client = await runtime.options.repository.getClientById(266);
        // Fixture adapter only: no Telegram destination is written to the real client.
        await reserveClientProfiles(profiles, { ...client, market: 'En', commonChatId: 'DEMO-NO-TELEGRAM-266' }, true);
      }
      let p: ManagedProfile | undefined;
      await until(async () => { p = (await profiles.list(clientId)).find(p => p.locale === 'en');
        check(p?.phase !== 'blocked', 'denis_e2e_profile_blocked'); return p?.phase === 'ready'; }, 'denis_e2e_profile_timeout');
      check(p?.uuid, 'denis_e2e_profile_missing'); const bound = p;
      // A newly provisioned UUID must enter the shared listener before requesting access.
      await until(() => workerReady(bound), 'denis_e2e_listener_timeout', 60_000);
      await page.getByRole('button', { name: 'Обновить список', exact: true }).click();
      await page.getByTestId(`creation-task-${taskId}`).click(); await page.getByTestId('creation-task-detail').waitFor();
      check(await page.locator('.octo-profile').count() === 1, 'denis_e2e_en_scope_failed');
      if (taskId === 9) {
        // Mandatory on every apply run, even when this fixture already has a proxy.
        stage = 'task-9-proxy-form'; console.log(JSON.stringify({ stage }));
        const form = page.getByTestId(`octo-proxy-form-${bound.id}`);
        const kind = form.getByTestId(`octo-proxy-${bound.id}-type`);
        await kind.focus(); await kind.press('Home');
        const option = ['http','https','socks4','socks5'].indexOf(proxy!.type);
        for (let i = 0; i < option; i++) await kind.press('ArrowDown');
        await kind.press('Enter'); check(await kind.inputValue() === proxy!.type, 'denis_e2e_proxy_type_not_selected');
        for (const [label, value] of [['Адрес прокси', proxy!.host], ['Порт прокси', String(proxy!.port)],
          ['Логин прокси', proxy!.login], ['Пароль прокси', proxy!.password], ['URL смены IP (необязательно)', proxy!.changeIpUrl || '']]) {
          const input = form.getByLabel(label, { exact: true });
          await input.click(); await input.press('ControlOrMeta+A'); await input.press('Backspace');
          if (value) await input.pressSequentially(value, { delay: 18 });
        }
        await form.getByRole('button', { name: 'Сохранить прокси', exact: true }).click();
        await page.getByText('Прокси отправлен на сохранение.', { exact: true }).waitFor();
        await until(async () => { const p = await profiles.get(bound.id);
          check(p?.proxyChange?.phase !== 'blocked', 'denis_e2e_proxy_blocked'); return p?.proxyChange?.phase === 'complete'; }, 'denis_e2e_proxy_timeout');
        const saved = (await cloud.readProfileProxy!(bound.uuid!)).saved, stored = await profiles.get(bound.id);
        check(saved && stored?.proxy?.uuid === saved.uuid && saved.uuid !== proxySourceUuid && saved.uuid !== originalProxy.uuid && saved.profiles_count === 1 &&
          ['type','host','port','login','password','changeIpUrl'].every(k =>
            ((saved as any)[k] ?? '') === ((proxy as any)[k] ?? '')), 'denis_e2e_proxy_not_persisted');
      }
      if (session) await session.guest();
      check(String((await local('/api/username')).username || '').toLowerCase() === config.guest.email.toLowerCase(), 'denis_e2e_guest_identity_required');
      const grantResponse = page.waitForResponse(r => r.url().endsWith(`/tasks/${taskId}/octo/grants`) && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Получить доступ', exact: true }).click();
      const issued = await grantResponse; check(issued.ok(), 'denis_e2e_grant_failed'); const grantId = (await issued.json()).id;
      let grant: any;
      await until(async () => { const response = await context.request.get(`${url}/api/linkedin-creator/tasks/${taskId}/octo/grants/${grantId}`);
        check(response.ok(), 'denis_e2e_grant_read_failed'); grant = await response.json();
        check(grant.phase !== 'blocked', 'denis_e2e_grant_blocked'); return grant.phase === 'granted'; }, 'denis_e2e_grant_timeout');
      const published = await cloud.getProfile(bound.uuid!);
      check(inFolder(published, config.guestFolder) && published.title === grant.alias && grant.password === bound.password,
        'denis_e2e_publication_mismatch');
      stage = `task-${taskId}-open`; console.log(JSON.stringify({ stage })); attempted.add(bound.uuid!);
      const opened = await desktop.startProfile(bound.uuid!, grant.password);
      check(opened.state === 'STARTED' && (await desktop.activeProfiles()).includes(bound.uuid!), 'denis_e2e_open_failed');
      check(String((await local('/api/username')).username || '').toLowerCase() === config.guest.email.toLowerCase(), 'denis_e2e_guest_identity_required');
      await closeAttempt(bound.uuid!);
      stage = `task-${taskId}-cleanup`; console.log(JSON.stringify({ stage }));
      if (session) await session.owner();
      await until(async () => {
        if (bridgeAgent) await bridgeAgent.step();
        return (await profiles.get(bound.id))?.grant?.phase === 'complete';
      }, 'denis_e2e_cleanup_timeout', 300_000);
      stage = `task-${taskId}-capture`; console.log(JSON.stringify({ stage }));
      await page.getByRole('button', { name: 'Сохранить настройки прокси', exact: true }).click();
      await page.getByText('Настройки прокси сохранены.', { exact: true }).waitFor();
      const receipt = await read(async s => (await s.query('SELECT proxy_profile_id,proxy_uuid,proxy_saved_at FROM noco.linkedin_creation_task WHERE id=$1', [taskId])).rows[0]);
      check(Number(receipt?.proxy_profile_id) === bound.id && receipt.proxy_uuid === (await profiles.get(bound.id))?.proxy?.uuid &&
        !!receipt.proxy_saved_at, 'denis_e2e_proxy_receipt_missing');
      if (taskId === 9) {
        const expected = { url: 'https://www.linkedin.com/in/veu-e2e-demo-266', login: 'denis-demo@example.invalid', password: 'DEMO-ONLY-NO-REAL-ACCOUNT' };
        for (const [label, value] of [['Ссылка LinkedIn', expected.url], ['Логин LinkedIn', expected.login], ['Пароль LinkedIn', expected.password]])
          await page.getByLabel(label, { exact: true }).fill(value);
        await page.getByRole('button', { name: 'Сохранить данные LinkedIn', exact: true }).click();
        await page.getByText('Данные LinkedIn сохранены.', { exact: true }).waitFor();
        const account = await read(async s => (await s.query(`SELECT a.url,a.login,a.password FROM noco.platform_accounts a
          JOIN noco.linkedin_creation_task t ON t.linkedin_account_id=a.id WHERE t.id=9 AND t.client_id=266`)).rows[0]);
        check(account?.url === expected.url && account.login === expected.login && account.password === expected.password, 'denis_e2e_result_not_persisted');
        await page.getByLabel('Статус заявки').selectOption('сделана экспертом');
        await page.getByRole('button', { name: 'Сохранить статус', exact: true }).click(); await page.getByText('Статус сохранён.', { exact: true }).waitFor();
        await page.reload(); await page.getByTestId('creation-task-9').click(); await page.getByTestId('creation-task-detail').waitFor();
        check(await page.getByLabel('Логин LinkedIn', { exact: true }).inputValue() === expected.login &&
          await page.getByLabel('Статус заявки').inputValue() === 'сделана экспертом', 'denis_e2e_reload_failed');
      }
      const final = await profiles.get(bound.id), live = await cloud.getProfile(bound.uuid!);
      check(final && final.uuid === bound.uuid && final.password === bound.password && final.grant?.phase === 'complete' &&
        live.status === 0 && inFolder(live, config.homeFolder) && live.title === bound.original.title, 'denis_e2e_final_state_invalid');
      if (taskId === 1) check((await cloud.readProfileProxy!(bound.uuid!)).saved?.uuid === originalProxy.uuid, 'denis_e2e_original_proxy_changed');
      report.results.push({ taskId, clientId, profileId: bound.id, guestVerified: true, opened: true, closed: true, accessComplete: true,
        proxyCaptured: true, proxyFormSubmitted: taskId === 9, proxySqlVerified: true, resultSaved: taskId === 9, expertDone: taskId === 9 });
    }
    check(JSON.stringify((await profiles.list(261)).filter(p => p.locale === 'ru')) === JSON.stringify(originalRu), 'denis_e2e_ru_changed');
    if (proxySourceProfile) check(JSON.stringify(await profiles.get(proxySourceProfile.id)) === JSON.stringify(proxySourceProfile), 'denis_e2e_proxy_source_changed');
    assertCreatorGuestProof(report.results as Array<{ taskId: number; guestVerified?: boolean }>);
    report.independentGuestDesktopVerified = true; report.passed = true;
  }
} catch (e) {
  const code = (e as { code?: string }).code ?? '';
  report.error = /^(denis_e2e_|octo_|linkedin_task_|postgres_|commit_)[a-z0-9_]+$/.test(code) ? code : 'denis_e2e_failed';
} finally {
  for (const uuid of attempted) await closeAttempt(uuid).catch(() => { report.passed = false; report.error = 'denis_e2e_close_requires_review'; });
  if (session) await session.owner().catch(() => { report.passed = false; report.error = 'denis_e2e_owner_restore_requires_review'; });
  await journal?.close();
  await browser?.close(); await new Promise<void>(r => server ? server.close(() => r()) : r());
  await runtime?.close(); await pool.end();
  await mkdir(output, { recursive: true }); await writeFile(resolve(output, 'report.json'), JSON.stringify({ ...report, stage }, null, 2) + '\n');
  console.log(JSON.stringify(report)); if (!report.passed) process.exitCode = 1;
}
