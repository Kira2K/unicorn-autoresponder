import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeMavenCatalogue } from './nodemaven-locations.mts';

const row = (code: string) => ({ code, name: code });
function catalogue(pages: Record<string, unknown>) {
  const calls: URL[] = [];
  const adapter = createNodeMavenCatalogue({ fetch: (async (url, init) => {
    const request = new URL(String(url)); calls.push(request);
    assert.equal(request.origin, 'https://api.nodemaven.com');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'x-api-key provider-key');
    assert.equal(request.searchParams.get('limit'), '1000');
    assert.equal(request.searchParams.get('connection_type'), 'residential');
    assert.equal(request.searchParams.get('ipv4_only'), 'true');
    assert.ok(init?.signal instanceof AbortSignal);
    const level = request.pathname.split('/').at(-2)!;
    const data = pages[level];
    return new Response(JSON.stringify(data ?? { results: [] }));
  }) as typeof fetch });
  return { adapter, calls };
}

test('live catalogue paginates all countries and tolerates both optional availability fields', async () => {
  const offsets: string[] = [];
  const adapter = createNodeMavenCatalogue({ fetch: (async (url) => {
    const offset = new URL(String(url)).searchParams.get('offset')!;
    offsets.push(offset);
    return new Response(JSON.stringify({ results: offset === '0'
      ? Array.from({ length: 1000 }, (_, i) => row('c' + i))
      : [{ ...row('ge'), effective_availability: 'high' }, { ...row('es'), availability: 'medium' }, row('us')] }));
  }) as typeof fetch });
  const all = await adapter.list('provider-key', 'countries');
  assert.equal(all.length, 1003);
  assert.deepEqual(offsets, ['0', '1000']);
  assert.deepEqual(all.slice(-3), [{ ...row('ge'), availability: 'high' }, { ...row('es'), availability: 'medium' }, row('us')]);
});

test('location validation requires each hierarchy level that has provider entries', async () => {
  const { adapter, calls } = catalogue({ countries: { results: [row('ge')] }, regions: { results: [row('tbilisi_region')] }, cities: { results: [row('tbilisi')] } });
  await assert.rejects(adapter.validate('provider-key', { country: 'ge' }), { code: 'octo_proxy_region_required' });
  await assert.rejects(adapter.validate('provider-key', { country: 'ge', region: 'tbilisi_region' }), { code: 'octo_proxy_city_required' });
  assert.deepEqual(await adapter.validate('provider-key', { country: 'ge', region: 'tbilisi_region', city: 'tbilisi' }),
    { country: 'ge', region: 'tbilisi_region', city: 'tbilisi' });
  const cities = calls.find(u => u.pathname.includes('/cities/'))!;
  assert.equal(cities.searchParams.get('country__code'), 'ge');
  assert.equal(cities.searchParams.get('region__code'), 'tbilisi_region');
});

test('countries without regions still require an available country city, and empty hierarchy is valid', async () => {
  const { adapter, calls } = catalogue({ countries: { results: [row('ge')] }, cities: { results: [row('tbilisi')] } });
  await assert.rejects(adapter.validate('provider-key', { country: 'ge' }), { code: 'octo_proxy_city_required' });
  assert.deepEqual(await adapter.validate('provider-key', { country: 'ge', city: 'tbilisi' }), { country: 'ge', city: 'tbilisi' });
  assert.equal(calls.find(u => u.pathname.includes('/cities/'))!.searchParams.has('region__code'), false);
  assert.deepEqual(await catalogue({ countries: { results: [row('ge')] } }).adapter.validate('provider-key', { country: 'ge' }), { country: 'ge' });
});

test('unknown selections and missing country are rejected', async () => {
  const { adapter } = catalogue({ countries: { results: [row('ge')] }, regions: { results: [row('region')] }, cities: { results: [row('city')] } });
  for (const location of [{}, { country: 'xx' }, { country: 'ge', region: 'unknown' }, { country: 'ge', region: 'region', city: 'unknown' }])
    await assert.rejects(adapter.validate('provider-key', location as any), { code: 'octo_proxy_location_invalid' });
  await assert.rejects(catalogue({ countries: { results: [row('ge')] } }).adapter.validate('provider-key', { country: 'ge', region: 'unknown' }),
    { code: 'octo_proxy_location_invalid' });
});

test('a valid region without cities does not require city and rejects a provided unknown city', async () => {
  const { adapter } = catalogue({ countries: { results: [row('ge')] }, regions: { results: [row('region')] } });
  assert.deepEqual(await adapter.validate('provider-key', { country: 'ge', region: 'region' }), { country: 'ge', region: 'region' });
  await assert.rejects(adapter.validate('provider-key', { country: 'ge', region: 'region', city: 'unknown' }), { code: 'octo_proxy_location_invalid' });
});

test('catalogue errors and invalid data cannot be treated as empty lists', async () => {
  for (const body of [{ error: 'provider-key' }, { results: null }, { results: [{ code: 'ge' }] }, { results: [row('ge'), row('ge')] }]) {
    await assert.rejects(catalogue({ countries: body }).adapter.list('provider-key', 'countries'), { code: 'octo_proxy_catalogue_invalid_response' });
  }
  for (const mock of [async () => new Response('raw-provider provider-key', { status: 401 }),
    async () => new Response('raw-provider provider-key'), async () => { throw new Error('raw-provider provider-key'); }]) {
    await assert.rejects(createNodeMavenCatalogue({ fetch: mock as typeof fetch }).list('provider-key', 'countries'),
      (error: any) => error.code.startsWith('octo_proxy_catalogue_') && !JSON.stringify(error).includes('provider-key'));
  }
});

test('guard location level/key and query syntax; region and cities require country', async () => {
  const { adapter, calls } = catalogue({});
  for (const args of [['provider-key', '../bad'], ['', 'countries'], ['provider-key\r\nheader', 'countries'],
    ['provider-key', 'regions'], ['provider-key', 'cities'], ['provider-key', 'cities', 'ge\u0000']])
    await assert.rejects((adapter.list as any)(...args), { code: 'octo_proxy_location_invalid' });
  assert.equal(calls.length, 0);
});

test('provider city codes with Unicode, apostrophes and punctuation remain valid', async () => {
  const rows = [row("st._john's"), row('são_paulo'), row('donostia_/_san_sebastian')];
  const { adapter } = catalogue({ cities: { results: rows } });
  assert.deepEqual(await adapter.list('provider-key', 'cities', 'ca'), rows);
});

test('opaque catalogue codes are encoded without injecting query parameters', async () => {
  const region = "région/one&offset=1?#", city = 'donostia_/_san_sebastian';
  const { adapter, calls } = catalogue({ countries: { results: [row('es')] }, regions: { results: [row(region)] }, cities: { results: [row(city)] } });
  assert.deepEqual(await adapter.validate('provider-key', { country: 'es', region, city }), { country: 'es', region, city });
  const url = calls.at(-1)!;
  assert.equal(url.searchParams.get('region__code'), region);
  assert.deepEqual(url.searchParams.getAll('offset'), ['0']); assert.equal(url.hash, '');
  await assert.rejects(adapter.validate('provider-key', { country: 'es', region, city: city + '_unknown' }), { code: 'octo_proxy_location_invalid' });
});

test('catalogue timeout is 15 seconds and has no retry or static fallback', async () => {
  const original = AbortSignal.timeout;
  let calls = 0;
  try {
    AbortSignal.timeout = (ms: number) => { assert.equal(ms, 15_000); return AbortSignal.abort(); };
    const adapter = createNodeMavenCatalogue({ fetch: (async (_url, init) => {
      calls++;
      assert.equal(init?.signal?.aborted, true);
      throw new Error('provider-key');
    }) as typeof fetch });
    await assert.rejects(adapter.list('provider-key', 'countries'), { code: 'octo_proxy_catalogue_unavailable' });
    assert.equal(calls, 1);
  } finally { AbortSignal.timeout = original; }
});
