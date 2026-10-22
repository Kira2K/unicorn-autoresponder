import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredApp } from '../../web-console/backend/configured-app.mts';
import { openSqlConsole } from '../../web-console/backend/postgres/runtime.mts';
import { runtimeFixture } from '../../web-console/backend/postgres/runtime-fixture.mts';
import { createBridgeBroker } from './broker.mts';
import { bridgePath, bridgeRoutes } from './routes.mts';
import { createMemoryStore, createMockCloud, testConfig } from '../testing.mts';
import { createConsoleFixture } from '../console-fixture.mts';

test('Console E2E fixture uses the real protected bridge gateway and no external providers', async () => {
  const bridge = { id: 'test-pc', ownerEmail: 'owner@example.com', secret: 'x'.repeat(48) };
  const f = await createConsoleFixture(45_000, Date.now, bridge);
  try {
    assert.equal((await fetch(f.url + bridgePath + '/health')).status, 401);
    const response = await fetch(f.url + bridgePath + '/health', { headers: { authorization: `Bearer ${bridge.secret}` } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ready: true, bridgeId: bridge.id });
    assert.equal(f.cloud.calls.length, 0);
  } finally { await f.close(); }
});

test('retired local-fixture mode cannot silently open the application database', async () => {
  let opened = false;
  await assert.rejects(createConfiguredApp({ APP_DB: 'postgres', OCTO_LOCAL_CONSOLE: '1' }, async () => {
    opened = true; throw Error('must not open the application database');
  }), { code: 'octo_local_console_removed' });
  assert.equal(opened, false);
});

test('ordinary SQL Console mounts protected bridge routes without changing client authentication', async () => {
  const f = runtimeFixture(), runtime = await openSqlConsole(f.env, () => f.pool);
  const store = createMemoryStore(), cloud = createMockCloud(store);
  const bridge = { id: 'owner-pc', ownerEmail: 'owner@example.com', secret: 's'.repeat(48) };
  runtime.octoBridge = bridgeRoutes(createBridgeBroker({ store, api: cloud.api, config: testConfig,
    bridge, checkpoint: async () => 0 }), bridge);
  const configured = await createConfiguredApp(f.env, async () => runtime);
  const server = configured.app.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(url + bridgePath + '/health')).status, 401);
    const health = await fetch(url + bridgePath + '/health', { headers: { authorization: `Bearer ${bridge.secret}` } });
    assert.equal(health.status, 200); assert.deepEqual(await health.json(), { ready: true, bridgeId: bridge.id });
    assert.equal((await fetch(url + '/api/auth/me')).status, 401);
    assert.equal(cloud.calls.length, 0);
    assert.ok(!f.calls.some(sql => /INSERT|UPDATE|CREATE|ALTER/.test(sql)));
  } finally {
    await new Promise<void>(done => server.close(() => done())); await configured.closeStorage();
  }
});
