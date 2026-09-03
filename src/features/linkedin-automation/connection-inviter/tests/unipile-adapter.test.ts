const assert = require('node:assert/strict')
const { createConnectionUnipileAdapter, invitationRequestId, pendingPersonId,
  parseConnectionPendingResponse, parseConnectionPeopleSearchResponse } =
  require('../unipile-adapter.ts') as typeof import('../unipile-adapter.ts')

const calls: any[] = []
const events: any[] = []
const adapter = createConnectionUnipileAdapter({
  http: { async request(method: string, path: string, body?: any) {
    calls.push({ method, path, body }); return { id: 'request-1' }
  } }, scheduler: { run(operation: any) { return operation() } },
  logger: { event(stage: string, status: string, details: any) {
    events.push({ stage, status, details })
  } }
})
async function run() {
  await adapter.getAccount('acc 1')
  await adapter.getOwnProfile('acc 1')
  await adapter.getProfile('acc 1', 'ACo_1')
  await adapter.resolveLocations('acc 1', 'Berlin')
  await adapter.searchPeople('acc 1', { keywords: 'Python Recruiter', locationId: 'geo-1' },
    'next cursor')
  await adapter.listRelations('acc 1', 'relations cursor')
  await adapter.listPendingInvitations('acc 1', 100)
  await adapter.listPendingInvitations('acc 1', 'pending cursor')
  await adapter.sendInvitation('acc 1', 'ACo_1')
  assert.deepEqual(calls[0], { method: 'GET', path: '/accounts/acc%201', body: undefined })
  assert.deepEqual(calls[1], { method: 'GET',
    path: '/acc%201/users/me?variant=linkedin_classic', body: undefined })
  assert.deepEqual(calls[2], { method: 'GET',
    path: '/acc%201/users/ACo_1?variant=linkedin_classic', body: undefined })
  assert.deepEqual(calls[3], { method: 'GET',
    path: '/acc%201/linkedin/search/parameters?type=LOCATION&keywords=Berlin&offset=0&limit=10',
    body: undefined })
  assert.deepEqual(calls[4], { method: 'POST',
    path: '/acc%201/linkedin/search/people?cursor=next+cursor',
    body: { keywords: 'Python Recruiter', location: ['geo-1'], network_distance: [2] } })
  assert.equal('advanced_keywords' in calls[4].body, false)
  assert.deepEqual(calls[5], { method: 'GET',
    path: '/acc%201/users/me/relations?cursor=relations+cursor', body: undefined })
  assert.deepEqual(calls[6], { method: 'GET',
    path: '/acc%201/users/me/relation-requests?type=sent&limit=100&offset=100', body: undefined })
  assert.deepEqual(calls[7], { method: 'GET',
    path: '/acc%201/users/me/relation-requests?type=sent&limit=100&cursor=pending+cursor',
    body: undefined })
  assert.deepEqual(calls[8], { method: 'POST', path: '/acc%201/users/me/relation-requests',
    body: { user_id: 'ACo_1' } })
  assert.equal('message' in calls[8].body, false)
  assert.equal(invitationRequestId({ data: { request_id: 'r' } }), 'r')
  assert.equal(pendingPersonId({ user: { provider_id: 'ACo' } }), 'ACo')
  assert.equal(events.filter(event => event.stage === 'unipile_request' &&
    event.status === 'succeeded').length, 9)
  assert.deepEqual(events.filter(event => event.status === 'succeeded')
    .map(event => event.details.httpStatus), [200, 200, 200, 200, 200, 200, 200, 200, 201])
  assert.equal(JSON.stringify(events).includes('acc 1'), false)
  assert.equal(JSON.stringify(events).includes('Python Recruiter Berlin'), false)
  assert.deepEqual(parseConnectionPeopleSearchResponse({ items: [{ id: 'one' }],
    next_cursor: 'next' }), { items: [{ id: 'one' }], nextCursor: 'next', responseShape: 'items' })
  assert.deepEqual(parseConnectionPeopleSearchResponse({ data: { items: [],
    next_cursor: 'nested' } }), { items: [], nextCursor: 'nested', responseShape: 'data.items' })
  assert.throws(() => parseConnectionPeopleSearchResponse({ results: [] }),
    (error: any) => error.code === 'connection_search_response_invalid')
  assert.deepEqual(parseConnectionPendingResponse({ items: [] }),
    { items: [], responseShape: 'items' })
  assert.deepEqual(parseConnectionPendingResponse({ data: { items: [{ user_id: 'one' }],
    next_cursor: 'next' }, total_count: 2 }), {
    items: [{ user_id: 'one' }], responseShape: 'data.items', nextCursor: 'next', totalCount: 2 })
  assert.throws(() => parseConnectionPendingResponse({ results: [] }),
    (error: any) => error.code === 'unipile_pending_response_invalid')
  assert.throws(() => parseConnectionPendingResponse({ items: [{ name: 'missing-id' }] }),
    (error: any) => error.code === 'unipile_pending_response_invalid')
  assert.throws(() => parseConnectionPendingResponse({ items: [{ id: 'request-id-only' }] }),
    (error: any) => error.code === 'unipile_pending_response_invalid')
  assert.equal(parseConnectionPendingResponse({ items: [{ user: { id: 'person-id' } }] })
    .items[0].user.id, 'person-id')
  assert.equal(pendingPersonId({ type: 'sent', sender: { id: 'self' },
    recipient: { id: 'target' } }), 'target')

  let readAttempts = 0; const retryEvents: any[] = []
  const retryAdapter = createConnectionUnipileAdapter({ maxReadAttempts: 3,
    scheduler: { run(operation: any) { return operation() } },
    http: { async request() {
      readAttempts += 1
      if (readAttempts < 3) throw Object.assign(new Error('timeout'), { code: 'unipile_timeout' })
      return { items: [] }
    } },
    logger: { event(stage: string, status: string, details: any) {
      retryEvents.push({ stage, status, details })
    } }
  })
  await retryAdapter.listPendingInvitations('acc 1')
  assert.equal(readAttempts, 3)
  assert.deepEqual(retryEvents.filter(event => event.status === 'failed')
    .map(event => [event.details.attempt, event.details.willRetry]), [[1, true], [2, true]])

  let writeAttempts = 0
  const noWriteRetry = createConnectionUnipileAdapter({
    scheduler: { run(operation: any) { return operation() } }, logger: { event() {} },
    http: { async request() { writeAttempts += 1
      throw Object.assign(new Error('timeout'), { code: 'unipile_timeout' }) } }
  })
  await assert.rejects(() => noWriteRetry.sendInvitation('acc 1', 'ACo_1'),
    (error: any) => error.code === 'unipile_timeout')
  assert.equal(writeAttempts, 1)

  const rateLimitEvents: any[] = []
  const rateLimited = createConnectionUnipileAdapter({
    scheduler: { run(operation: any) { return operation() } },
    logger: { event(stage: string, status: string, details: any) {
      rateLimitEvents.push({ stage, status, details })
    } },
    http: { async request() {
      throw Object.assign(new Error('limited'), { code: 'unipile_api_too_many_requests',
        details: { httpStatus: 429, retryAfterMs: 3_600_000 } })
    } }
  })
  await assert.rejects(() => rateLimited.listPendingInvitations('acc 1'))
  const rateLimitEvent = rateLimitEvents.find(event => event.status === 'failed')
  assert.equal(rateLimitEvent.details.rateLimitSource, 'api')
  assert.equal(rateLimitEvent.details.retryAfterMs, 3_600_000)
  assert.equal(JSON.stringify(rateLimitEvent).includes('acc 1'), false)
}
run().then(() => console.log('connection Unipile adapter tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
