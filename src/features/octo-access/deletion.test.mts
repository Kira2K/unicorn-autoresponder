import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceDeletion } from './deletion-workflow.mts';
import { OctoError } from './contracts.mts';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from './testing.mts';
import { createOctoService } from './service.mts';

async function fixture(withProxy = true) {
  const store = createMemoryStore(), cloud = createMockCloud(store), calls: string[] = [];
  const service = createOctoService({ store, config: testConfig, getClient: async id => mockClient(id), password: () => '01234' });
  await service.ensure(901);
  let p = (await store.list())[0];
  p = await store.save({ ...p, uuid: 'profile-a', phase: 'ready',
    ...(withProxy ? { proxy: { uuid: 'proxy-a', title: 'A' }, proxyChange: { id: 'operation-a', title: 'A', phase: 'complete' as const, uuid: 'proxy-a' } } : {}) });
  let client = (await store.clientState(901))!;
  client = await store.saveClientState({ ...client, nodeMavenKey: 'retained-client-key', setup: {
    id: 'setup-a', source: 'own', phase: 'provisioning', createdAt: p.createdAt, confirmDolphin: false,
    profileIds: [p.id], input: { type: 'socks5', host: 'private.example', port: 1080, login: 'user', password: 'secret' }
  } });
  const proxies = new Map(withProxy ? [['proxy-a', { uuid: 'proxy-a', title: 'A', profiles_count: 0 }]] : []);
  cloud.api.profileExists = async () => { calls.push('exists'); return false; };
  cloud.api.listProxies = async () => [...proxies.values()];
  cloud.api.deleteProxy = async uuid => { calls.push(`delete:${uuid}`); proxies.delete(uuid); };
  let time = 100_000;
  const event = { id: 'deleted-a', action: 'profiles.trashed', profileId: p.uuid!, time: time / 1000 };
  await store.recordPage({ events: [event], watermark: { uuid: event.id, time: event.time } });
  const advance = async () => { const current = await store.get(p.id); if (current) await advanceDeletion(current,
    { store, api: cloud.api, check: async () => {}, now: () => time }); };
  return { store, api: cloud.api, service, p, client, calls, proxies, event, advance, elapse(ms: number) { time += ms; } };
}

for (const withProxy of [false, true]) test(`purges profile, secrets and events; retains client; proxy=${withProxy}`, async () => {
  const f = await fixture(withProxy);
  await assert.rejects(f.service.acquire(901, f.p.id), { code: 'octo_profile_deleting' });
  assert.equal((await f.service.status(901)).profiles[0].phase, 'deleting');
  await f.advance();
  assert.equal(await f.store.get(f.p.id), undefined);
  assert.deepEqual(await f.store.events('profile-a'), []);
  assert.equal(f.proxies.size, 0);
  assert.deepEqual(f.calls, ['exists', ...(withProxy ? ['delete:proxy-a'] : [])]);
  const client = (await f.store.clientState(901))!;
  assert.equal(client.password, '01234'); assert.equal(client.nodeMavenKey, 'retained-client-key'); assert.equal(client.setup, undefined);
  await f.store.recordPage({ events: [{ ...f.event, id: 'late-event' }], watermark: { uuid: 'late-event', time: 101 } });
  assert.deepEqual(await f.store.events('profile-a'), []);
  assert.equal((await f.store.stream()).cursor?.uuid, 'late-event');
  await assert.rejects(f.service.acquire(901, f.p.id), { code: 'not_found' });
  await assert.rejects(f.store.save(f.p), { code: 'octo_stale_revision' });
});

test('duplicate event does not reset attempts; retry waits 30 seconds and stops after two failures', async () => {
  const f = await fixture();
  f.api.profileExists = async () => { f.calls.push('exists'); throw new OctoError('octo_request_outcome_unknown'); };
  await f.advance(); await f.advance(); assert.equal(f.calls.length, 1);
  await f.store.recordPage({ events: [f.event], watermark: { uuid: 'next-page', time: 110 } });
  f.elapse(29_999); await f.advance(); assert.equal(f.calls.length, 1);
  f.elapse(1); await f.advance(); assert.equal(f.calls.length, 2);
  assert.equal((await f.store.get(f.p.id))?.deletion?.phase, 'blocked');
  f.elapse(1_000_000); await f.advance(); assert.equal(f.calls.length, 2);
  assert.equal(f.proxies.size, 1);
});

test('restored profile is retained; replay of its deletion event does not delete it', async () => {
  const f = await fixture(); f.api.profileExists = async () => true;
  await f.advance(); assert.equal((await f.store.get(f.p.id))?.deletion, undefined);
  await f.store.recordPage({ events: [f.event], watermark: { uuid: 'replay', time: 110 } });
  assert.equal((await f.store.get(f.p.id))?.deletion, undefined);
  assert.equal(f.proxies.size, 1); assert.ok((await f.store.clientState(901))?.setup);
});

test('cloud-shared proxy is retained while the deleted binding is removed', async () => {
  const f = await fixture(); f.proxies.get('proxy-a')!.profiles_count = 1;
  await f.advance(); assert.equal(f.proxies.size, 1); assert.equal(await f.store.get(f.p.id), undefined);
  assert.deepEqual(f.calls, ['exists']);
});

test('already absent proxy is not deleted again', async () => {
  const f = await fixture(); f.proxies.clear(); await f.advance();
  assert.deepEqual(f.calls, ['exists']); assert.equal(await f.store.get(f.p.id), undefined);
});

test('proxy reserved by another DB profile is retained even before cloud attachment', async () => {
  const f = await fixture();
  const other = (await f.store.reserve([{ ...f.p, id: undefined, revision: undefined, clientId: 902, locale: 'en', password: '56789',
    uuid: undefined, proxy: undefined, proxyChange: undefined, deletion: undefined } as any]))[0];
  const reserved = await f.store.save({ ...other, proxyChange: { id: 'other-op', title: 'Other', phase: 'attaching', uuid: 'proxy-a' } });
  await f.advance(); assert.equal(f.proxies.size, 1); assert.equal(await f.store.get(f.p.id), undefined);
  assert.deepEqual(await f.store.get(reserved.id), reserved);
});

test('unknown creation without a discovered proxy remains pending then blocked; marker is not lost', async () => {
  const f = await fixture(false), p = (await f.store.get(f.p.id))!;
  await f.store.save({ ...p, proxyChange: { id: 'unknown-create', title: 'Unknown', phase: 'creating', pending: 'create' } });
  await f.advance(); f.elapse(30_000); await f.advance();
  const current = (await f.store.get(f.p.id))!;
  assert.equal(current.deletion?.phase, 'blocked'); assert.equal(current.proxyChange?.id, 'unknown-create');
});

test('permission errors do not retry or claim successful cleanup', async () => {
  const f = await fixture();
  f.api.deleteProxy = async () => { f.calls.push('delete'); throw new OctoError('octo_request_failed', 502, { httpStatus: 403 }); };
  await f.advance(); f.elapse(60_000); await f.advance();
  assert.equal((await f.store.get(f.p.id))?.deletion?.phase, 'blocked'); assert.equal(f.proxies.size, 1);
  assert.deepEqual(f.calls, ['exists', 'delete']);
});

test('a crash during the second dispatch does not create a third attempt after restart', async () => {
  const f = await fixture(false), p = (await f.store.get(f.p.id))!;
  await f.store.save({ ...p, deletion: { ...p.deletion!, attempts: 2, nextAttemptAt: 110_000 } });
  await f.advance(); assert.deepEqual(f.calls, []);
  f.elapse(10_000); await f.advance();
  assert.equal((await f.store.get(p.id))?.deletion?.phase, 'blocked'); assert.deepEqual(f.calls, []);
});

test('temporary failures wait thirty seconds after the failed response, not dispatch', async () => {
  const f = await fixture(false);
  f.api.profileExists = async () => { f.calls.push('exists'); f.elapse(20_000); throw new OctoError('octo_request_outcome_unknown'); };
  await f.advance(); f.elapse(29_999); await f.advance(); assert.equal(f.calls.length, 1);
  f.elapse(1); await f.advance(); assert.equal(f.calls.length, 2);
});

test('uncertain proxy DELETE is reconciled after restart without a second DELETE', async () => {
  const f = await fixture();
  f.api.deleteProxy = async uuid => { f.calls.push(`delete:${uuid}`); f.proxies.delete(uuid); throw new OctoError('octo_request_outcome_unknown'); };
  await f.advance(); assert.ok(await f.store.get(f.p.id));
  assert.equal((await f.store.get(f.p.id))?.deletion?.phase, 'proxies');
  f.elapse(30_000); await f.advance(); assert.equal(await f.store.get(f.p.id), undefined);
  assert.deepEqual(f.calls, ['exists', 'delete:proxy-a']);
});

test('unfinished creation is found by the exact operation marker', async () => {
  const f = await fixture(false);
  const p = (await f.store.get(f.p.id))!;
  await f.store.save({ ...p, proxyChange: { id: 'pending-op', title: 'Pending', phase: 'creating', pending: 'create' } });
  f.proxies.set('new-proxy', { uuid: 'new-proxy', title: 'Pending', profiles_count: 0 });
  f.api.proxyConnections = async marker => {
    assert.equal(marker, 'unicorn-octo-proxy:pending-op');
    return [{ uuid: 'new-proxy', title: 'Pending', profiles_count: 0, type: 'socks5', host: 'private.example', port: 1080, login: 'user', password: 'secret', externalId: marker }];
  };
  await f.advance(); assert.equal(f.proxies.size, 0); assert.equal(await f.store.get(f.p.id), undefined);
});
