import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useProfileActions } from './use-profile-actions.js'
const job = { jobId: 'fixture', status: 'preview_ready', planHash: 'approved-hash', preview: { issues: [] } }
const session = { job: ref(job), active: ref(false), loading: ref(false), error: ref(''),
  account: ref({ platformAccountId: 203 }), ready: async () => {}, observe(value) { this.job.value = value } }
const draft = { dirty: ref(false) }
let posts = 0
let resolvePost
let approved
const api = { applyAdminProfileJob: async (id, hash) => {
  posts += 1; approved = { id, hash }
  return new Promise(resolve => { resolvePost = resolve })
} }
const actions = useProfileActions(api, session, draft)
actions.apply()
assert.equal(posts, 0, 'asking for confirmation cannot write')
const first = actions.confirm()
await actions.confirm()
assert.equal(posts, 1, 'double click produces one Apply')
assert.deepEqual(approved, { id: 'fixture', hash: 'approved-hash' })
resolvePost({ ...job, status: 'running' })
await first
assert.equal(actions.confirmation.value, null)
session.job.value = job
actions.apply()
session.job.value = { ...job, planHash: 'different-hash' }
await actions.confirm()
assert.equal(posts, 1, 'changed hash cannot be applied')
session.job.value = { ...job, preview: { issues: [{ level: 'fatal' }] } }
actions.apply()
assert.equal(actions.confirmation.value, null)
session.job.value = job
session.active.value = true
actions.apply()
assert.equal(actions.confirmation.value, null)
session.active.value = false
api.startAdminProfileGeneration = async () => { throw new Error('mock unavailable') }
await actions.generate({ name: 'cv.pdf' })
assert.equal(actions.pending.value, false)
assert(session.error.value)
console.log('profile confirmation and single request tests passed')

session.job.value = { ...job, preview: { canApply: true, skippedChanges: ['profile.education[0]'],
  issues: [{ level: 'fatal', path: 'profile.education[0].data.end_date' }] } }
actions.apply()
assert.equal(actions.confirmation.value.jobId, job.jobId, 'partial plan requires explicit confirmation')
actions.confirmation.value = null
session.job.value = { ...job, status: 'generating_profile' }
session.active.value = true
let stops = 0, closed = 0, finishStop
session.close = () => { closed += 1 }
api.stopAdminProfileGeneration = async id => {
  assert.equal(id, job.jobId); stops += 1
  return new Promise(resolve => { finishStop = resolve })
}
const stopping = actions.stopGeneration()
await actions.stopGeneration()
assert.equal(stops, 1, 'active generation can be stopped once')
assert.equal(closed, 0, 'do not pretend to stop before server acknowledgement')
finishStop({ ...job, status: 'failed', phase: 'generation_stopped' })
await stopping
assert.equal(closed, 1)
for (const status of ['running', 'verifying']) {
  session.job.value = { ...job, status }
  await actions.stopGeneration()
}
assert.equal(stops, 1, 'filling is not cancellable')
