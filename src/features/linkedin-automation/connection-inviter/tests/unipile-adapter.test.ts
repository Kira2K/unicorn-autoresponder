const assert = require('node:assert/strict')
const { createConnectionUnipileAdapter, invitationRequestId, pendingPersonId } =
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
  await adapter.searchPeople('acc 1', 'Python Recruiter Berlin', 'next cursor')
  await adapter.listRelations('acc 1', 'relations cursor')
  await adapter.listPendingInvitations('acc 1', 100)
  await adapter.sendInvitation('acc 1', 'ACo_1')
  assert.deepEqual(calls[0], { method: 'GET', path: '/accounts/acc%201', body: undefined })
  assert.deepEqual(calls[1], { method: 'GET',
    path: '/acc%201/users/me?variant=linkedin_classic', body: undefined })
  assert.deepEqual(calls[2], { method: 'GET',
    path: '/acc%201/users/ACo_1?variant=linkedin_classic', body: undefined })
  assert.deepEqual(calls[3], { method: 'POST',
    path: '/acc%201/linkedin/search/people?cursor=next+cursor',
    body: { keywords: 'Python Recruiter Berlin', network_distance: [2] } })
  assert.deepEqual(calls[4], { method: 'GET',
    path: '/acc%201/users/me/relations?cursor=relations+cursor', body: undefined })
  assert.deepEqual(calls[5], { method: 'GET',
    path: '/acc%201/users/me/relation-requests?type=sent&offset=100', body: undefined })
  assert.deepEqual(calls[6], { method: 'POST', path: '/acc%201/users/me/relation-requests',
    body: { user_id: 'ACo_1' } })
  assert.equal('message' in calls[6].body, false)
  assert.equal(invitationRequestId({ data: { request_id: 'r' } }), 'r')
  assert.equal(pendingPersonId({ user: { provider_id: 'ACo' } }), 'ACo')
  assert.equal(events.filter(event => event.stage === 'unipile_request' &&
    event.status === 'succeeded').length, 7)
  assert.deepEqual(events.filter(event => event.status === 'succeeded')
    .map(event => event.details.httpStatus), [200, 200, 200, 200, 200, 200, 201])
  assert.equal(JSON.stringify(events).includes('acc 1'), false)
  assert.equal(JSON.stringify(events).includes('Python Recruiter Berlin'), false)
}
run().then(() => console.log('connection Unipile adapter tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
