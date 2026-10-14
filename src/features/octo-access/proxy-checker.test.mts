import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxyChecker, OCTO_PROXY_CANDIDATE_COUNT } from './proxy-checker.mts';
import { readFile } from 'node:fs/promises';
import { OctoError } from './contracts.mts';

const winner = { index: 1, proxy: 'masked', proxy_url: 'socks5://user:password@proxy.example:1080',
  ok: true, final_score: 69, country: 'Georgia', city: 'Tbilisi', location_matches: true };
const envelope = (extra = {}) => ({ check_id: 'check-1', created_at: '2026-10-14T00:00:00Z', status: 'completed', ...extra });
const checker = (data: unknown, status = 200) => createProxyChecker({ baseUrl: 'https://checker.example/', secret: 'service-secret',
  fetch: (async () => new Response(JSON.stringify(data), { status })) as typeof fetch });
const safeError = (code: string) => (error: unknown) => {
  assert.ok(error instanceof OctoError);
  assert.equal(error.code, code);
  assert.doesNotMatch(JSON.stringify(error) + error.message, /service-secret|provider-key|password|raw-provider/);
  return true;
};

test('best uses the refreshed default of 20 residential IPv4 sticky SOCKS5 candidates', async () => {
  const spec = JSON.parse(await readFile(new URL('./checker-contract/openapi.json', import.meta.url), 'utf8'));
  const count = spec.components.schemas.BestProxyInput.properties.count;
  assert.equal(OCTO_PROXY_CANDIDATE_COUNT, count.default);
  assert.equal(count.maximum, 100);
  let calls = 0;
  const adapter = createProxyChecker({ baseUrl: 'https://checker.example/', secret: 'service-secret',
    fetch: (async (url, init) => {
      calls++;
      assert.equal(url, 'https://checker.example/v1/proxies/best');
      assert.equal(init?.method, 'POST');
      assert.ok(init?.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(String(init?.body)), { unicorn_proxy_checker_secret_key: 'service-secret', api_key: 'provider-key',
        count: 20, location: { country: 'ge', region: 'tbilisi', city: 'tbilisi', protocol: 'socks5',
          connection_type: 'residential', session_mode: 'sticky', filter_mode: 'quality', ipv4_only: true } });
      return new Response(JSON.stringify(envelope({ best_proxy: winner })));
    }) as typeof fetch });
  assert.deepEqual(await adapter.best('provider-key', { country: 'ge', region: 'tbilisi', city: 'tbilisi' }), winner);
  assert.equal(calls, 1);
});

test('check returns the actual single result, and accepts score 69 without imposing a threshold', async () => {
  const result = { ...winner, location_matches: null };
  assert.deepEqual(await checker(envelope({ results: [result] })).check(winner.proxy_url), result);
});

test('best never accepts a check results array as a winner', async () => {
  await assert.rejects(checker(envelope({ results: [winner] })).best('provider-key', { country: 'ge' }), safeError('octo_proxy_check_invalid_response'));
});

test('best sends exact catalogue codes including slash, Unicode and apostrophe without substitution', async () => {
  let sent: any;
  const adapter = createProxyChecker({ baseUrl: 'https://checker.example', secret: 'service-secret',
    fetch: (async (_url, init) => { sent = JSON.parse(String(init?.body)); return Response.json(envelope({ best_proxy: winner })); }) as typeof fetch });
  const location = { country: 'es', region: "région_d'été", city: 'donostia_/_san_sebastian' };
  await adapter.best('provider-key', location);
  assert.equal(sent.location.region, location.region); assert.equal(sent.location.city, location.city);
});

test('completed results require exact single-result shape and usable scores and URL', async () => {
  for (const result of [{ ...winner, final_score: null }, { ...winner, final_score: 101 }, { ...winner, final_score: -1 },
    { ...winner, final_score: '69' }, { ...winner, proxy_url: '' }, { ...winner, index: '1' }, { ...winner, captcha: 'bad' }]) {
    await assert.rejects(checker(envelope({ results: [result] })).check(winner.proxy_url), safeError('octo_proxy_check_invalid_response'));
  }
  for (const results of [[], [winner, winner], null])
    await assert.rejects(checker(envelope({ results })).check(winner.proxy_url), safeError('octo_proxy_check_invalid_response'));
});

test('best requires the checker service to confirm country and requested city', async () => {
  for (const result of [{ ...winner, location_matches: false }, { ...winner, location_matches: null },
    { ...winner, country: null }, { ...winner, city: null }]) {
    await assert.rejects(checker(envelope({ best_proxy: result })).best('provider-key', { country: 'ge', city: 'tbilisi' }),
      safeError('octo_proxy_location_unverified'));
  }
  assert.ok(await checker(envelope({ best_proxy: { ...winner, city: null } })).best('provider-key', { country: 'ge' }));
});

test('unfinished checks, no winner, response errors and failed proxies are safe failures', async () => {
  for (const body of [envelope({ status: 'running', results: [winner] }), envelope({ error: { code: 'raw-provider', message: winner.proxy_url }, results: [winner] }),
    envelope({ results: [{ ...winner, ok: false, error: { code: 'raw-provider', message: winner.proxy_url } }] })])
    await assert.rejects(checker(body).check(winner.proxy_url), safeError('octo_proxy_check_failed'));
  await assert.rejects(checker(envelope({ best_proxy: null, error: { code: 'no_location_match', message: winner.proxy_url } }))
    .best('provider-key', { country: 'ge' }), safeError('octo_proxy_check_failed'));
});

test('HTTP and non-JSON errors never propagate raw provider text or secrets', async () => {
  await assert.rejects(checker({ detail: { code: 'raw-provider', message: winner.proxy_url } }, 502).check(winner.proxy_url), safeError('octo_proxy_check_rejected'));
  await assert.rejects(createProxyChecker({ baseUrl: 'https://checker.example', secret: 'service-secret',
    fetch: (async () => new Response('raw-provider ' + winner.proxy_url)) as typeof fetch }).check(winner.proxy_url), safeError('octo_proxy_check_invalid_response'));
});

test('network failures and timeout have unknown outcomes and never retry', async () => {
  let calls = 0;
  const original = AbortSignal.timeout;
  try {
    AbortSignal.timeout = (milliseconds: number) => {
      assert.equal(milliseconds, 900_000);
      return AbortSignal.abort();
    };
    const adapter = createProxyChecker({ baseUrl: 'https://checker.example', secret: 'service-secret', fetch: (async (_url, init) => {
      calls++;
      assert.equal(init?.signal?.aborted, true);
      throw new Error('raw-provider service-secret ' + winner.proxy_url);
    }) as typeof fetch });
    await assert.rejects(adapter.check(winner.proxy_url), safeError('octo_proxy_check_unknown'));
    assert.equal(calls, 1);
  } finally { AbortSignal.timeout = original; }
});

test('a network interruption while reading response JSON has an unknown outcome', async () => {
  const response = new Response();
  response.json = async () => { throw new TypeError('raw-provider password'); };
  const adapter = createProxyChecker({ baseUrl: 'https://checker.example', secret: 'service-secret',
    fetch: (async () => response) as typeof fetch });
  await assert.rejects(adapter.check(winner.proxy_url), safeError('octo_proxy_check_unknown'));
});
