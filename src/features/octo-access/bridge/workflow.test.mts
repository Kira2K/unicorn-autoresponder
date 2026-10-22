import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceGrant } from '../grant-workflow.mts';
import { provisionProfile } from '../provision.mts';
import { createOctoService } from '../service.mts';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from '../testing.mts';
import { createBridgeBroker } from './broker.mts';

const bridge = { id: 'owner-pc', ownerEmail: 'owner@example.com' };
async function fixture() {
  let time = Date.now(), checkpoint: string | undefined = 'connected';
  const now = () => time, store = createMemoryStore(), cloud = createMockCloud(store, now);
  const config = { ...testConfig, leaseMs: 120000 };
  const service = createOctoService({ store, config, now, getClient: async id => mockClient(id) });
  await service.ensure(901); await service.ensure(902);
  const deps = { store, api: cloud.api, config, now, check: async () => {}, passwordBridge: bridge,
    historyCheckpoint: () => checkpoint };
  for (const p of await store.list()) await provisionProfile(p, deps);
  const broker = createBridgeBroker({ ...deps, bridge, checkpoint: async () => checkpoint });
  const advance = async () => { for (const p of await store.list()) await advanceGrant(p, deps); };
  return { store, cloud, service, broker, advance, now, tick(ms: number) { time += ms; },
    connection(value: string | undefined) { checkpoint = value; } };
}
const device = 'a'.repeat(64), otherDevice = 'b'.repeat(64);
test('bridge: two clients, three cycles, independent 120s, offline hiding and unchanged passwords', async () => {
  const f = await fixture(), [a, b] = await f.store.list();
  for (let cycle = 0; cycle < 3; cycle++) {
    await f.service.acquire(a.clientId, a.id); await f.advance(); await f.cloud.start(a.uuid!);
    f.tick(1000); await f.service.acquire(b.clientId, b.id); await f.advance(); await f.cloud.start(b.uuid!);
    const deadline = (await f.store.get(a.id))!.grant!.expiresAt!;
    assert.equal(deadline - (await f.store.get(a.id))!.grant!.grantedAt!, 120000);
    assert.equal(await f.broker.poll(device), null);
    f.tick(119000); await f.advance();
    assert.equal((await f.cloud.api.getProfile(a.uuid!)).folder, 'home');
    assert.equal((await f.cloud.api.getProfile(a.uuid!)).status, 1);
    assert.equal((await f.cloud.api.getProfile(b.uuid!)).folder, 'guest');
    assert.equal(await f.broker.poll(device), null);
    await f.cloud.stop(a.uuid!); await f.advance();
    const job = (await f.broker.poll(device))!;
    assert.equal(job.uuid, a.uuid); assert.equal(job.password, a.password);
    // Offline bridge does not block expiry of another browser.
    f.tick(5000); await f.advance();
    assert.equal((await f.cloud.api.getProfile(b.uuid!)).folder, 'home');
    assert.equal((await f.cloud.api.getProfile(b.uuid!)).status, 1);
    assert.equal((await f.store.get(a.id))!.grant!.phase, 'awaiting_close');
    assert.ok(!f.cloud.calls.some(c => c.startsWith('clear:')));
    await f.broker.authorize(device, job.id);
    // This is the mock Desktop operation, never the cloud cleanup adapter.
    f.cloud.profiles.get(a.uuid!)!.has_user_password = false;
    await f.broker.result(device, job.id, { state: 'succeeded' }); await f.advance();
    assert.equal((await f.store.get(a.id))!.grant!.phase, 'complete');
    await f.cloud.stop(b.uuid!); await f.advance();
    const second = (await f.broker.poll(device))!;
    await f.broker.authorize(device, second.id); f.cloud.profiles.get(b.uuid!)!.has_user_password = false;
    await f.broker.result(device, second.id, { state: 'succeeded' }); await f.advance();
    assert.equal((await f.store.get(b.id))!.grant!.phase, 'complete');
    for (const original of [a, b]) assert.equal((await f.store.get(original.id))!.password, original.password);
  }
  assert.equal(f.cloud.calls.filter(c => c === 'create').length, 2);
  assert.equal(f.cloud.calls.filter(c => c.startsWith('clear:')).length, 0);
});
test('bridge: metadata false is insufficient; a lost Desktop result remains uncertain after restart', async () => {
  const f = await fixture(), [a] = await f.store.list();
  await f.service.acquire(a.clientId, a.id); await f.advance(); await f.cloud.start(a.uuid!);
  f.tick(120000); await f.advance(); await f.cloud.stop(a.uuid!); await f.advance();
  const job = (await f.broker.poll(device))!;
  assert.equal(await f.broker.poll(otherDevice), null);
  await f.broker.authorize(device, job.id);
  await assert.rejects(f.broker.authorize(device, job.id), { code: 'octo_bridge_already_authorized' });
  f.cloud.profiles.get(a.uuid!)!.has_user_password = false;
  await f.advance(); assert.notEqual((await f.store.get(a.id))!.grant!.phase, 'complete');
  await f.broker.result(device, job.id, { state: 'uncertain', code: 'bridge_local_outcome_unknown' });
  await f.advance(); await f.advance();
  assert.equal((await f.store.get(a.id))!.grant!.phase, 'blocked');
  assert.equal((await f.store.get(a.id))!.grant!.error, 'octo_bridge_outcome_unknown');
  assert.equal(f.cloud.calls.filter(c => c.startsWith('clear:')).length, 0);
});
test('bridge: history loss, disconnect and force-stop cannot authorize a queued clear', async () => {
  for (const kind of ['gap', 'force', 'disconnect'] as const) {
    const f = await fixture(), [a] = await f.store.list();
    await f.service.acquire(a.clientId, a.id); await f.advance(); await f.cloud.start(a.uuid!);
    f.tick(120000); await f.advance(); await f.cloud.stop(a.uuid!); await f.advance();
    const job = (await f.broker.poll(device))!;
    if (kind === 'gap') await f.store.setCoverage(f.now());
    if (kind === 'force') await f.cloud.force(a.uuid!);
    if (kind === 'disconnect') f.connection(undefined);
    await assert.rejects(f.broker.authorize(device, job.id));
    assert.equal(f.cloud.calls.filter(c => c.startsWith('clear:')).length, 0);
  }
});
test('bridge: early closure and unopened profiles remain protected for the full 120 seconds', async () => {
  const f = await fixture(), [a,b] = await f.store.list();
  await f.service.acquire(a.clientId,a.id); await f.service.acquire(b.clientId,b.id); await f.advance();
  await f.cloud.start(a.uuid!); await f.cloud.stop(a.uuid!);
  f.tick(119999); await f.advance(); assert.equal(await f.broker.poll(device),null);
  for (const p of [a,b]) assert.equal((await f.cloud.api.getProfile(p.uuid!)).has_user_password,true);
  f.tick(1); await f.advance();
  for (const p of [a,b]) assert.equal((await f.store.get(p.id))!.grant!.clearMethod,'bridge');
  assert.equal(f.cloud.calls.filter(c=>c.startsWith('clear:')||c.startsWith('protect:')).length,0);
});

test('bridge: a checkpoint change while saving the job discards only the unsent cleanup', async () => {
  const f = await fixture(), [p] = await f.store.list();
  await f.service.acquire(p.clientId, p.id); await f.advance(); await f.cloud.start(p.uuid!);
  f.tick(120000); await f.advance(); await f.cloud.stop(p.uuid!);
  const save = f.store.save;
  f.store.save = async profile => {
    const saved = await save(profile);
    if (profile.grant?.pending === 'clear') f.connection('new-page');
    return saved;
  };
  await f.advance();
  const interrupted = (await f.store.get(p.id))!.grant!;
  assert.equal(interrupted.phase, 'awaiting_close');
  assert.equal(interrupted.error, 'octo_event_history_pending');
  assert.equal(interrupted.pending, undefined);
  assert.equal(interrupted.bridgeClear, undefined);
  assert.equal(await f.broker.poll(device), null);
  assert.equal((await f.cloud.api.getProfile(p.uuid!)).has_user_password, true);
  f.store.save = save; await f.advance();
  assert.equal((await f.broker.poll(device))!.uuid, p.uuid);
  assert.equal((await f.store.get(p.id))!.password, p.password);
  assert.equal(f.cloud.calls.filter(c => c.startsWith('clear:')).length, 0);
});
test('bridge: excluded/force-stopped jobs cannot starve another client or revert their block',async()=>{
  const f=await fixture(),[a,b]=await f.store.list();
  await f.service.acquire(a.clientId,a.id);await f.service.acquire(b.clientId,b.id);await f.advance();
  await f.cloud.start(a.uuid!);await f.cloud.start(b.uuid!);f.tick(120000);await f.advance();
  await f.cloud.stop(a.uuid!);await f.cloud.stop(b.uuid!);await f.advance();
  assert.equal((await f.broker.poll(device,[b.uuid!]))!.uuid,b.uuid);
  await f.cloud.force(a.uuid!);
  assert.equal((await f.broker.poll(otherDevice))?.uuid,undefined);
  await f.advance();assert.equal((await f.store.get(a.id))!.grant!.phase,'blocked');
  assert.equal((await f.store.get(a.id))!.grant!.error,'octo_force_stop_observed');
  const job=(await f.broker.poll(device,[b.uuid!]))!;await f.broker.authorize(device,job.id);
  f.cloud.profiles.get(b.uuid!)!.has_user_password=false;await f.broker.result(device,job.id,{state:'succeeded'});await f.advance();
  assert.equal((await f.store.get(b.id))!.grant!.phase,'complete');
});
