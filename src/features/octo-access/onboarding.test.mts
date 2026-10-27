import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from './testing.mts';
import { createOctoService } from './service.mts';
import { createOnboardingService } from './onboarding-service.mts';
import { advanceOnboarding } from './onboarding-workflow.mts';
import { reserveClientProfiles } from './profile-reservation.mts';
import type { ProxyInput } from './contracts.mts';

const input: ProxyInput = { type: 'socks5', host: 'proxy.example.com', port: 1080, login: 'user', password: 'secret' };
function fixture(market = 'En') {
  const store = createMemoryStore(); let checks = 0, score = 70;
  const getClient = async (id: number) => ({ ...mockClient(id), market });
  const deps = {
    checker: { check: async (_raw: string) => { checks++; return { index: 1, proxy: 'proxy.example.com:1080', ok: true,
      final_score: score, proxy_url: 'socks5h://user:secret@proxy.example.com:1080' }; },
    best: async (_key: string, _location: unknown) => { throw Error('unexpected'); } },
    catalogue: { list: async () => [], validate: async (_key: string, location: any) => location },
    dolphin: { list: async (_id: number):Promise<Array<{id:number;locale:string;hasProxy:boolean}>> => [], proxy: async (_id: number) => input },
  };
  const service = createOnboardingService({ store, getClient, ...deps });
  const advance = async () => advanceOnboarding((await store.clientState(901))!, { store, ...deps, check: async () => {},
    reserve: async id => reserveClientProfiles(store, await getClient(id), true),
    saveProxy: async () => { throw Error('unexpected proxy attach before provisioning'); } });
  return { store, getClient, deps, service, advance, checks: () => checks, score: (n: number) => { score = n; } };
}
test('En cannot be created through legacy ensure without an accepted setup; all-client scope still isolates owners', async () => {
  const f = fixture();
  const service = createOctoService({ store: f.store, config: { ...testConfig, allowAll: true }, getClient: f.getClient,
    onboarding: f.deps });
  assert.equal(service.allowed(903), true);
  await assert.rejects(service.ensure(903, true), { code: 'octo_proxy_setup_required' });
  assert.equal((await f.store.list()).length, 0);
});

test('direct LinkedIn recovery adds missing EN for a RU Dolphin student without recreating existing profiles',async()=>{
  const f=fixture('Ru');
  const ru=await reserveClientProfiles(f.store,await f.getClient(901),true);
  const account=(await f.store.clientState(901))!;
  account.setup={id:'recovery',source:'direct',phase:'provisioning',createdAt:Date.now(),confirmDolphin:true,locales:['ru','en']};
  await f.store.saveClientState(account);
  f.deps.dolphin.list=async()=>[{id:100,locale:'ru',hasProxy:true}];
  const service=createOctoService({store:f.store,config:testConfig,getClient:f.getClient,onboarding:f.deps});
  await service.reserve(901);await service.reserve(901);
  const profiles=await f.store.list(901);
  assert.equal(profiles.length,2);assert.deepEqual(profiles.find(p=>p.locale==='ru'),ru[0]);
  assert.equal(profiles.filter(p=>p.locale==='en').length,1);
  assert.equal(profiles[0].password,profiles[1].password);assert.equal(f.checks(),0);
});
test('accepted own proxy is checked once, creates no profile before checking and reserves shared-password Ru/En', async () => {
  const f = fixture();
  await f.service.start(901, { source: 'own', proxy: 'proxy.example.com:1080:user:secret' });
  await f.service.start(901, { source: 'own', proxy: 'proxy.example.com:1080:user:secret' });
  assert.equal((await f.store.list()).length, 0);
  await f.advance(); await f.advance();
  const profiles = await f.store.list(901);
  assert.equal(f.checks(), 1); assert.equal(profiles.length, 2);
  assert.equal(profiles[0].password, profiles[1].password);
  assert.equal((await f.service.status(901)).phase, 'provisioning');
  const publicState = JSON.stringify(await f.service.status(901));
  assert.ok(!publicState.includes('secret')); assert.ok(!publicState.includes(profiles[0].password));
});
test('low score needs exact owner confirmation; errors cannot be confirmed', async () => {
  const f = fixture(); f.score(69);
  const started = await f.service.start(901, { source: 'own', proxy: 'socks5://user:secret@proxy.example.com:1080' });
  await f.advance();
  assert.equal((await f.store.list()).length, 0);
  assert.equal((await f.service.status(901)).phase, 'awaiting_confirmation');
  await assert.rejects(f.service.accept(902, started.id!, true), { code: 'not_found' });
  await f.service.accept(901, started.id!, true); await f.advance();
  assert.equal(f.checks(), 1); assert.equal((await f.store.list()).length, 2);
});
test('restart after checking was dispatched stays unknown and never reruns an external check', async () => {
  const f = fixture(); await f.service.start(901, { source: 'own', proxy: 'proxy.example.com:1080:user:secret' });
  const state = (await f.store.clientState(901))!; state.setup!.phase = 'checking'; await f.store.saveClientState(state);
  await f.advance(); await f.advance();
  assert.equal(f.checks(), 0); assert.equal((await f.service.status(901)).phase, 'unknown');
  assert.equal((await f.store.list()).length, 0);
});
test('Ru setup skips checker and retains an existing client password when adding another market', async () => {
  const f = fixture('Ru'); await f.store.claimClientPassword(901, '03742');
  await f.service.start(901, { source: 'none' }); await f.advance();
  assert.equal(f.checks(), 0); assert.equal((await f.store.list(901))[0].password, '03742');
});

test('manual structured proxy skips retired checker and direct setup reserves EN without pool proxy', async () => {
  const f = fixture();
  const service = createOctoService({ store: f.store, config: testConfig, getClient: f.getClient, onboarding: f.deps });
  await service.startOnboarding(901, { source: 'manual', proxy: { ...input, type: 'http' } });
  await service.reserve(901);
  assert.equal(f.checks(), 0);
  assert.equal((await f.store.clientState(901))!.setup!.input!.type, 'http');
  assert.ok((await f.store.list(901)).every(p => p.ownProxy));
  const direct = fixture();
  const state = await direct.store.claimClientPassword(901, '00321');
  state.setup = { id: 'new-intake', source: 'direct', phase: 'provisioning', createdAt: 1, confirmDolphin: false };
  await direct.store.saveClientState(state);
  const s = createOctoService({ store: direct.store, config: testConfig, getClient: direct.getClient, onboarding: direct.deps });
  await s.reserve(901); await s.reserve(901);
  assert.equal((await direct.store.list()).length, 2);
  assert.ok((await direct.store.list()).every(p => p.ownProxy && p.password === '00321'));
});

test('direct workflow completes without attaching a proxy; retired queued checks never restart', async () => {
  const f = fixture(); const state = await f.store.claimClientPassword(901, '00321');
  state.setup = { id: 'new-intake', source: 'direct', phase: 'provisioning', createdAt: 1, confirmDolphin: false };
  await f.store.saveClientState(state);
  const profiles = await reserveClientProfiles(f.store, await f.getClient(901), true);
  for (const p of profiles) { p.phase = 'ready'; await f.store.save(p); }
  await f.advance();
  assert.equal((await f.store.clientState(901))!.setup!.phase, 'complete');
  assert.equal(f.checks(), 0);
  const legacy = fixture(); await legacy.service.start(901, { source: 'own', proxy: 'proxy.example.com:1080:user:secret' });
  await advanceOnboarding((await legacy.store.clientState(901))!, { store: legacy.store, ...legacy.deps, allowLegacyChecks: false,
    check: async () => {}, reserve: async () => { throw Error('must not reserve'); }, saveProxy: async () => { throw Error('must not attach'); } });
  assert.equal(legacy.checks(), 0);
  assert.equal((await legacy.store.clientState(901))!.setup!.error, 'octo_legacy_proxy_setup_retired');
});
