// Password-free acceptance on a different owner PC; never installed in the backend.
import { open, readFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createOctoApi } from '../../octo-access-test/octo-api.mts';
import { createAcceptanceDesktop } from './desktop.mts';
import type { AcceptanceDesktop } from './desktop.mts';
import { accountDigest, assertNewFixture, failureFields, parsePreflight, parseRequest, profileIdentity,
  requestDigest, requireCheck } from './contract.mts';
import type { OwnerPreflight, OwnerProof } from './contract.mts';
import { machineIdentity, readJson, writeJson } from './files.mts';
export async function prepareOwner(output: string, env: NodeJS.ProcessEnv = process.env) {
  requireCheck(env.OCTO_ARCHIVE_OWNER_LIVE === '1' && env.OCTO_E2E_OWNER_EMAIL && env.OCTO_API_TOKEN,
    'archive_owner_opt_in_required');
  const desktop = createAcceptanceDesktop();
  requireCheck(await desktop.username() === env.OCTO_E2E_OWNER_EMAIL.toLowerCase(), 'archive_owner_session_required');
  const api = createOctoApi(env.OCTO_API_TOKEN, fetch, { cloudOnly: true }), knownProfiles: string[] = [];
  for (let page = 0; page < 10_000; page++) {
    const rows = await api.cloudRequest(`/profiles?page_len=100&page=${page}`);
    requireCheck(Array.isArray(rows), 'archive_inventory_invalid');
    for (const row of rows) { requireCheck(/^[a-f0-9]{32}$/.test(row.uuid), 'archive_inventory_invalid'); knownProfiles.push(row.uuid); }
    if (rows.length < 100) break;
    requireCheck(page < 9999, 'archive_inventory_limit');
  }
  const result: OwnerPreflight = { schema: 1, id: randomUUID(), machine: machineIdentity(),
    account: accountDigest(env.OCTO_E2E_OWNER_EMAIL), preparedAt: Date.now(), knownProfiles };
  // Never overwrite an earlier preflight/ledger and turn an already-used machine into a fresh one.
  await mkdir(dirname(resolve(output)), { recursive: true });
  const file = await open(output, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(result, null, 2)); } finally { await file.close(); }
  return result;
}
async function fixtureSeenInLogs(uuid: string) {
  const root = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Octo Browser', 'logs');
  const files = (await readdir(root)).filter(n => /^debug\.log(?:\.\d+)?$/.test(n));
  requireCheck(files.length > 0, 'archive_owner_logs_required');
  for (const name of files) if ((await readFile(join(root, name), 'utf8')).includes(uuid)) return true;
  return false;
}
async function archiveErrors(uuid: string): Promise<NonNullable<OwnerProof['archiveErrors']>> {
  const root = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Octo Browser', 'logs');
  const found = new Set<NonNullable<OwnerProof['archiveErrors']>[number]>();
  for (const name of (await readdir(root)).filter(n => /^debug\.log(?:\.\d+)?$/.test(n))) {
    const lines = (await readFile(join(root, name), 'utf8')).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) if (lines[i].includes(uuid) && lines[i].includes('[ERROR]')) {
      const traceback: string[] = [];
      for (const line of lines.slice(i + 1, i + 65)) {
        if (/^\d{4}-\d{2}-\d{2} /.test(line)) break;
        traceback.push(line);
      }
      const context = traceback.join('\n');
      for (const code of ['ProfileRequiresUserPasswordError', 'InvalidProfilePasswordException'] as const)
        if (context.includes(code)) found.add(code);
    }
  }
  return [...found];
}
type OwnerDependencies = {
  desktop?: Pick<AcceptanceDesktop, 'username' | 'active' | 'start' | 'connect' | 'matches' | 'stop' | 'attempted'>;
  api?: Pick<ReturnType<typeof createOctoApi>, 'cloudRequest' | 'listFolders' | 'getProfile'>;
  machine?: () => string; seenInLogs?: (uuid: string) => Promise<boolean>;
};
export async function verifyOnOwner(options: { requestPath: string; preflightPath: string },
  env: NodeJS.ProcessEnv = process.env, deps: OwnerDependencies = {}): Promise<OwnerProof> {
  requireCheck(env.OCTO_ARCHIVE_OWNER_LIVE === '1' && env.OCTO_API_TOKEN && env.OCTO_E2E_OWNER_EMAIL,
    'archive_owner_opt_in_required');
  const request = parseRequest(await readJson(options.requestPath)), preflight = parsePreflight(await readJson(options.preflightPath));
  assertNewFixture(request, preflight);
  requireCheck(preflight.machine === (deps.machine ?? machineIdentity)() && preflight.account === accountDigest(env.OCTO_E2E_OWNER_EMAIL),
    'archive_owner_preflight_mismatch');
  const proof: OwnerProof = { schema: 1, requestId: request.id, digest: requestDigest(request), machine: preflight.machine,
    account: preflight.account, uuid: request.profile.uuid, cycle: request.cycle, startedAt: Date.now(), finishedAt: 0,
    fresh: false, passed: false, noPassword: false, markers: false, identity: false, stopped: false };
  const desktop = deps.desktop ?? createAcceptanceDesktop();
  const api = deps.api ?? createOctoApi(env.OCTO_API_TOKEN, fetch, { cloudOnly: true });
  const ledgerPath = `${resolve(options.preflightPath)}.ledger.json`, lockPath = `${ledgerPath}.lock`;
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    const ledger: { requests: string[]; profiles: Record<string, number> } = await readJson(ledgerPath).catch(e => {
      if (e.code !== 'ENOENT') throw e; return { requests: [], profiles: {} };
    });
    requireCheck(!ledger.requests.includes(request.id), 'archive_owner_attempt_already_recorded');
    requireCheck(await desktop.username() === env.OCTO_E2E_OWNER_EMAIL.toLowerCase(), 'archive_owner_session_required');
    requireCheck(!(await desktop.active()).includes(request.profile.uuid), 'archive_owner_profile_already_running');
    if (request.cycle === 1) {
      requireCheck(!ledger.profiles[request.profile.uuid] && !await (deps.seenInLogs ?? fixtureSeenInLogs)(request.profile.uuid),
        'archive_owner_cache_not_fresh');
      proof.fresh = true;
    } else requireCheck(ledger.profiles[request.profile.uuid] === request.cycle - 1, 'archive_owner_cycle_out_of_order');
    const remote = await api.cloudRequest(`/profiles/${request.profile.uuid}`);
    const folder = typeof remote.folder === 'string' ? remote.folder : remote.folder?.uuid;
    const folders = await api.listFolders();
    const expectedFolder = folders.find(f => f.uuid === request.profile.folder);
    requireCheck(remote.uuid === request.profile.uuid && remote.title === request.profile.title &&
      remote.description === request.profile.description && expectedFolder &&
      [expectedFolder.uuid, expectedFolder.name].includes(folder) && remote.status === 0 &&
      profileIdentity(remote) === request.profile.identity, 'archive_owner_identity_mismatch');
    proof.identity = true;
    ledger.requests.push(request.id);
    // Journal before launch. Unknown outcomes are not retried.
    ledger.profiles[request.profile.uuid] = -request.cycle; await writeJson(ledgerPath, ledger);
    requireCheck(await desktop.username() === env.OCTO_E2E_OWNER_EMAIL.toLowerCase(), 'archive_owner_session_required');
    requireCheck(remote.has_user_password === false, 'archive_owner_still_protected');
    const port = await desktop.start(request.profile.uuid); // Intentionally no password argument.
    proof.noPassword = true; await desktop.connect(request.profile.uuid, port);
    proof.markers = await desktop.matches(request.profile.uuid, request.marker);
    requireCheck(proof.markers, 'archive_owner_saved_markers_missing');
    requireCheck(profileIdentity(await api.cloudRequest(`/profiles/${request.profile.uuid}`)) === request.profile.identity,
      'archive_owner_identity_changed');
    await desktop.stop(request.profile.uuid); proof.stopped = true;
    const closed = await api.getProfile(request.profile.uuid);
    requireCheck(closed.status === 0 && closed.has_user_password === false, 'archive_owner_final_state_invalid');
    proof.passed = true; ledger.profiles[request.profile.uuid] = request.cycle; await writeJson(ledgerPath, ledger);
  } catch (error) {
    Object.assign(proof, failureFields(error));
    // Export only known exception names, never log lines, archive contents or credentials.
    if (!deps.desktop) proof.archiveErrors = await archiveErrors(request.profile.uuid).catch(() => []);
  }
  finally {
    // Only this invocation's attempted UUID is eligible. A lost stop response is never retried.
    for (const uuid of desktop.attempted()) {
      try { await desktop.stop(uuid); proof.stopped = true; }
      catch { proof.passed = false; proof.error ??= 'archive_owner_close_requires_review'; }
    }
    proof.finishedAt = Date.now();
    try { await writeJson(options.requestPath.replace(/\.request\.json$/, '') + '.proof.json', proof); }
    finally {
      await lock.close();
      const { unlink } = await import('node:fs/promises'); await unlink(lockPath);
    }
  }
  return proof;
}
