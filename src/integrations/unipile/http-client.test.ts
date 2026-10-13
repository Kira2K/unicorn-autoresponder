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
    (error: any) => error.details.retryAfterMs === 600_000 &&
      error.details.retryAt === error.details.observedAt + 600_000)
  await assert.rejects(limited.request('GET', '/catalog', undefined, { fullRetryAfter: true }),
    (error: any) => error.details.retryAfterMs === 600_000)

  const inviter = createUnipileHttpClient({ apiKey: 'test-key',
    retryAfterCapMs: Number.POSITIVE_INFINITY,
    fetchImpl: async () => new Response('{}', { status: 429, headers: { 'Retry-After': '600' } }) })
  await assert.rejects(inviter.request('GET', '/catalog'),
    (error: any) => error.details.retryAfterMs === 600_000)

  for (const status of [500, 502, 503, 504]) {
    for (const header of [undefined, 'broken', '0', '60', '7200']) {
      let sent = 0
      const unavailable = createUnipileHttpClient({ apiKey: 'test-key', fetchImpl: async () => {
        sent++
        return new Response(JSON.stringify({ type: 'api/internal_error', req_id: 'Remote-AbC_42',
          detail: 'password=PRIVATE https://private.invalid/user@example.test' }), {
          status, headers: header === undefined ? {} : { 'Retry-After': header } })
      } })
      const providerWait = header !== undefined && /^\d+$/.test(header)
      await assert.rejects(unavailable.request('POST', '/account/posts', { text: 'private draft' }), (error: any) => {
        assert.equal(error.details.retryAfterMs, providerWait ? Number(header) * 1000 : 300_000)
        assert.equal(error.details.retryAt, error.details.observedAt + error.details.retryAfterMs)
        assert.equal(error.details.retryAfterSource, providerWait ? 'provider' : 'fallback')
        assert.equal(error.details.requestId, 'Remote-AbC_42')
        assert.equal(error.details.errorType, 'api/internal_error')
        assert.doesNotMatch(JSON.stringify(error.details), /PRIVATE|private\.invalid|example\.test|private draft/)
        assert.notEqual(error.notSent, true, 'HTTP 500 after POST does not prove that it was not sent')
        return true
      })
      assert.equal(sent, 1, 'the HTTP client must not retry a POST')
    }
  }
  const invalidId = createUnipileHttpClient({ apiKey: 'test-key', fetchImpl: async () =>
    new Response(JSON.stringify({ req_id: 'Bearer PRIVATE\nextra', type: 'api/internal_error' }), { status: 500 }) })
  await assert.rejects(invalidId.request('GET', '/account/posts'), (error: any) => {
    assert.equal(error.details.requestId, undefined); return true
  })
  const explanation = 'Could not parse LinkedIn response: expected elements but received null.'
  for (const multipart of [false, true]) {
    const draft = 'Private draft with special chars "\\\nПривет"'
    const body: any = multipart ? new FormData() : { text: draft }
    if (multipart) body.set('text', draft)
    const client = createUnipileHttpClient({ apiKey: 'opaque-client-secret', fetchImpl: async () => new Response(JSON.stringify({
      type: 'api/internal_error', req_id: 'Request-AbC-123',
      title: 'Failure for ' + draft, message: 'API-Key: opaque-client-secret',
      detail: explanation + '\nAPI-Key: opaque-client-secret\nAuthorization: Bearer OTHERSECRET\n' +
        'Cookie: li_at=COOKIESECRET; other=COOKIETWO\npassword="space secret" email=user@private.test\n' +
        'url=https://user:pass@private.test/path?key=URLSECRET\n' + draft + '\n' + JSON.stringify(draft) +
        '\nopaque-client-secret\naccount=acc_PRIVATE_ID; cursor=CURSOR_SECRET',
      body: { private: 'MUST_NOT_BE_LOGGED' }
    }), { status: 500 }) })
    await assert.rejects(client.request('POST', '/acc_PRIVATE_ID/posts?limit=100&cursor=CURSOR_SECRET&token=QUERY_SECRET', body), (e: any) => {
      assert.ok(e.details.providerDetail.startsWith(explanation))
      assert.equal(e.details.providerTitle, 'Failure for [redacted]')
      assert.equal(e.details.providerMessage, '[redacted]')
      assert.match(e.details.providerDetail, /\[redacted\]/)
      assert.equal(e.details.requestPath, '/:id/posts?limit=100&cursor=present')
      assert.doesNotMatch(JSON.stringify(e.details), /opaque-client-secret|OTHERSECRET|COOKIESECRET|COOKIETWO|space secret|user@|private\.test|URLSECRET|Private draft|Привет|acc_PRIVATE_ID|CURSOR_SECRET|QUERY_SECRET|MUST_NOT_BE_LOGGED/)
      return true
    })
  }
  const { safeUnipileDiagnostics } = require('./error-diagnostics.ts') as typeof import('./error-diagnostics.ts')
  const titled = createUnipileHttpClient({ apiKey: 'private-key', fetchImpl: async () => new Response(JSON.stringify({
    object: 'Error', status: 500, type: 'api/internal_error', req_id: 'Title-AbC',
    title: 'Connector failed: private-key', message: 'Expected a collection.', detail: null,
    extra: { password: 'PRIVATE_OBJECT' }
  }), { status: 500 }) })
  await assert.rejects(titled.request('GET', '/account/users/me/posts'), (e: any) => {
    assert.equal(e.details.providerTitle, 'Connector failed: [redacted]')
    assert.equal(e.details.providerMessage, 'Expected a collection.')
    assert.match(e.details.responseShape, /detail=null/)
    assert.match(e.details.responseShape, /other=1/)
    assert.doesNotMatch(JSON.stringify(e.details), /private-key|PRIVATE_OBJECT/)
    return true
  })
  for (const [data, kind] of [[{}, 'absent'], [{ detail: '' }, 'empty'], [{ detail: {} }, 'object'], [{ detail: [] }, 'array']]) {
    assert.match(safeUnipileDiagnostics(500, data).responseShape!, new RegExp(`detail=${kind}`))
  }
  const { safeUnipileResponseShape } = require('./error-diagnostics.ts') as typeof import('./error-diagnostics.ts')
  assert.equal(safeUnipileResponseShape('object; detail=string; other=1'), 'object; detail=string; other=1')
  assert.equal(safeUnipileResponseShape('object; password=PRIVATE'), undefined)
  assert.equal(safeUnipileResponseShape('object; detail=string\nCookie: PRIVATE'), undefined)
  const nonJson = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () =>
    new Response('<html>PRIVATE_BODY</html>', { status: 500 }) })
  await assert.rejects(nonJson.request('GET', '/account/posts'), (e: any) => {
    assert.equal(e.details.responseShape, 'non_json')
    assert.doesNotMatch(JSON.stringify(e.details), /PRIVATE_BODY/)
    return true
  })
  assert.equal(safeUnipileDiagnostics(500, { detail: { secret: 'PRIVATE' } }).providerDetail, undefined)
  assert.equal(safeUnipileDiagnostics(500, { detail: 'x'.repeat(10_000) }).providerDetail!.length <= 4_120, true)
  assert.doesNotMatch(safeUnipileDiagnostics(500, {
    detail: 'Provider failure: {"password":"JSON_SECRET","api_key":"JSON_KEY"}\n"Authorization":"Bearer OTHER_SECRET"'
  }).providerDetail!, /JSON_SECRET|JSON_KEY|OTHER_SECRET/)
}

run().then(() => console.log('unipile HTTP client tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
