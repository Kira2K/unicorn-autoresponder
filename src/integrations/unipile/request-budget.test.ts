const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createUnipileRequestBudget, readRateLimitHeaders } = require('./request-budget.ts') as typeof import('./request-budget.ts')
const { createUnipileHttpClient } = require('./http-client.ts') as any

async function run() {
  let now = Date.now(), calls = 0
  const budget = createUnipileRequestBudget(() => now)
  const base = 'https://unipile.test/v2'
  const options = { apiKey: 'secret', baseUrl: base, requestBudget: budget,
    fetchImpl: async () => { calls++; return new Response('{}', { status: 200, headers: {
      'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '74730'
    } }) } }
  const invitations = createUnipileHttpClient(options), comments = createUnipileHttpClient(options)
  await invitations.request('GET', '/acc_a/users/me/relation-requests')
  await assert.rejects(comments.request('GET', '/acc_a/users/me/relation-requests?offset=50'),
    (e: any) => e.details.requestSent === 0 && e.details.retryAfterMs > 74_000_000)
  assert.equal(calls, 1, 'A withdrawal client must share the exhausted pending-list limit.')
  await assert.rejects(invitations.request('POST', '/acc_a/users/me/relation-requests', {},
    { requiredReads: ['/acc_a/users/me/relation-requests'] }), (e: any) => e.details.requestSent === 0)
  await comments.request('GET', '/acc_a/posts'); assert.equal(calls, 2)
  await comments.request('GET', '/acc_b/posts'); assert.equal(calls, 3)
  await comments.request('GET', '/accounts/acc_a'); assert.equal(calls, 4)
  now += 74_731_000
  await comments.request('GET', '/acc_a/posts'); assert.equal(calls, 5)

  const b = createUnipileRequestBudget(() => now)
  b.observe(base, '/acc_c/users/me', 429, { retryAfterMs: 74_730_000 })
  b.observe(base, '/acc_c/users/me', 200, { rateLimitRemaining: 100 })
  assert.equal(b.before(base, '/acc_c/users/someone')?.retryAfterMs, 74_730_000,
    'Concurrent/cache success must not clear a cooldown.')
  assert.equal(b.before('https://other.test/v2', '/acc_c/posts'), undefined)
  const details = readRateLimitHeaders(new Response('{}', { status: 429, headers: {
    'retry-after': '74730', 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': '74730', 'set-cookie': 'secret'
  } }), now)
  assert.equal(details.retryAfterMs, 74_730_000)
  assert.equal(details.retryAfterSeconds, 74730)
  assert.equal(details.rateLimitResetAt, now + 74_730_000)
  assert.ok(!JSON.stringify(details).includes('secret'))
  assert.deepEqual(readRateLimitHeaders(new Response('{}')), {})
  assert.deepEqual(readRateLimitHeaders(new Response('{}', { headers: {
    'retry-after': 'nonsense', 'x-ratelimit-remaining': '-1', 'x-ratelimit-reset': 'NaN'
  } })), {})
}
run().then(() => console.log('Unipile shared request budget tests passed'))
  .catch(error => { console.error(error); process.exitCode = 1 })
