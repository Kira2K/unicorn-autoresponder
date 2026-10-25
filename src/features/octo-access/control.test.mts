import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readControlConfig } from './control-config.mts';
import { controlIdentity } from './control-identity.mts';
import { controlRoutes, controlPath, withControlRoutes } from './control-routes.mts';
import { createControlAcquire } from './control-client.mts';
import { createOctoService } from './service.mts';
import { createMemoryStore, mockClient, testConfig } from './testing.mts';
import { createCreationTaskService } from '../linkedin-automation/creation-tasks/service.mts';
import type { CreationTaskStore } from '../linkedin-automation/creation-tasks/postgres-store.mts';
const express = createRequire(import.meta.url)('express') as typeof import('express');
const secret = 'control-test-only-secret-with-32-characters';

async function fixture() {
  const store = createMemoryStore();
  const [p] = await store.reserve([{ clientId: 901, locale: 'en', password: '12345', operationId: 'fixture-control',
    uuid: 'a'.repeat(32), createdAt: 1, phase: 'ready', ownProxy: true,
    original: { title: 'Original', description: 'control-fixture', tags: [], start_pages: [] } }]);
  let ready = true, calls = 0;
  const service = createOctoService({ store, config: testConfig, getClient: async id => mockClient(id), canGrant: () => ready });
  const counted = { ...service, acquire: async (c: number, id: number) => { calls++; return service.acquire(c, id); } };
  const app = express();
  app.use((_r, s) => s.status(200).send('Console static fallback'));
  const outer = withControlRoutes(app, controlRoutes({ secret, store, config: testConfig, service: counted, ready: async () => ready }));
  const server = outer.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = (overrides: Partial<Parameters<typeof createControlAcquire>[0]> = {}) => createControlAcquire({
    url, secret, store, config: testConfig, allowed: service.allowed, ...overrides
  });
  return { store, p, service, url, client, calls: () => calls, notReady: () => { ready = false; },
    body: { clientId: 901, profileId: p.id, identity: controlIdentity(p, testConfig) },
    close: () => new Promise<void>((r, j) => { server.close(e => e ? j(e) : r()); server.closeAllConnections(); }) };
}

test('control configuration is opt-in, server-only and restricted to a configured origin', () => {
  assert.equal(readControlConfig({}), undefined);
  assert.deepEqual(readControlConfig({ OCTO_CONTROL_SECRET: secret }), { secret });
  assert.deepEqual(readControlConfig({ OCTO_CONTROL_SECRET: secret, OCTO_CONTROL_URL: 'https://worker.example.test/' }),
    { secret, url: 'https://worker.example.test' });
  for (const env of [{ OCTO_CONTROL_URL: 'https://worker.example.test' }, { OCTO_CONTROL_SECRET: 'short' },
    ...['http://worker.example.test', 'https://user:pass@worker.example.test', 'https://worker.example.test/api',
      'https://worker.example.test/?secret=x', 'https://worker.example.test/#x', 'file:///tmp'].map(url => ({ OCTO_CONTROL_SECRET: secret, OCTO_CONTROL_URL: url }))])
    assert.throws(() => readControlConfig(env), { code: 'octo_control_configuration_required' });
});

test('two Consoles share one persisted grant through the existing service', async () => {
  const f = await fixture();
  try {
    const [local, published] = await Promise.all([f.client()(901, f.p.id), f.service.acquire(901, f.p.id)]);
    assert.equal(local.id, published.id);
    assert.equal((await f.store.get(f.p.id))!.revision, 1, 'one creation despite concurrent requests');
    const again = await f.client()(901, f.p.id);
    assert.equal(again.id, local.id);
    assert.equal((await f.store.get(f.p.id))!.revision, 1);
    const status = await f.service.status(901);
    assert.equal(status.profiles[0].grantId, local.id);
    assert.equal('password' in local, false);
  } finally { await f.close(); }
});

test('Denis task access and student access reuse the same delegated acquire and SQL grant', async () => {
  const f = await fixture();
  try {
    const octo = { ...f.service, acquire: f.client() };
    const tasks = { detail: async (id: number) => {
      assert.equal(id, 1); return { task: { id: 1, clientId: 901 } };
    } } as unknown as CreationTaskStore;
    const denis = createCreationTaskService({ store: tasks, profiles: f.store, octo,
      client: async id => mockClient(id), secrets: async () => ({}), capture: async p => p, nodeMavenKey: () => '' });
    const [contractor, student] = await Promise.all([denis.acquire(1, f.p.id), octo.acquire(901, f.p.id)]);
    assert.equal(contractor.id, student.id);
    assert.equal((await denis.grant(1, contractor.id)).profileId, f.p.id);
    assert.equal((await f.store.get(f.p.id))!.revision, 1);
    await assert.rejects(denis.acquire(1, f.p.id + 1), { code: 'forbidden' });
  } finally { await f.close(); }
});

test('internal endpoint requires service auth, rejects browser origins and validates requests before writes', async () => {
  const f = await fixture();
  try {
    const call = (body: unknown, headers = {}, path = '/grants') => fetch(f.url + controlPath + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
    });
    const unauthorized = await call(f.body, { Cookie: 'webSession=client' });
    assert.equal(unauthorized.status, 401); assert.equal(unauthorized.headers.get('cache-control'), 'no-store');
    const auth = { Authorization: `Bearer ${secret}` };
    assert.equal((await call(f.body, { ...auth, Origin: 'https://console.example.test' })).status, 403);
    assert.equal((await call({ ...f.body, clientId: '901' }, auth)).status, 400);
    assert.equal((await call({ ...f.body, unused: true }, auth)).status, 400);
    assert.equal((await call({ ...f.body, clientId: 902 }, auth)).status, 404);
    assert.equal((await call({ ...f.body, clientId: 903 }, auth)).status, 403);
    assert.equal((await call({ ...f.body, identity: '0'.repeat(64) }, auth)).status, 409);
    assert.equal((await call(f.body, auth, '/wrong')).status, 404, 'internal routes never fall through to HTML');
    assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});

test('local owner and allowlist checks run before any network call', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const acquire = f.client({ fetch: async () => { calls++; throw Error('unexpected'); } });
    await assert.rejects(acquire(903, f.p.id), { code: 'forbidden' });
    await assert.rejects(acquire(902, f.p.id), { code: 'not_found' });
    await assert.rejects(acquire(901, 0), { code: 'invalid_profile_id' });
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('mismatched SQL bindings/folders and unavailable worker never issue a grant', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.client({ config: { ...testConfig, guestFolder: 'wrong' } })(901, f.p.id), { code: 'octo_control_profile_mismatch' });
    f.notReady();
    await assert.rejects(f.client()(901, f.p.id), { code: 'octo_listener_unavailable' });
    assert.equal(f.calls(), 0); assert.equal((await f.store.get(f.p.id))!.grant, undefined);
  } finally { await f.close(); }
});

test('existing access remains reusable during a worker outage, without extending its deadline', async () => {
  const f = await fixture();
  try {
    const first = await f.service.acquire(901, f.p.id);
    let p = (await f.store.get(f.p.id))!;
    p.grant!.phase = 'granted'; p.grant!.expiresAt = Date.now() + 120_000;
    p = await f.store.save(p); f.notReady();
    let requests = 0;
    const reused = await f.client({ fetch: async () => { requests++; throw Error('offline'); } })(901, f.p.id);
    assert.equal(reused.id, first.id); assert.equal(requests, 0);
    assert.deepEqual(await f.store.get(p.id), p);
    p.grant!.expiresAt = Date.now() - 1; await f.store.save(p);
    await assert.rejects(f.client()(901, p.id), { code: 'octo_cleanup_pending' });
  } finally { await f.close(); }
});

test('the remote service retains deletion, pending proxy, cleanup and readiness checks', async () => {
  const f = await fixture();
  try {
    let p = (await f.store.get(f.p.id))!;
    p.proxyChange = { id: 'proxy-pending', phase: 'queued', title: 'pending' }; await f.store.save(p);
    await assert.rejects(f.client()(901, p.id), { code: 'octo_proxy_pending' });
    p = (await f.store.get(p.id))!; delete p.proxyChange; p.phase = 'queued'; await f.store.save(p);
    await assert.rejects(f.client()(901, p.id), { code: 'octo_profile_not_ready' });
    p = (await f.store.get(p.id))!; p.phase = 'ready'; p.deletion = { eventId: 'deleted', phase: 'verify', attempts: 0, nextAttemptAt: 0 }; await f.store.save(p);
    await assert.rejects(f.client()(901, p.id), { code: 'octo_profile_deleting' });
  } finally { await f.close(); }
});

test('lost successful response is reconciled from SQL with no second mutation request', async () => {
  const f = await fixture();
  try {
    let mutations = 0;
    const acquire = f.client({ fetch: async (url, init) => {
      const result = await fetch(url, init);
      if (String(url).endsWith('/grants')) { mutations++; await result.text(); throw Error('connection lost after commit'); }
      return result;
    } });
    const result = await acquire(901, f.p.id);
    assert.equal(result.id, (await f.store.get(f.p.id))!.grant!.id);
    assert.equal(mutations, 1); assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});

test('a gateway error after commit also reconciles the new SQL grant', async () => {
  const f = await fixture();
  try {
    const acquire = f.client({ fetch: async (url, init) => {
      const result = await fetch(url, init);
      if (String(url).endsWith('/grants')) { await result.text(); return Response.json({ error: 'octo_control_unavailable' }, { status: 503 }); }
      return result;
    } });
    assert.equal((await acquire(901, f.p.id)).id, (await f.store.get(f.p.id))!.grant!.id);
    assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});

test('an unknown result stays uncertain without local fallback or automatic retry', async () => {
  const f = await fixture();
  try {
    let mutations = 0;
    const acquire = f.client({ fetch: async (url, init) => {
      if (String(url).endsWith('/grants')) { mutations++; throw Error('timeout'); }
      return fetch(url, init);
    } });
    await assert.rejects(acquire(901, f.p.id), { code: 'octo_control_uncertain' });
    assert.equal(mutations, 1); assert.equal(f.calls(), 0);
    assert.equal((await f.store.get(f.p.id))!.grant, undefined);
  } finally { await f.close(); }
});

test('redirects never receive a forwarded secret and transport details stay private', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    await assert.rejects(f.client({ fetch: async (_url, init) => {
      calls++; assert.equal(init?.redirect, 'error'); throw Error(`upstream ${secret}`);
    } })(901, f.p.id), { code: 'octo_control_unavailable' });
    assert.equal(calls, 1);
    assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});
