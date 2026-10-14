import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow } from './workflow.mts';
import { createTestServer } from './http.mts';
import { FOLDER_NAMES, GUARANTEE_MS, PASSWORDS, TestError, wiki } from './contract.mts';
import type { Folder, Octo, Profile, State, Store } from './contract.mts';

function fixture() {
  let time = 1_000_000;
  let saved: State | null = null;
  let serial = 0;
  const calls: string[] = [];
  const folders: Folder[] = [];
  const profiles = new Map<string, Profile>();
  const passwords = new Map<string, string>();
  const running = new Set<string>();
  let beforeWrite: (action: string) => Promise<void> = async () => {};
  const write = async (action: string) => { calls.push(action); await beforeWrite(action); };
  const store: Store = { load: async () => structuredClone(saved), save: async s => { saved = structuredClone(s); } };
  const api: Octo = {
    listFolders: async () => structuredClone(folders),
    async createFolder(name) { await write(`folder:${name}`); const folder = { uuid: `f${++serial}`, name }; folders.push(folder); return folder; },
    async createProfile(input) {
      await write(`create:${input.title}`);
      const uuid = `p${++serial}`;
      profiles.set(uuid, { ...input, proxy: input.proxy ? { uuid: input.proxy } : null, uuid, has_user_password: false, version: '1', status: 0 });
      return uuid;
    },
    async getProfile(uuid) { const p = profiles.get(uuid); assert.ok(p); return structuredClone(p); },
    async updateProfile(uuid, input) { await write(`update:${uuid}`); Object.assign(profiles.get(uuid)!, input); },
    async setPassword(uuid, password) { await write(`set:${uuid}`); passwords.set(uuid, password); profiles.get(uuid)!.has_user_password = true; },
    async clearPassword(uuid, password) {
      await write(`clear:${uuid}`); assert.equal(passwords.get(uuid), password);
      passwords.delete(uuid); profiles.get(uuid)!.has_user_password = false;
    },
    activeProfiles: async () => [...running],
    async startProfile(uuid, password) {
      calls.push(`start:${uuid}`);
      if (passwords.get(uuid) !== password) throw new Error('wrong password');
      running.add(uuid); return { uuid, state: 'STARTED' };
    }
  };
  return {
    api, store, calls, folders, profiles, passwords, running,
    clock: () => time, advance: (ms: number) => { time += ms; },
    beforeWrite: (fn: typeof beforeWrite) => { beforeWrite = fn; },
    workflow: () => createWorkflow({ api, store, now: () => time, runId: () => 'test-run' })
  };
}

test('setup creates exactly two unprotected test profiles; repeats and restarts create no duplicates', async () => {
  const f = fixture(), w = await f.workflow();
  const state = await w.setup();
  assert.equal(f.profiles.size, 2);
  for (const name of ['Alex', 'Bob'] as const) {
    const p = f.profiles.get(state.profiles[name]!)!;
    assert.equal(p.title, name);
    assert.equal(p.has_user_password, false);
    assert.deepEqual(p.start_pages, [wiki(name)]);
    assert.equal(p.folder, state.folders.home!.uuid);
  }
  const writes = f.calls.length;
  await w.setup(); await (await f.workflow()).setup();
  assert.equal(f.calls.length, writes);
});

test('minimum guarantee persists through restart, and idle time never changes the active grant', async () => {
  const f = fixture(), w = await f.workflow();
  await w.setup();
  const alex = await w.grant('Alex');
  assert.equal(alex.password, 'Alex');
  f.advance(GUARANTEE_MS - 1);
  const writes = f.calls.length;
  const resumed = await f.workflow();
  await assert.rejects(resumed.grant('Bob'), { code: 'minimum_guarantee_active' });
  assert.equal(f.calls.length, writes);
  f.advance(1234 * 60 * 60 * 1000);
  assert.equal(resumed.status().active, 'Alex');
  assert.equal(f.calls.length, writes);
  assert.equal((await resumed.grant('Alex')).grantedAt, alex.grantedAt);
});

test('handoff restores Alex and protects Bob before publishing; running Alex is never stopped', async () => {
  const f = fixture(), w = await f.workflow();
  await w.setup(); await w.grant('Alex');
  const a = w.status().profiles.Alex!, b = w.status().profiles.Bob!;
  await w.start('Alex', 'Alex');
  f.advance(GUARANTEE_MS);
  f.calls.length = 0;
  const state = await w.grant('Bob');
  assert.equal(state.password, PASSWORDS.Bob);
  assert.equal(state.active, 'Bob');
  assert.equal(f.profiles.get(a)!.title, 'Alex');
  assert.equal(f.profiles.get(a)!.folder, state.folders.home!.uuid);
  assert.equal(f.profiles.get(a)!.has_user_password, false);
  assert.equal(f.profiles.get(b)!.title, 'John Doe');
  assert.equal(f.profiles.get(b)!.folder, state.folders.guest!.uuid);
  assert.equal(f.passwords.get(b), 'Bob1');
  assert.deepEqual([...f.running], [a]);
  assert.ok(f.calls.indexOf(`update:${a}`) < f.calls.indexOf(`clear:${a}`));
  assert.ok(f.calls.indexOf(`set:${b}`) < f.calls.indexOf(`update:${b}`));
  f.advance(GUARANTEE_MS);
  await assert.rejects(w.grant('Alex'), { code: 'target_profile_is_running' });
});

test('uncertain creation blocks retry across restart rather than creating duplicates', async () => {
  const f = fixture(), w = await f.workflow();
  f.beforeWrite(async action => { if (action === 'create:Bob') throw new Error('connection reset after external write'); });
  await assert.rejects(w.setup(), { code: 'operation_incomplete' });
  assert.equal(w.status().phase, 'blocked');
  assert.ok(w.status().profiles.Alex);
  const calls = f.calls.length;
  await assert.rejects((await f.workflow()).setup(), { code: 'manual_reconciliation_required' });
  assert.equal(f.calls.length, calls);
});

test('password removal failure records the exact step and never publishes Bob or claims success', async () => {
  const f = fixture(), w = await f.workflow();
  await w.setup(); await w.grant('Alex'); f.advance(GUARANTEE_MS);
  const a = w.status().profiles.Alex!, b = w.status().profiles.Bob!;
  f.beforeWrite(async action => { if (action === `clear:${a}`) throw new TestError('octo_request_failed', 502, { httpStatus: 400, upstreamCode: 'profiles.password_error' }); });
  await assert.rejects(w.grant('Bob'), { code: 'operation_incomplete' });
  assert.equal(w.status().step, 'clear_password:Alex');
  assert.equal(w.status().phase, 'blocked');
  assert.deepEqual(w.status().errorDetails, { httpStatus: 400, upstreamCode: 'profiles.password_error' });
  assert.equal(f.profiles.get(b)!.folder, w.status().folders.home!.uuid);
  await assert.rejects(w.grant('Bob'), { code: 'manual_reconciliation_required' });
});

test('concurrent mutations are rejected and the guarantee starts only after verification completes', async () => {
  const f = fixture(), w = await f.workflow(); await w.setup();
  let release!: () => void, entered!: () => void;
  const entry = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.beforeWrite(async action => { if (action.startsWith('set:')) { entered(); await gate; f.advance(5000); } });
  const grant = w.grant('Alex'); await entry;
  await assert.rejects(w.grant('Bob'), { code: 'operation_busy' });
  release();
  assert.equal((await grant).grantedAt, f.clock());
});

test('existing folders and altered profile ownership cannot be adopted or modified', async () => {
  const f = fixture(); f.folders.push({ uuid: 'unrelated', name: FOLDER_NAMES.guest });
  const w = await f.workflow();
  await assert.rejects(w.setup(), { code: 'test_folder_already_exists' });
  assert.equal(f.calls.length, 0);
  f.folders.length = 0; await w.setup();
  f.profiles.get(w.status().profiles.Alex!)!.description = 'unrelated';
  const writes = f.calls.length;
  await assert.rejects(w.grant('Alex'), { code: 'profile_ownership_mismatch' });
  assert.equal(f.calls.length, writes);
});

test('start uses the supplied password, never silently substitutes one, and rejects already-open profiles', async () => {
  const f = fixture(), w = await f.workflow(); await w.setup(); await w.grant('Alex');
  await assert.rejects(w.start('Alex', 'wrong'));
  assert.equal(f.running.size, 0);
  assert.equal(w.status().phase, 'ready');
  await w.start('Alex', 'Alex');
  await assert.rejects(w.start('Alex', 'wrong'), { code: 'profile_already_running' });
});

test('terminal HTTP API wires setup/grant/inspect and rejects browser requests and unknown profile names', async () => {
  const f = fixture(), w = await f.workflow(), server = createTestServer(w);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, value: unknown, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value)
  });
  try {
    assert.equal((await (await fetch(base + '/status')).json()).phase, 'new');
    assert.equal((await post('/setup', {}, { Origin: 'https://unrelated.example' })).status, 403);
    assert.equal(f.calls.length, 0);
    assert.equal((await post('/setup', {})).status, 200);
    const calls = f.calls.length;
    assert.equal((await post('/grant', { profile: 'existing-account-profile' })).status, 400);
    assert.equal(f.calls.length, calls);
    const alex = await post('/grant', { profile: 'Alex' });
    assert.equal(alex.status, 200);
    assert.equal((await alex.json()).password, 'Alex');
    assert.equal((await post('/grant', { profile: 'Bob' })).status, 409);
    f.advance(GUARANTEE_MS);
    assert.equal((await post('/grant', { profile: 'Bob' })).status, 200);
    const inspected = await (await fetch(base + '/inspect')).json();
    assert.equal(inspected.observedProfiles.Alex.has_user_password, false);
    assert.equal(inspected.observedProfiles.Bob.title, 'John Doe');
    assert.equal((await fetch(base + '/grant', { method: 'POST', body: '{"profile":"Alex"}' })).status, 415);
    assert.equal((await post('/start', { profile: 'Bob', password: 123 })).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('an interrupted operation journal survives process restart and prevents replay', async () => {
  const f = fixture();
  await f.store.save({ schema: 1, runId: 'crashed', phase: 'working', folders: {}, profiles: {}, active: null, grantedAt: null, step: 'create_folder:home' });
  const w = await f.workflow();
  await assert.rejects(w.setup(), { code: 'manual_reconciliation_required' });
  assert.equal(w.status().step, 'create_folder:home');
  assert.equal(f.calls.length, 0);
});
