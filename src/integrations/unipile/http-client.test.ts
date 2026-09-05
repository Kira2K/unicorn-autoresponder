const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createUnipileHttpClient } = require('./http-client.ts') as any

async function run() {
  const calls: any[] = []
  const client = createUnipileHttpClient({ apiKey: 'test-key', baseUrl: 'https://unipile.test/v2',
    fetchImpl: async (_url: string, init: any) => {
      calls.push(init)
      return new Response('{}', { status: 200 })
    } })
  await client.request('GET', '/account/users/me')
  await client.request('GET', '/account/users/me', undefined, { noCache: true })
  assert.equal(calls[0].headers['Cache-Control'], undefined)
  assert.equal(calls[1].headers['Cache-Control'], 'no-cache')
  assert.equal(JSON.stringify(calls).includes('test-key'), true)

  const limited = createUnipileHttpClient({ apiKey: 'test-key',
    baseUrl: 'https://unipile.test/v2', fetchImpl: async () => new Response('{}', {
      status: 429, headers: { 'Retry-After': '600' }
    }) })
  await assert.rejects(limited.request('GET', '/catalog'),
    (error: any) => error.details.retryAfterMs === 120_000)
  await assert.rejects(limited.request('GET', '/catalog', undefined, { fullRetryAfter: true }),
    (error: any) => error.details.retryAfterMs === 600_000)

  const inviter = createUnipileHttpClient({ apiKey: 'test-key',
    retryAfterCapMs: Number.POSITIVE_INFINITY,
    fetchImpl: async () => new Response('{}', { status: 429, headers: { 'Retry-After': '600' } }) })
  await assert.rejects(inviter.request('GET', '/catalog'),
    (error: any) => error.details.retryAfterMs === 600_000)
}

run().then(() => console.log('unipile HTTP client tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
