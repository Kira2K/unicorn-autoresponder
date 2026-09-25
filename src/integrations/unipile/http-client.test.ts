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
  const json = { specifics: { linkedin: { headline: 'Developer' } } }
  await client.request('PATCH', '/account/users/me', json)
  assert.equal(calls[2].headers['Content-Type'], 'application/json')
  assert.equal(calls[2].body, JSON.stringify(json))
  assert.equal(calls[0].body, undefined)
  const form = new FormData()
  form.set('text', 'Post')
  form.set('attachments[0]', new Blob(['image bytes'], { type: 'image/png' }), 'meme.png')
  await client.request('POST', '/account/posts', form)
  assert.equal(calls[3].body, form)
  assert.equal(calls[3].headers['Content-Type'], undefined)
  assert.equal(calls[3].headers['X-API-KEY'], 'test-key')
  await client.request('POST', '/account/posts/post/reactions', { reaction: 'linkedin_like' })
  assert.equal(calls[4].headers['Content-Type'], 'application/json')
  assert.equal(calls[4].body, JSON.stringify({ reaction: 'linkedin_like' }))

  for (const status of [200, 201, 202, 204]) {
    const custom = createUnipileHttpClient({ apiKey: 'test-key', fetchImpl: async () =>
      new Response(status === 204 ? null : '{}', { status }) })
    await custom.request('POST', '/unchanged-client')
    if (status === 200) await custom.request('POST', '/cancel', undefined, { expectedStatus: 200 })
    else await assert.rejects(custom.request('POST', '/cancel', undefined, { expectedStatus: 200 }),
      (error: any) => error.code === 'unipile_unexpected_status' && error.details.httpStatus === status)
  }

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
