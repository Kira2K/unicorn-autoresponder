import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marker, TestError } from './contract.mts';
import type { Octo, Profile } from './contract.mts';
import { createTimedWorkflow } from './timed-workflow.mts';
import { LEASE_MS, RECHECK_MS } from './timed-contract.mts';
import type { TimedState } from './timed-contract.mts';

async function fixture(cloudOnly = false, waitForManualStart = false) {
  let time = 1_800_000_000_000;
  let saved: TimedState | null = null;
  let failClear: Error | undefined;
  let saveFailure = false;
  const active = new Set<string>(), writes: string[] = [];
  const profiles = Object.fromEntries(['Alex', 'Bob'].map(name => [name, {
    uuid: name, title: name, description: marker('fixture', name as 'Alex' | 'Bob'),
    folder: 'home', tags: [], start_pages: [`https://example.com/${name}`], status: 0, has_user_password: false
  }])) as Record<string, Profile>;
  const api: Octo = {
    async listFolders() { return [{ uuid: 'home', name: 'home' }, { uuid: 'guest', name: 'guest' }]; },
    async createFolder() { throw Error('must not create'); }, async createProfile() { throw Error('must not create'); },
    async getProfile(id) { return structuredClone(profiles[id]); },
    async updateProfile(id, data) { writes.push(`patch:${id}:${data.folder}`); Object.assign(profiles[id], data); },
    async setPassword(id) { writes.push(`protect:${id}`); profiles[id].has_user_password = true; },
    async clearPassword(id) { writes.push(`clear:${id}`); if (failClear) throw failClear; profiles[id].has_user_password = false; },
    async activeProfiles() { return [...active]; },
    async startProfile(id) { active.add(id); profiles[id].status = 1; return { uuid: id, state: 'STARTED' }; }
  };
  const store = { async load() { return structuredClone(saved); }, async save(s: TimedState) { if (saveFailure) throw Error('disk unavailable'); saved = structuredClone(s); } };
  const options = { api, store, cloudOnly, waitForManualStart, fixtures: { runId: 'fixture', folders: { home: { uuid: 'home', name: 'home' }, guest: { uuid: 'guest', name: 'guest' } }, profiles: { Alex: 'Alex', Bob: 'Bob' } }, now: () => time };
  let workflow = await createTimedWorkflow(options);
  return {
    get w() { return workflow; }, api, profiles, active, writes,
    now: () => time, advance(ms: number) { time += ms; }, saved: () => saved!,
    failClear(error?: Error) { failClear = error; },
    failSave() { saveFailure = true; },
    async restart() { workflow = await createTimedWorkflow(options); },
    stop(id: string) { active.delete(id); profiles[id].status = 0; },
    async event(id: string, action = 'profiles.stopped', eventId: string = crypto.randomUUID(), eventTime = Math.floor(time / 1000)) {
      await workflow.onPage({ events: [{ id: eventId, profileId: id, action, time: eventTime }], watermark: { uuid: eventId, time: eventTime } });
    }
  };
}

test('two grants expire independently; running browsers keep their passwords until ordinary stop events', async () => {
  const f = await fixture();
  const a = await f.w.grant('Alex'); await f.w.start('Alex', 'Alex');
  f.advance(10_000); const b = await f.w.grant('Bob'); await f.w.start('Bob', 'Bob1');
  assert.notEqual(a.alias, b.alias);
  f.advance(LEASE_MS - 10_000); await f.w.tick();
  assert.equal(f.profiles.Alex.folder, 'home'); assert.equal(f.profiles.Alex.title, 'Alex');
  assert.equal(f.profiles.Bob.folder, 'guest'); assert.equal(f.profiles.Alex.has_user_password, true);
  assert.equal(f.active.size, 2); assert.equal(f.saved().grants.Alex!.phase, 'awaiting_close');
  f.advance(10_000); await f.w.tick(); assert.equal(f.profiles.Bob.folder, 'home');
  f.stop('Alex'); await f.event('Alex');
  assert.equal(f.profiles.Alex.has_user_password, false); assert.equal(f.profiles.Bob.has_user_password, true);
  assert.equal(f.saved().grants.Alex!.lastTrigger, 'event');
  f.stop('Bob'); await f.event('Bob'); assert.equal(f.saved().grants.Bob!.phase, 'complete');
  assert.deepEqual(f.writes.filter(w => w.startsWith('clear:')), ['clear:Alex', 'clear:Bob']);
});

test('duplicate grants and restarts preserve the deadline; a closed profile waits until expiry', async () => {
  const f = await fixture(); const grant = await f.w.grant('Alex');
  f.advance(20_000); assert.equal((await f.w.grant('Alex')).expiresAt, grant.expiresAt);
  await f.event('Alex'); assert.equal(f.profiles.Alex.has_user_password, true);
  await f.restart(); f.advance(25_000); await f.w.tick();
  assert.equal(f.saved().grants.Alex!.phase, 'complete');
  assert.equal(f.saved().grants.Alex!.expiresAt, grant.expiresAt);
});

test('polling recovers a missed close event; blocked clear retries only a definite busy rejection', async () => {
  const f = await fixture(); await f.w.grant('Alex'); await f.w.start('Alex');
  f.advance(LEASE_MS); await f.w.tick(); f.stop('Alex');
  f.failClear(new TestError('octo_request_failed', 502, { upstreamCode: 'profiles.password_error' }));
  await f.event('Alex'); assert.equal(f.saved().grants.Alex!.phase, 'awaiting_close');
  f.failClear(); f.advance(RECHECK_MS); await f.w.tick();
  assert.equal(f.saved().grants.Alex!.phase, 'complete'); assert.equal(f.saved().grants.Alex!.lastTrigger, 'poll');
});

test('old/duplicate events never clear a current running grant; force stop blocks cleanup', async () => {
  const f = await fixture(); await f.w.grant('Alex'); await f.w.start('Alex');
  await f.event('Alex', 'profiles.force_stopped', 'old', Math.floor(f.now() / 1000) - 10);
  f.advance(LEASE_MS); await f.w.tick();
  await f.event('Alex', 'profiles.stopped', 'duplicate'); await f.event('Alex', 'profiles.stopped', 'duplicate');
  assert.equal(f.writes.some(w => w.startsWith('clear:')), false);
  await f.event('Alex', 'profiles.force_stopped'); f.stop('Alex'); f.advance(RECHECK_MS); await f.w.tick();
  assert.equal(f.saved().grants.Alex!.phase, 'blocked'); assert.equal(f.profiles.Alex.has_user_password, true);
});

test('unknown clear outcome is not resent; restart reconciles an already completed clear', async () => {
  const f = await fixture(); await f.w.grant('Alex');
  const clear = f.api.clearPassword;
  f.api.clearPassword = async (id, password) => { await clear(id, password); throw new TestError('octo_request_outcome_unknown', 502); };
  f.advance(LEASE_MS); await f.w.tick(); assert.equal(f.saved().grants.Alex!.phase, 'blocked');
  await f.restart(); await f.w.tick();
  assert.equal(f.saved().grants.Alex!.phase, 'complete');
  assert.equal(f.writes.filter(w => w === 'clear:Alex').length, 1);
});

test('foreign metadata blocks only that profile; no writes outside the allowlist', async () => {
  const f = await fixture(); f.profiles.Alex.description = 'other user data';
  await assert.rejects(f.w.grant('Alex'), /fixture_changed/);
  assert.equal(f.writes.length, 0); await f.w.grant('Bob');
  assert.ok(f.writes.every(w => w.includes(':Bob')));
});

test('start after expiry is rejected and cannot extend access', async () => {
  const f = await fixture(); await f.w.grant('Alex'); f.advance(LEASE_MS);
  await assert.rejects(f.w.start('Alex'), /grant_expired/); assert.equal(f.active.size, 0);
});

test('failed journal persistence prevents mutation, including later requests', async () => {
  const f = await fixture(); f.failSave();
  await assert.rejects(f.w.grant('Alex'), /timed_storage_failed/);
  await assert.rejects(f.w.grant('Bob'), /timed_storage_failed/);
  assert.equal(f.writes.length, 0);
});

test('uncertain folder move is confirmed on restart without resending it', async () => {
  const f = await fixture(); await f.w.grant('Alex'); await f.w.start('Alex');
  const patch = f.api.updateProfile;
  f.api.updateProfile = async (id, data) => { await patch(id, data); throw new TestError('octo_request_outcome_unknown', 502); };
  f.advance(LEASE_MS); await f.w.tick(); assert.equal(f.saved().grants.Alex!.phase, 'blocked');
  const before = f.writes.length; await f.restart(); await f.w.tick();
  assert.equal(f.saved().grants.Alex!.phase, 'awaiting_close'); assert.equal(f.writes.length, before);
  f.stop('Alex'); await f.event('Alex'); assert.equal(f.saved().grants.Alex!.phase, 'complete');
});

test('a force-stop before expiry still revokes folder access, but never clears protection', async () => {
  const f = await fixture(); await f.w.grant('Alex'); await f.event('Alex', 'profiles.force_stopped');
  await f.restart(); f.advance(LEASE_MS); await f.w.tick();
  assert.equal(f.profiles.Alex.folder, 'home'); assert.equal(f.profiles.Alex.has_user_password, true);
  assert.equal(f.saved().grants.Alex!.phase, 'blocked');
});

test('duplicate concurrent grants perform one protection and share the original deadline', async () => {
  const f = await fixture(); const grants = await Promise.all([f.w.grant('Alex'), f.w.grant('Alex')]);
  assert.equal(grants[0].id, grants[1].id); assert.equal(grants[0].expiresAt, grants[1].expiresAt);
  assert.equal(f.writes.filter(w => w === 'protect:Alex').length, 1);
});

test('cloud-only grant, expiry, restart and stop-event cleanup never call the desktop API', async () => {
  const f = await fixture(true);
  f.api.activeProfiles = async () => { throw Error('localhost forbidden'); };
  f.api.startProfile = async () => { throw Error('localhost forbidden'); };
  await f.w.grant('Alex');
  await assert.rejects(f.w.start('Alex'), /manual_start_required/);
  f.profiles.Alex.status = 1; await f.event('Alex', 'profiles.started');
  f.advance(LEASE_MS); await f.w.tick();
  assert.equal(f.profiles.Alex.folder, 'home'); assert.equal(f.profiles.Alex.has_user_password, true);
  assert.equal(f.saved().grants.Alex!.phase, 'awaiting_close');
  assert.deepEqual((await f.w.inspect()).active, ['Alex']);
  await f.restart(); f.stop('Alex'); await f.event('Alex');
  assert.equal(f.saved().grants.Alex!.phase, 'complete'); assert.equal(f.saved().grants.Alex!.lastTrigger, 'event');
});

test('cloud status zero alone cannot clear a password without the current start/normal-stop events', async () => {
  const f = await fixture(true); await f.w.grant('Alex');
  f.advance(LEASE_MS); await f.w.tick();
  assert.equal(f.saved().grants.Alex!.phase, 'awaiting_close'); assert.equal(f.profiles.Alex.has_user_password, true);
  await f.event('Alex'); assert.equal(f.profiles.Alex.has_user_password, true);
  await f.event('Alex', 'profiles.started');
  f.advance(RECHECK_MS); await f.w.tick(); assert.equal(f.profiles.Alex.has_user_password, true);
  await f.event('Alex'); assert.equal(f.saved().grants.Alex!.phase, 'complete');
});

test('a later force-stop in the same replayed cloud page prevents clearing on its earlier stop event', async () => {
  const f = await fixture(true); await f.w.grant('Alex'); await f.event('Alex', 'profiles.started');
  f.advance(LEASE_MS); await f.w.tick();
  await f.w.onPage({ events: [
    { id: 'stop', profileId: 'Alex', action: 'profiles.stopped', time: Math.floor(f.now() / 1000) },
    { id: 'force', profileId: 'Alex', action: 'profiles.force_stopped', time: Math.floor(f.now() / 1000) }
  ], watermark: { uuid: 'force', time: Math.floor(f.now() / 1000) } });
  assert.equal(f.saved().grants.Alex!.phase, 'blocked'); assert.equal(f.profiles.Alex.has_user_password, true);
});

test('manual experiment waits for launch across restart, then starts one non-extendable 45-second deadline', async () => {
  const f = await fixture(true, true); await f.w.grant('Alex');
  f.advance(120000); await f.w.tick(); await f.restart(); await f.w.tick();
  assert.equal(f.saved().grants.Alex!.phase, 'awaiting_start'); assert.equal(f.profiles.Alex.folder, 'guest');
  assert.equal(f.saved().grants.Alex!.expiresAt, undefined);
  f.profiles.Alex.status = 1; await f.event('Alex', 'profiles.started');
  const deadline = f.saved().grants.Alex!.expiresAt; assert.equal(deadline, f.now() + LEASE_MS);
  f.advance(10000); await f.event('Alex', 'profiles.started');
  assert.equal(f.saved().grants.Alex!.expiresAt, deadline);
  f.advance(35000); await f.w.tick();
  assert.equal(f.saved().grants.Alex!.phase, 'awaiting_close'); assert.equal(f.profiles.Alex.has_user_password, true);
  f.stop('Alex'); await f.event('Alex'); assert.equal(f.saved().grants.Alex!.phase, 'complete');
});
