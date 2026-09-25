const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createUnipileHttpClient } = require('./http-client.ts') as any

test('optional observer sees safe headers without changing requests or response values', async () => {
  const inputs: any[] = []; const observed: any[] = []
  const client = createUnipileHttpClient({ apiKey: 'test-key', baseUrl: 'https://unipile.invalid',
    fetchImpl: async (_url: string, init: any) => {
      inputs.push(init)
      return new Response('{"id":"request"}', { status: 201,
        headers: { 'X-Cache': 'HIT', Age: '25', 'Set-Cookie': 'PRIVATE' } })
    } })
  const normal = await client.request('POST', '/test', { user_id: 'test' })
  const monitored = await client.request('POST', '/test', { user_id: 'test' },
    { onResponse(metadata: unknown) { observed.push(metadata) } })
  assert.deepEqual(monitored, normal)
  assert.deepEqual(observed, [{ httpStatus: 201, providerCache: 'HIT', providerCacheAgeSeconds: 25 }])
  for (const key of ['method', 'headers', 'body']) assert.deepEqual(inputs[0][key], inputs[1][key])
  assert.equal(inputs.length, 2)
})

test('sync and async observer failures do not retry POST or change success/errors', async () => {
  for (const observer of [() => { throw new Error('logging failure') },
    async () => { throw new Error('async logging failure') }]) {
    for (const status of [201, 429]) {
      let requests = 0
      const client = createUnipileHttpClient({ apiKey: 'test-key', fetchImpl: async () => {
        requests++
        return new Response('{}', { status, headers: { 'Retry-After': '600' } })
      } })
      const action = client.request('POST', '/test', {}, { onResponse: observer, fullRetryAfter: true })
      if (status === 201) assert.deepEqual(await action, {})
      else await assert.rejects(action, (error: any) => error.details.retryAfterMs === 600_000)
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(requests, 1)
    }
  }
})

test('untrusted cache headers and invalid Age are not exposed', async () => {
  let observed: any
  const client = createUnipileHttpClient({ apiKey: 'test-key', fetchImpl: async () =>
    new Response('{}', { headers: { 'X-Cache': 'PRIVATE HEADER', Age: '-1' } }) })
  await client.request('GET', '/test', undefined, { noCache: true, onResponse(value: unknown) { observed = value } })
  assert.deepEqual(observed, { httpStatus: 200, providerCache: 'UNKNOWN' })
})
