import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckerDevelopmentHelp } from './checker-development-help.mts';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from './testing.mts';
import { createOctoService } from './service.mts';

const env = { PROXY_CHECKER_BASE_URL: 'http://127.0.0.1:8002', UNICORN_PROXY_CHECKER_SECRET_KEY: 'private-key' };
test('local outage shows installation link; healthy recovery hides it; concurrent polls share the bounded probe', async () => {
  let calls = 0, time = 1000, healthy = false;
  const probe = createCheckerDevelopmentHelp(env, (async (url, init) => {
    calls++; assert.equal(url, 'http://127.0.0.1:8002/health'); assert.equal(init?.headers, undefined);
    if (!healthy) throw Error('ECONNREFUSED'); return new Response('ok');
  }) as typeof fetch, () => time)!;
  const [a, b] = await Promise.all([probe(), probe()]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.match(a!.message, /Для локальной разработки/);
  assert.equal(a!.repositoryUrl, 'https://github.com/Kira2K/unicorn-proxy-checker');
  assert.equal(JSON.stringify(a).includes('private-key'), false);
  healthy = true; time += 10_000; assert.equal(await probe(), undefined); assert.equal(calls, 2);
  await probe(); assert.equal(calls, 2);
});
test('production, Render and remote checker never expose local setup instructions or probe', () => {
  for (const patch of [{ NODE_ENV: 'production' }, { RENDER: 'true' }, { PROXY_CHECKER_BASE_URL: 'https://checker.example' }])
    assert.equal(createCheckerDevelopmentHelp({ ...env, ...patch }), undefined);
});
test('missing local configuration explains setup without making a request', async () => {
  assert.ok(await createCheckerDevelopmentHelp({}, (async () => { throw Error('unexpected'); }) as typeof fetch)!());
});
test('unavailable local checker blocks proxy onboarding before any setup or profile write', async () => {
  const store = createMemoryStore(), cloud = createMockCloud(store);
  const service = createOctoService({ store, config: testConfig, getClient: async id => ({ ...mockClient(id), market: 'En' }),
    onboarding: { developmentHelp: createCheckerDevelopmentHelp({}),
      checker: { async check() { throw Error('unexpected'); }, async best() { throw Error('unexpected'); } },
      catalogue: { async list() { return []; }, async validate(v) { throw Error(v); } },
      dolphin: { async list() { return []; }, async proxy() { return undefined; } } } });
  await assert.rejects(service.startOnboarding(901, { source: 'own', proxy: 'proxy.example:1080:user:password' }), { code: 'octo_checker_local_unavailable' });
  assert.equal(await store.clientState(901), undefined); assert.deepEqual(await store.list(), []);
  assert.ok((await service.status(901)).onboarding.developmentHelp); assert.deepEqual(cloud.calls, []);
});
