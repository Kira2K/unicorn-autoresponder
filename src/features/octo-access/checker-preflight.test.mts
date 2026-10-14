import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProxyCheckerConnection } from './checker-preflight.mts';

const env = { RENDER: 'true', PROXY_CHECKER_BASE_URL: 'http://checker-private:10000/', UNICORN_PROXY_CHECKER_SECRET_KEY: 'private-secret' };

test('Render preflight uses backend environment and verifies auth without a usable proxy or provider key', async () => {
  const calls: string[] = [];
  const result = await checkProxyCheckerConnection(env, async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    if (calls.length === 1) { assert.equal(init?.body, undefined); return Response.json({ status: 'ok' }); }
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { unicorn_proxy_checker_secret_key: 'private-secret', proxy: 'socks5://' });
    return Response.json({ detail: { code: 'invalid_proxy' } }, { status: 422 });
  });
  assert.deepEqual(calls, ['http://checker-private:10000/health', 'http://checker-private:10000/v1/proxies/check']);
  assert.deepEqual(result, { reachable: true, secretAccepted: true, proxyChecksStarted: 0 });
});

test('missing or malformed connection settings fail before any network call', async () => {
  for (const patch of [{ PROXY_CHECKER_BASE_URL: '' }, { UNICORN_PROXY_CHECKER_SECRET_KEY: '' },
    { PROXY_CHECKER_BASE_URL: 'checker-private:10000' }, { PROXY_CHECKER_BASE_URL: 'ftp://checker-private' },
    { PROXY_CHECKER_BASE_URL: 'http://user:secret@checker-private' }, { PROXY_CHECKER_BASE_URL: 'http://checker-private?key=secret' }]) {
    await assert.rejects(checkProxyCheckerConnection({ ...env, ...patch }, async () => { assert.fail('Unexpected request'); }),
      { code: 'octo_checker_configuration_required' });
  }
});

test('unhealthy or unrelated service is not given the secret', async () => {
  for (const response of [new Response('offline', { status: 503 }), new Response('not json'), Response.json({ status: 'other' })]) {
    let calls = 0;
    await assert.rejects(checkProxyCheckerConnection(env, async () => { calls++; return response; }), { code: 'octo_checker_unavailable' });
    assert.equal(calls, 1);
  }
});

test('auth failures and unexpected API contracts are reported without response secrets', async () => {
  for (const [status, code] of [[401, 'octo_checker_unauthorized'], [503, 'octo_checker_not_configured'],
    [422, 'octo_checker_preflight_unexpected_response'], [200, 'octo_checker_preflight_unexpected_response']] as const) {
    let calls = 0;
    await assert.rejects(checkProxyCheckerConnection(env, async () => ++calls === 1 ? Response.json({ status: 'ok' })
      : Response.json({ detail: { code: 'private-secret' } }, { status })), error => {
      assert.equal((error as any).code, code); assert.doesNotMatch(String(error), /private-secret/); return true;
    });
    assert.equal(calls, 2);
  }
});

test('transport failures are sanitized and never retried', async () => {
  let calls = 0;
  await assert.rejects(checkProxyCheckerConnection(env, async () => { calls++; throw Error('private-secret internal-host'); }),
    { code: 'octo_checker_unavailable', message: 'octo_checker_unavailable' });
  assert.equal(calls, 1);
});
