import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { getDolphinProfileWithProxy, getDolphinProfileWithProxyLastCheck } = createRequire(import.meta.url)('./profile-proxy.ts');

for (const read of [getDolphinProfileWithProxy, getDolphinProfileWithProxyLastCheck]) {
  test(`${read.name}: absent proxy IDs never query the saved proxy list`, async () => {
    for (const proxyId of [undefined, null, '', 0, '0']) {
      const profile = { id: 7, proxyId, proxy: null };
      assert.equal(await read(7, { getProfile: async () => profile,
        request: async () => assert.fail('No proxy is attached; do not query /proxy') }), profile);
    }
  });

  test(`${read.name}: saved proxy lookup uses the array filter and the matching ID only`, async () => {
    const profile = { id: 7, proxyId: 91, proxy: { id: 91 } };
    const proxy = { id: 91, type: 'socks5', host: 'proxy.test', port: 1080 };
    const calls: unknown[] = [];
    const loaded = await read(7, { getProfile: async () => profile, request: async (path: string, options: unknown) => {
      calls.push({ path, options });
      return { data: [{ ...proxy, id: 92, host: 'other.test' }, proxy] };
    } });
    assert.deepEqual(calls, [{ path: '/proxy', options: { query: { 'ids[]': '91' } } }]);
    assert.deepEqual(loaded.proxy, proxy);
    const failure = new Error('provider unavailable');
    await assert.rejects(read(7, { getProfile: async () => profile, request: async () => { throw failure; } }), failure);
  });
}
