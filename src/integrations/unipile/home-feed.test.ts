const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { test } = require('node:test') as typeof import('node:test')
const { createHomeFeedReader, FEED_QUERY_ID } = require('./home-feed.mts') as typeof import('./home-feed.mts')
const { createUnipileHttpClient } = require('./http-client.ts')

function raw(elements: unknown[], extra: Record<string, unknown> = {}) {
  return { object: 'LinkedInRawResponse', headers: {}, data: { data: {
    feedDashMainFeedByMainFeed: { elements, metadata: { paginationToken: 'page-token' }, ...extra }
  } } }
}
test('V2 home feed: first page omits token; next page uses raw count and token', async () => {
  const sent: any[] = []
  const read = createHomeFeedReader({ request: async (...args: any[]) => {
    sent.push(args); return raw([{ entityUrn: 'urn:li:activity:1' }, { entityUrn: 'urn:li:activity:1' }])
  } })
  const first = await read({ accountId: 'acc_test', count: 5 })
  assert.deepEqual(first.ids, ['urn:li:activity:1'])
  assert.deepEqual(first.next, { start: 2, token: 'page-token' })
  await read({ accountId: 'acc_test', count: 5, cursor: first.next })
  assert.equal(sent.length, 2)
  assert.equal(sent[0][0], 'POST')
  assert.equal(sent[0][1], '/acc_test/linkedin/')
  assert.deepEqual(sent[0][2], { method: 'GET', url: 'https://www.linkedin.com/voyager/api/graphql',
    bypass_url_encoding: true, query_params: { queryId: FEED_QUERY_ID, variables: '(start:0,count:5)' } })
  assert.equal(sent[1][2].query_params.variables, '(start:2,count:5,paginationToken:page-token)')
})

test('twenty cards by default, useful content retained; duplicate wrappers collapse to one activity', async () => {
  let body: any
  const cards = Array.from({ length: 20 }, (_, i) => ({ entityUrn: `urn:li:fsd_update:(urn:li:activity:${i},MAIN_FEED)`,
    commentary: { text: { text: `professional ${i}` } }, socialDetail: {
      socialPermissions: { canReact: true, canPostComments: false }, totalSocialActivityCounts: { liked: false, reacted: null } } }))
  cards[19].entityUrn = 'urn:li:fsd_update:(urn:li:activity:0,OTHER_CONTEXT)'
  const page = await createHomeFeedReader({ request: async (_method, _path, b) => { body = b; return raw(cards) } })({ accountId: 'acc_test' })
  assert.equal(body.query_params.variables, '(start:0,count:20)')
  assert.equal(page.rawCount, 20); assert.equal(page.cards!.length, 19); assert.equal(page.next!.start, 20)
  assert.equal(page.cards![1].text, 'professional 1'); assert.equal(page.cards![1].reacted, false)
  assert.equal(page.cards![1].canComment, false)
})

test('only the exact home-feed Raw GET is classified as a read; arbitrary Raw requests stay writes', () => {
  const { requestInfo } = require('./request-control.ts')
  const body = { method: 'GET', url: 'https://www.linkedin.com/voyager/api/graphql', bypass_url_encoding: true,
    query_params: { queryId: FEED_QUERY_ID, variables: '(start:0,count:20)' } }
  const read = requestInfo('POST', '/acc_test/linkedin/', body)
  assert.equal(read.write, false); assert.equal(read.stage, 'feed_read'); assert.equal(read.account, 'acc_test')
  for (const other of [{ ...body, method: 'POST' }, { ...body, url: 'https://www.linkedin.com/other' },
    { ...body, body: { mutation: true } }, { ...body, query_params: { ...body.query_params, variables: '(start:0,count:999)' } }]) {
    assert.equal(requestInfo('POST', '/acc_test/linkedin/', other).write, true)
  }
})
test('normalised feed references resolve only from included records', async () => {
  const payload: any = raw([])
  delete payload.data.data.feedDashMainFeedByMainFeed.elements
  payload.data.data.feedDashMainFeedByMainFeed['*elements'] = ['urn:li:activity:1']
  payload.data.included = [{ entityUrn: 'urn:li:activity:1', secret: 'not retained' }]
  const read = createHomeFeedReader({ request: async () => payload })
  assert.deepEqual((await read({ accountId: 'acc_test' })).ids, ['urn:li:activity:1'])
  payload.data.included = []
  await assert.rejects(read({ accountId: 'acc_test' }), { code: 'feed_reference_missing' })
})
test('explicit empty page ends, malformed and GraphQL-error replies do not', async () => {
  const cases: [unknown, string][] = [
    [{}, 'feed_response_invalid'],
    [raw([], { elements: null }), 'feed_response_invalid'],
    [{ object: 'LinkedInRawResponse', data: { errors: [{ message: 'SECRET' }] } }, 'feed_graphql_error'],
    [raw([{ entityUrn: 'urn:li:activity:1' }], { metadata: {} }), 'feed_pagination_missing'],
    [raw([{ text: 'missing id' }]), 'feed_item_invalid'],
    [raw([], { paging: { start: 99 } }), 'feed_offset_mismatch'],
  ]
  for (const [payload, code] of cases) {
    await assert.rejects(createHomeFeedReader({ request: async () => payload })({ accountId: 'acc_test' }),
      (error: any) => error.code === code && !JSON.stringify(error).includes('SECRET'))
  }
  assert.equal((await createHomeFeedReader({ request: async () => raw([]) })({ accountId: 'acc_test' })).next, undefined)
})
test('invalid inputs, account paths, query ids and aborted requests never reach transport', async () => {
  let calls = 0
  const read = createHomeFeedReader({ request: async () => { calls++; return raw([]) } })
  for (const input of [{ accountId: '../accounts' }, { accountId: 'acc_test', count: 0 },
    { accountId: 'acc_test', count: 101 }, { accountId: 'acc_test', count: 120 }, { accountId: 'acc_test', count: 30.5 }, { accountId: 'acc_test', queryId: 'mutation.other' },
    { accountId: 'acc_test', cursor: { start: 5, token: '' } }]) {
    await assert.rejects(read(input))
  }
  await assert.rejects(read({ accountId: 'acc_test', signal: AbortSignal.abort() }))
  assert.equal(calls, 0)
})

test('GraphQL diagnostics retain only status, known classification and bounded size error', async () => {
  const read = createHomeFeedReader({ request: async () => ({ object: 'LinkedInRawResponse', data: { errors: [
    { message: 'Too many elements requested (120)', extensions: { status: 400, classification: 'DataFetchingException' } },
    { message: 'SECRET', extensions: { status: 500, classification: 'SECRET' } }
  ] } }) })
  await assert.rejects(read({ accountId: 'acc_test' }), (e: any) => {
    assert.equal(e.code, 'feed_graphql_error')
    assert.equal(e.details.graphqlDiagnostic, 'errors=2; status=400; type=DataFetchingException; requested=120; status=500')
    assert.equal(e.details.httpStatus, undefined, 'GraphQL status must not masquerade as HTTP status')
    assert.ok(!JSON.stringify(e).includes('SECRET'))
    return true
  })
})

test('1–100 requested cards remain reads; short pages advance by actual count', async () => {
  const { requestInfo } = require('./request-control.ts')
  for (let count = 1; count <= 100; count++) {
    const read = createHomeFeedReader({ request: async (method, path, body: any) => {
      assert.equal(body.query_params.variables, `(start:0,count:${count})`)
      assert.equal(requestInfo(method, path, body).write, false)
      return raw(Array.from({ length: count === 100 ? 100 : Math.min(count, 20) }, (_, i) => ({ entityUrn: `urn:li:activity:${i}` })))
    } })
    const page = await read({ accountId: 'acc_test', count })
    assert.equal(page.rawCount, count === 100 ? 100 : Math.min(count, 20))
    assert.equal(page.next!.start, page.rawCount)
  }
})
test('pagination token cannot inject variables into the raw query', async () => {
  let body: any
  await createHomeFeedReader({ request: async (_m, _p, b) => { body = b; return raw([]) } })({
    accountId: 'acc_test', cursor: { start: 5, token: 'a),count:999,(x' }
  })
  assert.equal(body.query_params.variables, '(start:5,count:20,paginationToken:a%29%2Ccount%3A999%2C%28x)')
})
test('real HTTP client preserves full 429 deadline and never repeats the outer POST', async () => {
  let calls = 0
  const client = createUnipileHttpClient({ apiKey: 'test-only', fetchImpl: async () => {
    calls++; return new Response('{"type":"api/too_many_requests"}', { status: 429, headers: { 'Retry-After': '80000' } })
  } })
  await assert.rejects(createHomeFeedReader(client)({ accountId: 'acc_test' }),
    (error: any) => error.details.retryAfterMs === 80_000_000 && Number.isFinite(error.details.retryAt))
  assert.equal(calls, 1)
})

test('Stop reaches the installed request policy while the raw read is queued', async () => {
  const { installRequestPolicy, withRequestContext } = require('./request-control.ts')
  const stop = new AbortController()
  let calls = 0, checked = false
  const remove = installRequestPolicy({
    queue: async (_info: unknown, _ctx: unknown, prepare: () => Promise<void>, action: () => Promise<unknown>) => {
      stop.abort(); await prepare(); return action()
    },
    before: async (info: any, ctx: any) => {
      checked = true
      assert.equal(info.account, 'acc_test'); assert.equal(ctx.taskId, 'feed-test')
      assert.equal(ctx.signal, stop.signal); ctx.signal.throwIfAborted()
    },
    failed: async () => {}
  })
  try {
    const client = createUnipileHttpClient({ apiKey: 'test-only', fetchImpl: async () => { calls++; return new Response('{}') } })
    await assert.rejects(withRequestContext({ taskId: 'feed-test' }, () =>
      createHomeFeedReader(client)({ accountId: 'acc_test', signal: stop.signal })))
    assert.equal(checked, true); assert.equal(calls, 0)
  } finally { remove() }
})
