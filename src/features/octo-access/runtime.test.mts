import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOctoRuntime } from './runtime.mts';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from './testing.mts';
import type { ManagedProfile, NewProfile } from './contracts.mts';
import type { ActionLogOptions } from '../octo-access-test/action-log.mts';

async function settled(predicate: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Runtime work did not settle within the bounded microtask queue');
}
function draft(clientId: number, password: string): NewProfile {
  return { clientId, password, locale: 'ru', operationId: `fixture-${clientId}`, createdAt: 1_000_000,
    phase: 'queued', ownProxy: false,
    original: { title: `Client ${clientId}`, description: `unicorn-octo:fixture-${clientId}`, tags: [], start_pages: [] } };
}
async function fixture() {
  let time = 1_000_000;
  const now = () => time, store = createMemoryStore(), cloud = createMockCloud(store,now);
  const initial = (await store.reserve([draft(901,'12345')]))[0];
  const uuid = await cloud.api.createProfile({ ...initial.original, folder: testConfig.homeFolder, password: initial.password });
  const profile = await store.save({ ...initial, uuid, phase: 'ready', grant: {
    id: 'fixture-grant', phase: 'granted', alias: 'John Doe fixture', createdAt: now(), grantedAt: now(),
    expiresAt: now()+testConfig.leaseMs, eventsAfter: 0, original: structuredClone(initial.original)
  } });
  await cloud.api.updateProfile(uuid, { title: profile.grant!.alias, description: 'unicorn-access:fixture-grant',
    tags: [], start_pages: [], folder: testConfig.guestFolder });
  cloud.calls.length = 0;
  const writes: ManagedProfile[] = [], saved = store.save.bind(store);
  store.save = async value => { const result = await saved(value); writes.push(structuredClone(result)); return result; };
  let listeners = 0, connected = true;
  const listen = (_options: ActionLogOptions) => ({
    start() { listeners++; }, async stop() {}, status() { return { connected,reconnects:0,lastSafeError:undefined,checkpoint:connected?0:undefined }; }
  });
  const reports: Array<{ code: string; profileId?: number }> = [];
  const runtime = () => createOctoRuntime({ store, api: cloud.api, config: testConfig, token: 'mock-token', now, listen,
    getClient: async id => mockClient(id), report: event => reports.push(event) });
  return { store, cloud, profile, writes, reports, runtime, now,
    advance(ms: number) { time += ms; }, disconnect() { connected = false; }, reconnect() { connected = true; }, listenerCount: () => listeners };
}

test('in-process scheduler restart preserves the persisted grant deadline and cleans up at that deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(), runtime = f.runtime(), expiresAt = f.profile.grant!.expiresAt!;
  try {
    await runtime.start(); await settled(() => f.writes.length===0);
    f.advance(20_000); t.mock.timers.tick(20_000); await runtime.stop();
    assert.equal((await f.store.get(f.profile.id))?.grant?.expiresAt,expiresAt);
    await runtime.start();
    assert.equal(runtime.status().leader,true); assert.equal(f.listenerCount(),2);
    f.advance(24_000); t.mock.timers.tick(24_000);
    await settled(async () => (await runtime.service.grant(901,'fixture-grant')).phase==='granted');
    const before = await runtime.service.grant(901,'fixture-grant');
    assert.equal(before.expiresAt,expiresAt); assert.equal(before.password,'12345');
    assert.equal(f.cloud.profiles.get(f.profile.uuid!)?.folder,testConfig.guestFolder);
    assert.deepEqual(f.cloud.calls,[]);
    f.advance(1_000); t.mock.timers.tick(1_000);
    await settled(async () => (await f.store.get(f.profile.id))?.grant?.phase==='complete');
    const after = await runtime.service.grant(901,'fixture-grant');
    assert.equal(after.expiresAt,expiresAt); assert.equal(after.password,undefined);
    assert.equal(f.cloud.profiles.get(f.profile.uuid!)?.folder,testConfig.homeFolder);
    assert.deepEqual(f.cloud.calls,[`update:${f.profile.uuid}`,`clear:${f.profile.uuid}`]);
    assert.deepEqual(f.reports,[]);
  } finally { await runtime.stop(); }
});

test('two schedulers sharing a store have one leader and perform each expiry write only once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(), first = f.runtime(), second = f.runtime();
  try {
    await first.start(); await second.start();
    assert.equal(first.status().leader,true); assert.equal(second.status().leader,false);
    assert.equal(await first.grantReady(f.profile.uuid!), true);
    assert.equal(await second.grantReady(f.profile.uuid!), false);
    assert.equal(await first.grantReady('foreign-uuid'), false);
    assert.equal(second.status().connected,false); assert.equal(f.listenerCount(),1);
    f.advance(testConfig.leaseMs); t.mock.timers.tick(testConfig.leaseMs);
    await settled(async () => (await f.store.get(f.profile.id))?.grant?.phase==='complete');
    // More scheduler ticks must neither repeat the cloud writes nor mutate the completed grant.
    const revision = (await f.store.get(f.profile.id))!.revision;
    f.advance(60_000); t.mock.timers.tick(60_000); await Promise.resolve();
    assert.equal((await f.store.get(f.profile.id))!.revision,revision);
    assert.deepEqual(f.cloud.calls,[`update:${f.profile.uuid}`,`clear:${f.profile.uuid}`]);
    assert.equal(f.writes.filter(p => p.id===f.profile.id).length,4);
    assert.equal(f.listenerCount(),1); assert.deepEqual(f.reports,[]);
  } finally { await first.stop(); await second.stop(); }
});

test('control readiness requires a running leader and a usable history checkpoint', async () => {
  const f = await fixture(), runtime = f.runtime();
  try {
    assert.equal(await runtime.grantReady(f.profile.uuid!), false);
    await runtime.start(); assert.equal(await runtime.grantReady(f.profile.uuid!), true);
    f.disconnect(); assert.equal(await runtime.grantReady(f.profile.uuid!), false);
    f.reconnect(); assert.equal(await runtime.grantReady(f.profile.uuid!), true);
    await runtime.stop(); assert.equal(await runtime.grantReady(f.profile.uuid!), false);
  } finally { await runtime.stop(); }
});

test('slow provisioning does not block expiry of an existing grant even while the action stream is disconnected', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(), queued = (await f.store.reserve([draft(902,'67890')]))[0];
  let release!: () => void, entered = false, finished = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const create = f.cloud.api.createProfile.bind(f.cloud.api);
  f.cloud.api.createProfile = async input => { entered = true; await gate; const uuid = await create(input); finished = true; return uuid; };
  const runtime = f.runtime();
  try {
    await runtime.start(); await settled(() => entered);
    assert.equal(finished,false); assert.equal((await f.store.get(queued.id))?.pending,'create');
    f.disconnect(); f.advance(testConfig.leaseMs); t.mock.timers.tick(testConfig.leaseMs);
    await settled(async () => (await f.store.get(f.profile.id))?.grant?.phase==='awaiting_close');
    assert.equal(finished,false,'Unrelated provisioning must still be waiting when expiry hides the grant');
    assert.equal(runtime.status().connected,false);
    assert.equal(f.cloud.profiles.get(f.profile.uuid!)?.folder,testConfig.homeFolder);
    assert.equal(f.cloud.profiles.get(f.profile.uuid!)?.has_user_password,true);
    assert.deepEqual(f.cloud.calls,[`update:${f.profile.uuid}`]);
    f.advance(5_000); t.mock.timers.tick(5_000); await Promise.resolve();
    assert.equal(finished,false); assert.equal(f.writes.filter(p => p.id===f.profile.id).length,2);
    release(); await settled(async () => (await f.store.get(queued.id))?.phase==='ready');
    f.reconnect(); f.advance(30_000); t.mock.timers.tick(30_000);
    await settled(async () => (await f.store.get(f.profile.id))?.grant?.phase==='complete');
    assert.equal(f.cloud.profiles.get(f.profile.uuid!)?.has_user_password,false);
    assert.equal(f.writes.filter(p => p.id===f.profile.id).length,4);
    assert.deepEqual(f.reports,[]);
  } finally { release(); await runtime.stop(); }
});
