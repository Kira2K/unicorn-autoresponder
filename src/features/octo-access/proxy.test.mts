import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from './testing.mts';
import { createOctoService } from './service.mts';
import { provisionProfile } from './provision.mts';
import { advanceProxy } from './proxy-workflow.mts';
import { parseProxyInput } from './proxy-input.mts';
import { createCloudApi } from './cloud-api.mts';
import { OctoError } from './contracts.mts';
import type { SavedProxy } from './contracts.mts';
const input = { type: 'socks5' as const, host: 'proxy.example.com', port: 12345, login: 'test-user', password: 'test-secret' };
async function fixture() {
  const store = createMemoryStore(), cloud = createMockCloud(store), proxies: SavedProxy[] = [];
  const service = createOctoService({ store, config: testConfig, getClient: async id => mockClient(id) });
  await service.ensure(901, true);
  await provisionProfile((await store.list())[0], { store, api: cloud.api, config: testConfig, check: async () => {} });
  let creates = 0, attaches = 0, lose: 'create' | 'attach' | undefined;
  cloud.api.proxyConnections = async externalId => structuredClone(proxies.filter(p => p.externalId === externalId));
  cloud.api.createProxy = async data => {
    const p = { ...data, uuid: `proxy-${++creates}`, profiles_count: 0 }; proxies.push(p);
    if (lose === 'create') throw new OctoError('octo_request_outcome_unknown');
    return structuredClone(p);
  };
  cloud.api.attachProxy = async (uuid, proxyUuid) => {
    attaches++; cloud.profiles.get(uuid)!.proxy = { uuid: proxyUuid }; proxies.find(p => p.uuid === proxyUuid)!.profiles_count = 1;
    if (lose === 'attach') throw new OctoError('octo_request_outcome_unknown');
  };
  const id = (await store.list())[0].id;
  return { store, cloud, service, proxies, id, counts: () => ({ creates, attaches }), lose: (step?: 'create' | 'attach') => { lose = step; },
    advance: async () => advanceProxy((await store.get(id))!, { store, api: cloud.api, config: testConfig, check: async () => {} }) };
}
test('proxy input preserves credentials and maps existing protocols, rejects invalid connection/rotation URLs', () => {
  assert.deepEqual(parseProxyInput(input), input);
  for (const invalid of [{ ...input, port: 65536 }, { ...input, host: 'bad@host' }, { ...input, changeIpUrl: 'file:///secret' }, { ...input, password: 'bad\nsecret' }])
    assert.throws(() => parseProxyInput(invalid), { code: 'octo_proxy_input_invalid' });
  assert.equal(parseProxyInput({ ...input, password: ' spaced ' }).password, ' spaced ');
});
test('own proxy is created and attached once; status never exposes login/password and grants wait for completion', async () => {
  const f = await fixture();
  await f.service.saveProxy(901, f.id, input); await f.service.saveProxy(901, f.id, input);
  await assert.rejects(f.service.acquire(901, f.id), { code: 'octo_proxy_pending' });
  const pending = JSON.stringify(await f.service.status(901));
  assert.ok(!pending.includes(input.password)); assert.ok(!pending.includes(input.login));
  await f.advance(); await f.advance();
  assert.deepEqual(f.counts(), { creates: 1, attaches: 1 });
  const p = (await f.store.get(f.id))!;
  assert.equal(p.proxyChange?.phase, 'complete'); assert.equal(p.proxyChange?.input, undefined);
  assert.equal((await f.service.status(901)).profiles[0].proxy.configured, true);
  await f.service.acquire(901, f.id);
  await assert.rejects(f.service.saveProxy(901, f.id, input), { code: 'octo_profile_not_idle' });
});
test('proxy ownership and blocked phase protect other users and running/shared profiles', async () => {
  const f = await fixture();
  await assert.rejects(f.service.saveProxy(902, f.id, input), { code: 'not_found' });
  await assert.rejects(f.service.saveProxy(903, f.id, input), { code: 'forbidden' });
  await f.service.saveProxy(901, f.id, input);
  f.cloud.profiles.get((await f.store.get(f.id))!.uuid!)!.status = 1;
  await f.advance(); assert.deepEqual(f.counts(), { creates: 0, attaches: 0 });
  assert.equal((await f.store.get(f.id))!.proxyChange!.phase, 'blocked');
});
test('lost create/attach acknowledgement reconciles exact marker without duplicate writes', async () => {
  for (const step of ['create', 'attach'] as const) {
    const f = await fixture(); await f.service.saveProxy(901, f.id, input); f.lose(step);
    await f.advance(); assert.equal((await f.store.get(f.id))!.proxyChange!.phase, 'blocked');
    f.lose(); await f.advance();
    assert.equal((await f.store.get(f.id))!.proxyChange!.phase, 'complete');
    assert.deepEqual(f.counts(), { creates: 1, attaches: 1 });
  }
});
test('cloud proxy adapter maps socks4, preserves external operation ID, attaches by UUID without desktop requests', async () => {
  const calls: any[] = []; let row: any;
  const api = createCloudApi('test-token', async (url, options) => {
    assert.ok(String(url).startsWith('https://app.octobrowser.net/'));
    const body = options?.body && JSON.parse(String(options.body)); calls.push({ url: String(url), body });
    if (options?.method === 'POST') { row = { ...body, uuid: 'proxy', profiles_count: 0 }; return Response.json({ success: true, data: row }); }
    return Response.json({ success: true, data: options?.method === 'PATCH' ? '' : [row, { type: 'ssh', external_id: 'unrelated' }] });
  });
  await api.createProxy({ ...input, type: 'socks4', title: 'fixture', externalId: 'operation' });
  assert.equal(calls[0].body.type, 'socks');
  assert.equal((await api.proxyConnections('operation'))[0].type, 'socks4');
  await api.attachProxy('profile', 'proxy'); assert.deepEqual(calls[2].body, { proxy: 'proxy' });
});
