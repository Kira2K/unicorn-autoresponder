import { randomUUID } from 'node:crypto';
import { FOLDER_NAMES, GUARANTEE_MS, NAMES, PASSWORDS, TestError, marker, wiki } from './contract.mts';
import type { Folder, Octo, Profile, ProfileName, State, Store } from './contract.mts';

export async function createWorkflow(deps: { api: Octo; store: Store; now?: () => number; runId?: () => string }) {
  const { api, store } = deps, now = deps.now ?? Date.now;
  const state: State = await store.load() ?? {
    schema: 1, runId: (deps.runId ?? randomUUID)(), phase: 'new', folders: {}, profiles: {}, active: null, grantedAt: null
  };
  let busy = false;
  const status = () => ({
    ...structuredClone(state),
    password: state.phase === 'ready' && state.active ? PASSWORDS[state.active] : null,
    switchAllowedAt: state.grantedAt === null ? null : state.grantedAt + GUARANTEE_MS,
    remainingSeconds: state.grantedAt === null ? 0 : Math.max(0, Math.ceil((state.grantedAt + GUARANTEE_MS - now()) / 1000))
  });
  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (busy) throw new TestError('operation_busy');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  function unblocked() {
    if (state.phase === 'blocked' || state.phase === 'working') throw new TestError('manual_reconciliation_required', 409, { step: state.step });
  }
  function ready() {
    unblocked();
    if (state.phase !== 'ready') throw new TestError('setup_required');
  }
  async function owned(name: ProfileName) {
    const uuid = state.profiles[name];
    if (!uuid) throw new TestError('setup_required');
    const profile = await api.getProfile(uuid);
    if (profile.uuid !== uuid || profile.description !== marker(state.runId, name)) throw new TestError('profile_ownership_mismatch');
    return profile;
  }
  function inFolder(profile: Profile, folder: Folder) {
    const actual = profile.folder;
    return typeof actual === 'string' ? [folder.uuid, folder.name].includes(actual)
      : actual !== null && (actual.uuid === folder.uuid || actual.name === folder.name);
  }
  async function verify(active: ProfileName | null) {
    for (const name of NAMES) {
      const profile = await owned(name), granted = name === active;
      if (profile.title !== (granted ? 'John Doe' : name) || profile.has_user_password !== granted
        || !inFolder(profile, state.folders[granted ? 'guest' : 'home']!)
        || !profile.start_pages.includes(wiki(name))) {
        throw new TestError('profile_state_mismatch', 409, { profile: name });
      }
    }
  }
  // Journal before each external operation. A crash/timeout must never authorize replay.
  async function step<T>(name: string, operation: () => Promise<T>, record?: (result: T) => void) {
    state.phase = 'working'; state.step = name;
    await store.save(state);
    const result = await operation();
    record?.(result);
    await store.save(state);
  }
  async function transaction(action: () => Promise<void>) {
    try {
      await action();
      state.phase = 'ready'; delete state.step; delete state.error; delete state.errorDetails;
      await store.save(state);
      return status();
    } catch (error) {
      state.phase = 'blocked';
      state.error = error instanceof TestError ? error.code : 'upstream_or_storage_failure';
      state.errorDetails = error instanceof TestError ? error.details : undefined;
      try { await store.save(state); } catch { /* The pre-operation journal remains the recovery boundary. */ }
      throw new TestError('operation_incomplete', 502, { step: state.step, reason: state.error, upstream: state.errorDetails });
    }
  }
  return {
    status,
    setup: () => exclusive(async () => {
      unblocked();
      if (state.phase === 'ready') return status();
      const folders = await api.listFolders();
      if (folders.some(f => Object.values(FOLDER_NAMES).some(name => name === f.name))) throw new TestError('test_folder_already_exists');
      return transaction(async () => {
        for (const key of ['home', 'guest'] as const) {
          await step(`create_folder:${key}`, () => api.createFolder(FOLDER_NAMES[key]), folder => { state.folders[key] = folder; });
        }
        for (const name of NAMES) {
          await step(`create_profile:${name}`, () => api.createProfile({
            title: name, description: marker(state.runId, name), folder: state.folders.home!.uuid, start_pages: [wiki(name)]
          }), uuid => { state.profiles[name] = uuid; });
        }
        await step('verify_setup', () => verify(null));
      });
    }),
    grant: (target: ProfileName) => exclusive(async () => {
      ready();
      if (state.active === target) return status();
      if (state.grantedAt !== null && now() < state.grantedAt + GUARANTEE_MS) {
        throw new TestError('minimum_guarantee_active', 409, { remainingSeconds: status().remainingSeconds, switchAllowedAt: status().switchAllowedAt });
      }
      await verify(state.active);
      if ((await api.activeProfiles()).includes(state.profiles[target]!)) throw new TestError('target_profile_is_running');
      return transaction(async () => {
        if (state.active) {
          const previous = state.active, uuid = state.profiles[previous]!;
          await step(`restore_profile:${previous}`, () => api.updateProfile(uuid, { title: previous, folder: state.folders.home!.uuid }));
          await step(`clear_password:${previous}`, () => api.clearPassword(uuid, PASSWORDS[previous]));
        }
        const uuid = state.profiles[target]!;
        await step(`set_password:${target}`, () => api.setPassword(uuid, PASSWORDS[target]));
        await step(`publish_profile:${target}`, () => api.updateProfile(uuid, { title: 'John Doe', folder: state.folders.guest!.uuid }));
        await step('verify_handoff', () => verify(target));
        state.active = target;
        state.grantedAt = now();
      });
    }),
    async inspect() {
      const profiles: Partial<Record<ProfileName, Profile>> = {};
      for (const name of NAMES) if (state.profiles[name]) profiles[name] = await owned(name);
      const active = await api.activeProfiles();
      return { ...status(), observedProfiles: profiles, runningTestProfiles: active.filter(id => Object.values(state.profiles).includes(id)) };
    },
    start: (name: ProfileName, password?: string) => exclusive(async () => {
      ready(); await owned(name);
      const uuid = state.profiles[name]!;
      if ((await api.activeProfiles()).includes(uuid)) throw new TestError('profile_already_running');
      return api.startProfile(uuid, password);
    })
  };
}
