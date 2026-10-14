import test from 'node:test';
import assert from 'node:assert/strict';
import { createDolphinProxySource } from './dolphin-proxy-source.mts';

const profile = { id: 10, proxy: { type: 'SOCKS5:', server: 'proxy.example', port: '1080', username: 'private-login', password: 'private-password' } };

test('lists only owned DB profile IDs and exposes no credentials', async () => {
  const reads: number[] = [], owners: number[] = [];
  const source = createDolphinProxySource({ profiles: async id => { owners.push(id); return [{ id: 10, locale: 'en' }, { id: 11, locale: 'ru' }]; },
    readProfile: async id => { reads.push(id); return id === 10 ? profile : { id, proxy: null }; } });
  const result = await source.list(5);
  assert.deepEqual(owners, [5]); assert.deepEqual(reads.sort(), [10, 11]);
  assert.deepEqual(result, [{ id: 10, locale: 'en', hasProxy: true }, { id: 11, locale: 'ru', hasProxy: false }]);
  assert.doesNotMatch(JSON.stringify(result), /private|proxy.example|1080/);
});

test('list caches cloud reads for 30 seconds while always refreshing ownership', async () => {
  let clock = 0, cloudReads = 0, dbReads = 0, owned = [{ id: 10, locale: 'en' }];
  const source = createDolphinProxySource({ now: () => clock, profiles: async () => { dbReads++; return owned; },
    readProfile: async () => { cloudReads++; return profile; } });
  await source.list(5); clock = 29_999; await source.list(5);
  assert.equal(cloudReads, 1); assert.equal(dbReads, 2);
  clock = 30_000; await source.list(5); assert.equal(cloudReads, 2);
  owned = []; assert.deepEqual(await source.list(5), []); assert.equal(cloudReads, 2);
});

test('simultaneous list polls share a cloud read without suppressing failures', async () => {
  let release!: () => void, reads = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const source = createDolphinProxySource({ profiles: async () => [{ id: 10, locale: 'en' }],
    readProfile: async () => { reads++; await pending; return profile; } });
  const first = source.list(5), second = source.list(5);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1);
  release(); assert.deepEqual(await first, await second);
});

test('proxy import reads fresh credentials and preserves normalized original protocol', async () => {
  let reads = 0;
  const source = createDolphinProxySource({ profiles: async () => [{ id: 10, locale: 'en' }], readProfile: async () => {
    reads++; return { proxy: { ...profile.proxy, type: reads === 1 ? 'socks5' : 'HTTPS:', password: reads === 1 ? 'old' : 'new:pass' } };
  } });
  await source.list(5);
  assert.deepEqual(await source.proxy(10), { type: 'https', host: 'proxy.example', port: 1080, login: 'private-login', password: 'new:pass' });
  assert.equal(reads, 2);
});

test('no profiles defers cloud access, and API failures never become an absent proxy or empty list', async () => {
  let reads = 0;
  const source = createDolphinProxySource({ profiles: async () => [], readProfile: async () => { reads++; throw new Error('private-password'); } });
  assert.deepEqual(await source.list(5), []); assert.equal(reads, 0);
  await assert.rejects(source.proxy(10), { code: 'octo_dolphin_read_failed' });
  const failed = createDolphinProxySource({ profiles: async () => [{ id: 10, locale: 'en' }], readProfile: async () => { throw new Error('private-password'); } });
  for (let i = 0; i < 2; i++) await assert.rejects(failed.list(5),
    (error: any) => error.code === 'octo_dolphin_read_failed' && !JSON.stringify(error).includes('private-password'));
});

test('malformed cloud data and unresolved attached proxies fail safely', async () => {
  for (const data of [null, [], {}, { ...profile, id: 11 }, { proxyId: 5 }, { proxy: { id: 5 } }, { proxy: { type: 'ftp', host: 'proxy.example', port: 1080 } }]) {
    const source = createDolphinProxySource({ profiles: async () => [{ id: 10, locale: 'en' }], readProfile: async () => data });
    await assert.rejects(source.proxy(10), (error: any) => /^octo_dolphin_(profile|proxy)_invalid$/.test(error.code));
  }
  assert.equal(await createDolphinProxySource({ profiles: async () => [], readProfile: async () => ({ id: 10, proxy: null }) }).proxy(10), undefined);
});

test('ownership query failures and invalid IDs are sanitized before cloud reads', async () => {
  let reads = 0;
  const source = createDolphinProxySource({ profiles: async () => { throw new Error('private-password'); }, readProfile: async () => { reads++; return profile; } });
  await assert.rejects(source.list(5), (error: any) => error.code === 'octo_dolphin_profiles_failed' && !error.message.includes('private'));
  await assert.rejects(source.proxy(-1), { code: 'octo_dolphin_profile_invalid' });
  assert.equal(reads, 0);
});
