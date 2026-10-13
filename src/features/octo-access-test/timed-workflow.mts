import { randomUUID } from 'node:crypto';
import { marker, NAMES, PASSWORDS, TestError } from './contract.mts';
import type { Folder, Octo, Profile, ProfileName } from './contract.mts';
import type { ActionPage } from './action-log.mts';
import { LEASE_MS, RECHECK_MS, validateTimedState } from './timed-contract.mts';
import type { Fixtures, TimedGrant, TimedState, TimedStore } from './timed-contract.mts';

const normalized = (id: string) => id.replaceAll('-', '').toLowerCase();
const inFolder = (profile: Profile, folder: Folder) => typeof profile.folder === 'string'
  ? profile.folder === folder.uuid || profile.folder === folder.name
  : profile.folder?.uuid === folder.uuid || profile.folder?.name === folder.name;
const safeCode = (error: unknown) => error instanceof TestError ? error.code : 'timed_backend_error';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Fixture-only contract: independent 45-second grants, hide first, clear after ordinary close.
// The API dependency intentionally has no stop or force-stop operation.
export async function createTimedWorkflow({ api, store, fixtures, now = Date.now, cloudOnly = false, waitForManualStart = false }: {
  api: Octo; store: TimedStore; fixtures: Fixtures; now?: () => number; cloudOnly?: boolean; waitForManualStart?: boolean;
}) {
  if (waitForManualStart && !cloudOnly) throw new TestError('manual_experiment_requires_cloud_mode');
  const loaded = await store.load();
  const state: TimedState = validateTimedState(loaded ?? { schema: 2, fixtureRunId: fixtures.runId, grants: {}, seenEvents: [] });
  if (state.fixtureRunId !== fixtures.runId) throw new TestError('timed_fixture_mismatch', 500);
  for (const name of NAMES) {
    const grant = state.grants[name];
    if (grant && (grant.uuid !== fixtures.profiles[name] || grant.original.description !== marker(fixtures.runId, name))) throw new TestError('timed_fixture_mismatch', 500);
  }
  let storageFailed = false;
  async function save() {
    if (storageFailed) throw new TestError('timed_storage_failed', 500);
    try { await store.save(structuredClone(state)); }
    catch { storageFailed = true; throw new TestError('timed_storage_failed', 500); }
  }
  if (!loaded) await save();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(() => { if (storageFailed) throw new TestError('timed_storage_failed', 500); return fn(); });
    queue = next.catch(() => {}); return next;
  };
  const summary = (g: TimedGrant) => ({ id: g.id, profile: g.name, uuid: g.uuid, alias: g.alias,
    phase: g.phase, grantedAt: g.grantedAt, expiresAt: g.expiresAt, completedAt: g.completedAt,
    error: g.error, lastTrigger: g.lastTrigger, startedEventId: g.startedEventId, stoppedEventId: g.stoppedEventId });
  const status = () => ({ mode: 'deferred-password', cloudOnly, leaseMs: LEASE_MS, storageFailed,
    grants: Object.fromEntries(Object.entries(state.grants).map(([name, g]) => [name, summary(g!)])) });
  const original = (p: Profile, g: TimedGrant) => p.title === g.original.title && p.description === g.original.description
    && same(p.tags ?? [], g.original.tags) && same(p.start_pages, g.original.start_pages);
  const masked = (p: Profile, g: TimedGrant) => p.title === g.alias && p.description === g.anonymousDescription;
  async function read(g: TimedGrant) {
    const p = await api.getProfile(g.uuid);
    if (normalized(p.uuid) !== normalized(g.uuid)) throw new TestError('fixture_changed');
    return p;
  }
  async function block(g: TimedGrant, error: unknown) {
    g.phase = 'blocked'; g.error = safeCode(error); await save();
  }
  async function write(g: TimedGrant, step: TimedGrant['pending'], fn: () => Promise<void>) {
    g.pending = step; await save();
    try { await fn(); }
    catch (error) { await block(g, error); throw error; }
  }
  function requireHome(p: Profile, name: ProfileName) {
    if (p.uuid !== fixtures.profiles[name] || p.description !== marker(fixtures.runId, name)
      || !inFolder(p, fixtures.folders.home) || p.has_user_password || p.status !== 0) throw new TestError('fixture_changed');
  }
  async function verifyFolders() {
    const folders = await api.listFolders();
    for (const f of Object.values(fixtures.folders)) if (!folders.some(found => found.uuid === f.uuid && found.name === f.name)) throw new TestError('fixture_folder_changed');
  }
  async function complete(g: TimedGrant) {
    g.phase = 'complete'; g.completedAt = now(); delete g.pending; delete g.error; await save();
  }
  // Recovery only confirms already-applied writes; it never resends an uncertain mutation.
  const recovery = new Set(Object.values(state.grants).filter(g => g?.pending).map(g => g!.name));
  async function recover(g: TimedGrant) {
    if (!recovery.has(g.name)) return;
    const p = await read(g);
    if (g.pending === 'clear' && inFolder(p, fixtures.folders.home) && original(p, g) && !p.has_user_password) {
      await complete(g);
    } else if (g.pending === 'hide' && inFolder(p, fixtures.folders.home) && original(p, g) && p.has_user_password) {
      g.phase = 'awaiting_close'; delete g.pending; delete g.error; await save();
    } else { await block(g, new TestError('interrupted_write_needs_review')); }
    recovery.delete(g.name);
  }
  async function hide(g: TimedGrant) {
    const p = await read(g);
    if (!inFolder(p, fixtures.folders.guest) || !masked(p, g) || !p.has_user_password) throw new TestError('fixture_changed');
    await write(g, 'hide', () => api.updateProfile(g.uuid, { ...g.original, folder: fixtures.folders.home.uuid }));
    const after = await read(g);
    if (!inFolder(after, fixtures.folders.home) || !original(after, g) || !after.has_user_password) throw new TestError('hide_verification_failed');
    g.phase = 'awaiting_close'; delete g.pending; await save();
  }
  async function clearIfClosed(g: TimedGrant, trigger: 'event' | 'poll') {
    const p = await read(g);
    if (!inFolder(p, fixtures.folders.home) || !original(p, g) || !p.has_user_password) throw new TestError('fixture_changed');
    if (p.status !== 0) return;
    if (cloudOnly) {
      // A cloud status reset alone is not evidence of ordinary closure.
      // Missing history keeps protection in place rather than guessing.
      if (!g.startedEventId || !g.stoppedEventId || g.lastEvent?.action !== 'profiles.stopped') return;
    } else {
      const active = await api.activeProfiles();
      if (active.some(id => normalized(id) === normalized(g.uuid))) return;
    }
    g.lastTrigger = trigger; g.pending = 'clear'; await save();
    try { await api.clearPassword(g.uuid, PASSWORDS[g.name]); }
    catch (error) {
      if (error instanceof TestError && error.code === 'octo_request_failed' && error.details?.upstreamCode === 'profiles.password_error') {
        delete g.pending; g.error = 'close_not_ready'; await save(); return;
      }
      await block(g, error); return;
    }
    const after = await read(g);
    if (!inFolder(after, fixtures.folders.home) || !original(after, g) || after.has_user_password) throw new TestError('clear_verification_failed');
    await complete(g);
  }
  async function reconcile(g: TimedGrant, trigger: 'event' | 'poll') {
    try {
      await recover(g);
      if (g.phase === 'blocked' || g.phase === 'complete' || g.phase === 'preparing' || g.phase === 'awaiting_start' || now() < g.expiresAt!) return;
      g.nextCheckAt = now() + RECHECK_MS;
      if (g.phase === 'granted') await hide(g);
      if (g.forceStopped) { await block(g, new TestError('force_stop_observed')); return; }
      await clearIfClosed(g, trigger);
      await save();
    } catch (error) {
      if (storageFailed) throw error;
      if (g.pending || ['fixture_changed', 'hide_verification_failed', 'clear_verification_failed'].includes(safeCode(error))) await block(g, error);
      else { g.error = safeCode(error); g.nextCheckAt = now() + RECHECK_MS; await save(); }
    }
  }
  return {
    status,
    cursor: () => state.cursor && { ...state.cursor },
    drain: () => queue,
    setup: () => serial(async () => { await verifyFolders(); return status(); }),
    inspect: () => serial(async () => {
      const profiles = [];
      for (const name of NAMES) { const p = await api.getProfile(fixtures.profiles[name]); profiles.push({ name, uuid: p.uuid, title: p.title, folder: p.folder, has_user_password: p.has_user_password, status: p.status }); }
      const active = cloudOnly ? profiles.filter(p => p.status === 1).map(p => p.uuid)
        : (await api.activeProfiles()).filter(id => Object.values(fixtures.profiles).some(uuid => normalized(id) === normalized(uuid)));
      return { ...status(), profiles, active, activeSource: cloudOnly ? 'cloud' : 'local' };
    }),
    grant: (name: ProfileName) => serial(async () => {
      const previous = state.grants[name];
      if (previous && previous.phase !== 'complete') {
        if (previous.phase === 'awaiting_start' && waitForManualStart) return { ...summary(previous), password: PASSWORDS[name] };
        if (previous.phase === 'granted' && now() < previous.expiresAt!) return { ...summary(previous), password: PASSWORDS[name] };
        throw new TestError('grant_cleanup_pending');
      }
      await verifyFolders();
      const p = await api.getProfile(fixtures.profiles[name]); requireHome(p, name);
      if (!cloudOnly && (await api.activeProfiles()).some(id => normalized(id) === normalized(p.uuid))) throw new TestError('fixture_running');
      const id = randomUUID();
      const g: TimedGrant = { id, name, uuid: p.uuid, alias: `John Doe ${id.slice(0, 8)}`, anonymousDescription: `octo-timed-test:${id}`,
        original: { title: p.title, description: p.description, tags: p.tags ?? [], start_pages: p.start_pages },
        phase: 'preparing', createdAt: now(), nextCheckAt: now() };
      state.grants[name] = g; await save();
      try {
        await write(g, 'protect', () => api.setPassword(g.uuid, PASSWORDS[name]));
        if (!(await read(g)).has_user_password) throw new TestError('protection_verification_failed');
        await write(g, 'mask', () => api.updateProfile(g.uuid, { title: g.alias, description: g.anonymousDescription, tags: [], start_pages: ['https://en.wikipedia.org/wiki/Main_Page'], folder: fixtures.folders.home.uuid }));
        await write(g, 'publish', () => api.updateProfile(g.uuid, { title: g.alias, folder: fixtures.folders.guest.uuid }));
        const visible = await read(g);
        if (!inFolder(visible, fixtures.folders.guest) || !masked(visible, g) || !visible.has_user_password) throw new TestError('publish_verification_failed');
        if (waitForManualStart) g.phase = 'awaiting_start';
        else { g.phase = 'granted'; g.grantedAt = now(); g.expiresAt = g.grantedAt + LEASE_MS; g.nextCheckAt = g.expiresAt; }
        delete g.pending; await save();
        return { ...summary(g), password: PASSWORDS[name] };
      } catch (error) { if (!storageFailed) await block(g, error); throw error; }
    }),
    start: (name: ProfileName, password?: string) => serial(async () => {
      if (cloudOnly) throw new TestError('manual_start_required');
      const g = state.grants[name];
      if (!g || g.phase !== 'granted' || now() >= g.expiresAt!) throw new TestError('grant_expired');
      return api.startProfile(g.uuid, password);
    }),
    tick: () => serial(async () => {
      for (const name of NAMES) {
        const g = state.grants[name];
        if (g && (recovery.has(name) || (['granted', 'awaiting_close'].includes(g.phase) && now() >= g.nextCheckAt))) await reconcile(g, 'poll');
      }
      return status();
    }),
    onPage: (page: ActionPage) => serial(async () => {
      const stopped = new Set<TimedGrant>();
      for (const event of page.events) {
        if (state.seenEvents.includes(event.id)) continue;
        state.seenEvents.push(event.id); state.seenEvents = state.seenEvents.slice(-500);
        const g = Object.values(state.grants).find(g => g && normalized(g.uuid) === normalized(event.profileId));
        if (!g || ['complete', 'blocked'].includes(g.phase) || event.time < Math.floor(g.createdAt / 1000)) continue;
        g.lastEvent = { id: event.id, action: event.action, time: event.time };
        if (event.action === 'profiles.started') {
          g.startedEventId = event.id; delete g.stoppedEventId;
          if (g.phase === 'awaiting_start') {
            g.phase = 'granted'; g.grantedAt = now(); g.expiresAt = g.grantedAt + LEASE_MS; g.nextCheckAt = g.expiresAt;
          }
        }
        if (event.action === 'profiles.force_stopped') {
          g.forceStopped = true;
          g.error = 'force_stop_observed';
          if (g.phase === 'awaiting_close' || g.phase === 'awaiting_start') g.phase = 'blocked';
        }
        if (event.action === 'profiles.stopped') { g.stoppedEventId = event.id; stopped.add(g); }
        await save();
      }
      for (const g of stopped) await reconcile(g, 'event');
      if (!state.cursor || page.watermark.time >= state.cursor.time) state.cursor = { ...page.watermark };
      await save();
    })
  };
}
