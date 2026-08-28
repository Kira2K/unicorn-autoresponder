const assert = require('node:assert/strict')
const { createConnectionUnipileAdapter, invitationRequestId, pendingPersonId } =
  require('../unipile-adapter.ts') as typeof import('../unipile-adapter.ts')

const calls: any[] = []
const adapter = createConnectionUnipileAdapter({
  http: { async request(method: string, path: string, body?: any) {
    calls.push({ method, path, body }); return { id: 'request-1' }
  } }, scheduler: { run(operation: any) { return operation() } }
})
async function run() {
  await adapter.searchPeople('acc 1', 'Python Recruiter Berlin', 'next cursor')
  await adapter.listRelations('acc 1', 'relations cursor')
  await adapter.listPendingInvitations('acc 1', 100)
  await adapter.sendInvitation('acc 1', 'ACo_1')
  assert.deepEqual(calls[0], { method: 'POST',
    path: '/acc%201/linkedin/search/people?cursor=next+cursor',
    body: { keywords: 'Python Recruiter Berlin', network_distance: [2] } })
  assert.match(calls[1].path, /users\/me\/relations\?cursor=relations\+cursor/)
  assert.match(calls[2].path, /type=sent&offset=100/)
  assert.deepEqual(calls[3].body, { user_id: 'ACo_1' })
  assert.equal('message' in calls[3].body, false)
  assert.equal(invitationRequestId({ data: { request_id: 'r' } }), 'r')
  assert.equal(pendingPersonId({ user: { provider_id: 'ACo' } }), 'ACo')
}
run().then(() => console.log('connection Unipile adapter tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
