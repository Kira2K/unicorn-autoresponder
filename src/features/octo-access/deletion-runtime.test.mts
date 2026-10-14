import test from 'node:test';
import assert from 'node:assert/strict';
import { createOctoRuntime } from './runtime.mts';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from './testing.mts';
import { OctoError } from './contracts.mts';
import type { ActionLogOptions } from '../octo-access-test/action-log.mts';

async function settled(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 1000; i++) { if (await predicate()) return; await Promise.resolve(); }
  assert.fail('Runtime did not settle');
}
async function fixture() {
  let time = 100_000, options!: ActionLogOptions;
  const store = createMemoryStore(), cloud = createMockCloud(store), calls: string[] = [];
  const initial = (await store.reserve([{ clientId: 901, locale: 'ru', password: '01234', phase: 'ready', ownProxy: true,
    createdAt: 1, operationId: 'fixture', original: { title: 'Alex', description: '', tags: [], start_pages: [] } }]))[0];
  const uuid = await cloud.api.createProfile({ ...initial.original, folder: 'home', password: initial.password });
  const p = await store.save({ ...initial, uuid });
  cloud.api.profileExists = async id => { calls.push('exists'); return cloud.profiles.has(id); };
  const runtime = () => createOctoRuntime({ store, api: cloud.api, config: testConfig, token: 'mock', now: () => time,
    getClient: async id => mockClient(id), listen: value => {
      options = value;
      return { start() {}, async stop() {}, status: () => ({ connected: true, reconnects: 0, checkpoint: 1, lastSafeError: undefined }) };
    } });
  return { store, cloud, p, runtime, calls, elapse(ms: number) { time += ms; },
    async deleted() {
      assert.equal(options.includeDeletions, true); cloud.profiles.delete(uuid);
      await options.onPage({ events: [{ id: 'deleted', profileId: uuid, action: 'profiles.trashed', time: 100 }], watermark: { uuid: 'page', time: 100 } });
    } };
}

test('no presence polling on startup or idle ticks; deletion is driven by the listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(), runtime = f.runtime();
  try {
    await runtime.start(); f.elapse(600_000); t.mock.timers.tick(600_000);
    await settled(async () => !!(await f.store.get(f.p.id))); assert.deepEqual(f.calls, []);
    await f.deleted(); f.elapse(1000); t.mock.timers.tick(1000);
    await settled(async () => !(await f.store.get(f.p.id))); assert.deepEqual(f.calls, ['exists']);
  } finally { await runtime.stop(); }
});

test('restart preserves the delayed retry and never starts a third presence request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(), first = f.runtime();
  f.cloud.api.profileExists = async () => { f.calls.push('exists'); throw new OctoError('octo_request_outcome_unknown'); };
  await first.start(); await f.deleted(); f.elapse(1000); t.mock.timers.tick(1000);
  await settled(async () => !!(await f.store.get(f.p.id))?.deletion?.error); await first.stop();
  const second = f.runtime();
  try {
    await second.start(); assert.equal(f.calls.length, 1);
    f.elapse(30_000); t.mock.timers.tick(30_000);
    await settled(async () => (await f.store.get(f.p.id))?.deletion?.phase === 'blocked');
    f.elapse(600_000); t.mock.timers.tick(600_000); await second.stop();
    assert.equal(f.calls.length, 2);
  } finally { await second.stop(); }
});

test('deletion waits for in-flight proxy creation and cleans its exact result without attaching it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(), runtime = f.runtime();
  let release!: () => void, creating = false, created = false, removed = false, attachments = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const proxy = { uuid: 'created-proxy', title: `${f.p.original.title} | ${f.p.uuid}`, type: 'socks5' as const,
    host: 'proxy.example', port: 1080, login: 'user', password: 'secret', profiles_count: 0, externalId: 'unicorn-octo-proxy:pending-op' };
  f.cloud.api.proxyConnections = async marker => { assert.equal(marker, proxy.externalId); return created && !removed ? [proxy] : []; };
  f.cloud.api.createProxy = async () => { creating = true; await gate; created = true; return proxy; };
  f.cloud.api.listProxies = async () => created && !removed ? [proxy] : [];
  f.cloud.api.deleteProxy = async uuid => { assert.equal(uuid, proxy.uuid); removed = true; };
  f.cloud.api.attachProxy = async () => { attachments++; };
  await runtime.service.queueProxy(901, f.p.id, proxy, 'pending-op');
  try {
    await runtime.start(); await settled(() => creating); await f.deleted();
    f.elapse(1000); t.mock.timers.tick(1000); assert.deepEqual(f.calls, []);
    release(); await settled(() => created);
    // Drain the failed stale save before the next scheduler cycle.
    for (let i = 0; i < 100; i++) await Promise.resolve();
    f.elapse(1000); t.mock.timers.tick(1000);
    await settled(async () => !(await f.store.get(f.p.id)));
    assert.equal(removed, true); assert.equal(attachments, 0); assert.deepEqual(f.calls, ['exists']);
  } finally { release(); await runtime.stop(); }
});
