import test from 'node:test';
import assert from 'node:assert/strict';
import { OctoError } from './contracts.mts';
import type { NewProfile } from './contracts.mts';
import type { ActionLogOptions } from '../octo-access-test/action-log.mts';
import type { OnboardingDependencies } from './onboarding-service.mts';
import type { ProxyResult } from './proxy-checker.mts';
import { createOctoRuntime } from './runtime.mts';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from './testing.mts';

async function settled(predicate: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Runtime work did not settle within the bounded microtask queue');
}

function pendingChecker() {
  const pending = new Map<number, { resolve(value: ProxyResult): void; reject(error: Error): void }>();
  const calls: string[] = [];
  let active = 0, peak = 0, cancellations = 0;
  const checker: OnboardingDependencies['checker'] = {
    async check(raw) {
      const id = calls.length; calls.push(raw); active++; peak = Math.max(peak, active);
      try {
        return await new Promise<ProxyResult>((resolve, reject) => { pending.set(id, { resolve, reject }); });
      } finally { pending.delete(id); active--; }
    },
    async best() { throw new Error('unexpected provider request'); },
    cancel() {
      cancellations++;
      for (const item of pending.values()) item.reject(new OctoError('octo_proxy_check_unknown', 502));
    }
  };
  return { checker, calls, active: () => active, peak: () => peak, cancellations: () => cancellations,
    complete(index: number, score = 69) {
      assert.ok(pending.has(index), 'The selected mock check must be in flight');
      pending.get(index)!.resolve({ index: 1, proxy: 'masked', ok: true, final_score: score,
        proxy_url: 'socks5h://user:secret@proxy.example:1080' });
    } };
}

async function fixture(clientIds: number[]) {
  let time = 1_000_000;
  const now = () => time, store = createMemoryStore(), cloud = createMockCloud(store, now), checker = pendingChecker();
  for (const clientId of clientIds) {
    const state = await store.claimClientPassword(clientId, String(clientId).padStart(5, '0'));
    state.setup = { id: `setup-${clientId}`, source: 'own', phase: 'queued', createdAt: now(), confirmDolphin: false,
      input: { type: 'socks5', host: 'proxy.example', port: 1080, login: `client-${clientId}`, password: 'mock-secret' } };
    await store.saveClientState(state);
  }
  const dependencies: OnboardingDependencies = { checker: checker.checker,
    catalogue: { async list() { throw new Error('unexpected catalogue request'); }, async validate() { throw new Error('unexpected catalogue validation'); } },
    dolphin: { async list() { return []; }, async proxy() { throw new Error('unexpected Dolphin import'); } } };
  const listen = (_options: ActionLogOptions) => ({ start() {}, async stop() {},
    status() { return { connected: true, reconnects: 0, lastSafeError: undefined, checkpoint: 0 }; } });
  const reports: Array<{ code: string; profileId?: number }> = [];
  const runtime = createOctoRuntime({ store, api: cloud.api, config: { ...testConfig, allowAll: true }, token: 'mock-token',
    onboarding: dependencies, getClient: async id => ({ ...mockClient(id), market: 'En' }), now, listen, report: event => reports.push(event) });
  return { store, cloud, checker, runtime, reports, now, advance(ms: number) { time += ms; } };
}

test('a pending proxy checker request cannot postpone an existing grant deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture([902]);
  const draft: NewProfile = { clientId: 901, password: '12345', locale: 'ru', operationId: 'existing-grant-profile',
    createdAt: f.now(), phase: 'queued', ownProxy: false,
    original: { title: 'Existing client', description: 'unicorn-octo:existing-grant-profile', tags: [], start_pages: [] } };
  const initial = (await f.store.reserve([draft]))[0];
  const uuid = await f.cloud.api.createProfile({ ...initial.original, folder: testConfig.homeFolder, password: initial.password });
  const expiresAt = f.now() + testConfig.leaseMs;
  const profile = await f.store.save({ ...initial, uuid, phase: 'ready', grant: { id: 'existing-grant', phase: 'granted', alias: 'John Doe',
    createdAt: f.now(), grantedAt: f.now(), expiresAt, eventsAfter: 0, original: structuredClone(initial.original) } });
  await f.cloud.api.updateProfile(uuid, { title: profile.grant!.alias, description: 'unicorn-access:existing-grant',
    tags: [], start_pages: [], folder: testConfig.guestFolder });
  f.cloud.calls.length = 0;
  try {
    await f.runtime.start(); await settled(() => f.checker.active() === 1);
    f.advance(testConfig.leaseMs); t.mock.timers.tick(testConfig.leaseMs);
    await settled(async () => (await f.store.get(profile.id))?.grant?.phase === 'complete');
    assert.equal(f.checker.active(), 1, 'The checker must still be pending when grant cleanup finishes');
    assert.equal((await f.store.get(profile.id))?.grant?.expiresAt, expiresAt);
    assert.equal(f.cloud.profiles.get(uuid)?.folder, testConfig.homeFolder);
    assert.deepEqual(f.cloud.calls, [`update:${uuid}`, `clear:${uuid}`]);
    assert.deepEqual(f.reports, []);
  } finally { await f.runtime.stop(); }
});

test('only two checker requests run concurrently, and a queued third begins after a slot is released', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture([901, 902, 903]);
  try {
    await f.runtime.start(); await settled(() => f.checker.active() === 2);
    assert.equal(f.checker.calls.length, 2);
    assert.equal((await f.store.clientState(903))?.setup?.phase, 'queued');
    f.advance(5000); t.mock.timers.tick(5000); await Promise.resolve();
    assert.equal(f.checker.calls.length, 2);
    f.checker.complete(0);
    await settled(async () => (await f.store.clientState(901))?.setup?.phase === 'awaiting_confirmation');
    f.advance(1000); t.mock.timers.tick(1000);
    await settled(() => f.checker.calls.length === 3);
    assert.equal(f.checker.active(), 2);
    assert.equal(f.checker.peak(), 2);
    assert.equal((await f.store.clientState(903))?.setup?.phase, 'checking');
  } finally { await f.runtime.stop(); }
});

test('stop cancels and drains pending checks; restart records unknown outcomes without checking again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture([901, 902]);
  try {
    await f.runtime.start(); await settled(() => f.checker.active() === 2);
    await f.runtime.stop();
    assert.equal(f.checker.cancellations(), 1);
    assert.equal(f.checker.active(), 0);
    assert.equal(f.runtime.status().running, false);
    assert.equal(f.runtime.status().leader, false);
    for (const clientId of [901, 902]) assert.equal((await f.store.clientState(clientId))?.setup?.phase, 'checking');
    f.advance(10_000); t.mock.timers.tick(10_000);
    assert.equal(f.checker.calls.length, 2, 'Stopped scheduler must not dequeue any new checker work');
    await f.runtime.start();
    await settled(async () => (await f.store.clientState(901))?.setup?.phase === 'unknown'
      && (await f.store.clientState(902))?.setup?.phase === 'unknown');
    assert.equal(f.checker.calls.length, 2);
    for (const clientId of [901, 902]) assert.equal((await f.store.clientState(clientId))?.setup?.error, 'octo_proxy_check_unknown');
    f.advance(5000); t.mock.timers.tick(5000); await Promise.resolve();
    assert.equal(f.checker.calls.length, 2);
  } finally { await f.runtime.stop(); }
});

test('stopping a full checker queue leaves undispatched clients queued and cannot start their checks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture([901, 902, 903]);
  try {
    await f.runtime.start(); await settled(() => f.checker.active() === 2);
    await f.runtime.stop();
    f.advance(60_000); t.mock.timers.tick(60_000); await Promise.resolve();
    assert.equal(f.checker.calls.length, 2);
    assert.equal(f.checker.active(), 0);
    assert.equal((await f.store.clientState(903))?.setup?.phase, 'queued');
    assert.equal((await f.store.list(903)).length, 0);
  } finally { await f.runtime.stop(); }
});
