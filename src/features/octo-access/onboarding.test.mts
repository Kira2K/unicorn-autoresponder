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
    dolphin: { list: async (_id: number) => [], proxy: async (_id: number) => input },
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
