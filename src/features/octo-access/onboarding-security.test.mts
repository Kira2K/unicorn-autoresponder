import test from 'node:test';
import assert from 'node:assert/strict';
import { OctoError } from './contracts.mts';
import type { ProxyInput } from './contracts.mts';
import type { ProxySetup } from './onboarding-contracts.mts';
import type { OnboardingDependencies } from './onboarding-service.mts';
import { createOctoService } from './service.mts';
import { advanceOnboarding } from './onboarding-workflow.mts';
import { reserveClientProfiles } from './profile-reservation.mts';
import { createMemoryStore, mockClient, testConfig } from './testing.mts';

const input: ProxyInput = { type: 'socks5', host: 'checked.example', port: 1080, login: 'checked-user', password: 'checked-secret' };
const unexpected = async (): Promise<never> => { throw new Error('unexpected external call'); };
function dependencies(list: OnboardingDependencies['dolphin']['list'] = async () => []): OnboardingDependencies {
  return { checker: { check: unexpected, best: unexpected }, catalogue: { list: unexpected, validate: unexpected },
    dolphin: { list, proxy: unexpected } };
}

async function fixture(options: { source?: ProxySetup['source']; phase?: ProxySetup['phase']; ready?: boolean;
  dolphinList?: OnboardingDependencies['dolphin']['list'] } = {}) {
  const store = createMemoryStore(), getClient = async (id: number) => ({ ...mockClient(id), market: 'En' });
  let state = await store.claimClientPassword(901, '03742');
  state.setup = { id: 'setup-1', source: options.source ?? 'own', phase: options.phase ?? 'provisioning',
    createdAt: 1000, confirmDolphin: true, ...(options.source === 'none' ? {} : { input: structuredClone(input), score: 70 }) };
  state = await store.saveClientState(state);
  const deps = dependencies(options.dolphinList);
  const service = createOctoService({ store, getClient, config: testConfig, onboarding: deps, now: () => 1001 });
  if (options.ready) {
    for (const profile of await reserveClientProfiles(store, await getClient(901), true, () => 1001)) {
      profile.phase = 'ready'; profile.uuid = 'profile-' + profile.locale;
      await store.save(profile);
    }
  }
  return { store, getClient, service, deps, state };
}

test('En ensure cannot bypass a checked proxy using none-source provisioning state', async () => {
  let dolphinReads = 0;
  const f = await fixture({ source: 'none', dolphinList: async () => { dolphinReads++; return []; } });
  await assert.rejects(f.service.ensure(901, true), { code: 'octo_proxy_setup_required' });
  assert.deepEqual(await f.store.list(901), []);
  assert.equal(dolphinReads, 0);
});

test('direct proxy edits cannot replace a checked connection during an active onboarding setup', async () => {
  for (const phase of ['queued', 'checking', 'awaiting_confirmation', 'provisioning'] as const) {
    const f = await fixture({ phase, ready: true });
    const en = (await f.store.list(901)).find(profile => profile.locale === 'en')!;
    const before = structuredClone(en);
    await assert.rejects(f.service.saveProxy(901, en.id, { ...input, password: 'unchecked-secret' }), (error: unknown) => {
      assert.ok(error instanceof OctoError); assert.equal(error.status, 409);
      assert.doesNotMatch(JSON.stringify(error), /checked-secret|unchecked-secret/);
      return true;
    });
    assert.deepEqual(await f.store.get(en.id), before);
  }
});

test('workflow blocks a completed En proxy change whose input differs from the checked setup connection', async () => {
  const f = await fixture({ ready: true });
  const en = (await f.store.list(901)).find(profile => profile.locale === 'en')!;
  const unverified = { ...input, host: 'unverified.example', password: 'unchecked-secret' };
  en.proxy = { uuid: 'unchecked-proxy', title: 'unchecked', type: unverified.type, host: unverified.host, port: unverified.port };
  en.proxyChange = { id: 'setup-1', phase: 'complete', input: unverified, uuid: 'unchecked-proxy', title: 'unchecked' };
  await f.store.save(en);
  await advanceOnboarding((await f.store.clientState(901))!, { ...f.deps, store: f.store, check: async () => {},
    reserve: async id => f.store.list(id), saveProxy: unexpected, now: () => 1002 });
  const setup = (await f.store.clientState(901))!.setup!;
  assert.equal(setup.phase, 'blocked');
  assert.equal(setup.completedAt, undefined);
  assert.deepEqual(setup.input, input);
  assert.match(setup.error ?? '', /^octo_/);
  assert.doesNotMatch(setup.error ?? '', /checked-secret|unchecked-secret/);
});

test('a completed proxy change with erased credentials still must belong to this setup', async () => {
  const f = await fixture({ ready: true });
  const en = (await f.store.list(901)).find(profile => profile.locale === 'en')!;
  en.proxy = { uuid: 'other-proxy', title: 'other' };
  en.proxyChange = { id: 'other-setup', phase: 'complete', uuid: 'other-proxy', title: 'other' };
  await f.store.save(en);
  await advanceOnboarding((await f.store.clientState(901))!, { ...f.deps, store: f.store, check: async () => {},
    reserve: async id => f.store.list(id), saveProxy: unexpected });
  assert.equal((await f.store.clientState(901))!.setup?.phase, 'blocked');
});

test('workflow binds the queued proxy operation to its setup and completes after credentials are erased', async () => {
  let dolphinReads = 0;
  const f = await fixture({ ready: true, dolphinList: async () => { dolphinReads++; throw new Error('Dolphin unavailable'); } });
  const advance = () => f.store.clientState(901).then(state => advanceOnboarding(state!, { ...f.deps, store: f.store,
    check: async () => {}, reserve: id => f.service.reserve(id, true),
    saveProxy: (clientId, profileId, proxy, operationId) => f.service.queueProxy(clientId, profileId, proxy, operationId) }));
  await advance();
  const en = (await f.store.list(901)).find(profile => profile.locale === 'en')!;
  assert.equal(en.proxyChange?.id, 'setup-1');
  assert.deepEqual(en.proxyChange?.input, input);
  en.proxyChange!.phase = 'complete'; delete en.proxyChange!.input;
  en.proxy = { uuid: 'checked-proxy', title: 'checked', type: input.type, host: input.host, port: input.port };
  await f.store.save(en);
  await advance();
  const setup = (await f.store.clientState(901))!.setup!;
  assert.equal(setup.phase, 'complete');
  assert.equal(setup.input, undefined);
  assert.equal(dolphinReads, 0);
});

test('internal reserve commits profiles after one Dolphin precheck without fetching status after the write', async () => {
  let dolphinReads = 0;
  const f = await fixture({ dolphinList: async () => {
    dolphinReads++;
    if (dolphinReads > 1) throw new Error('Dolphin became unavailable after the reservation precheck');
    return [];
  } });
  const reserved = await f.service.reserve(901, true);
  assert.equal(reserved.length, 2);
  assert.deepEqual(reserved.map(profile => profile.locale).sort(), ['en', 'ru']);
  assert.ok(reserved.every(profile => profile.password === '03742'));
  assert.equal(dolphinReads, 1);
  assert.equal((await f.store.list(901)).length, 2);
  await f.service.reserve(901, true);
  assert.equal(dolphinReads, 1);
});

test('internal queueProxy persists the checked connection without any Dolphin/status request', async () => {
  let dolphinReads = 0;
  const f = await fixture({ ready: true, dolphinList: async () => { dolphinReads++; throw new Error('Dolphin unavailable'); } });
  const en = (await f.store.list(901)).find(profile => profile.locale === 'en')!;
  await f.service.queueProxy(901, en.id, input);
  const saved = (await f.store.get(en.id))!;
  assert.equal(saved.proxyChange?.phase, 'queued');
  assert.deepEqual(saved.proxyChange?.input, input);
  assert.equal(dolphinReads, 0);
});
