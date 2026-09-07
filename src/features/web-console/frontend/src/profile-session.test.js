import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useProfileSession } from './use-profile-session.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
const account = { platformAccountId: 203, clientName: 'Fixture' }
const running = { jobId: 'active', platformAccountId: 203, status: 'verifying' }
const old = { jobId: 'old', platformAccountId: 203, status: 'succeeded' }
let reads = 0
let resolveRead
const api = { adminProfileJobs: async () => ({ jobs: [running, old] }),
  adminProfileJob: () => { reads += 1; return new Promise(resolve => { resolveRead = resolve }) } }
const draft = { dirty: ref(false), reset() {}, syncPreview() {} }
const session = useProfileSession(api, draft)
try {
  await session.open(account)
  assert.equal(reads, 1)
  session.close()
  assert.equal(session.active.value, true)
  await session.open(account)
  assert.equal(reads, 1, 'reopen does not start a second observer')
  session.showHistory(old)
  assert.equal(reads, 1, 'history does not replace active observer')
  assert.equal(session.job.value.jobId, 'old')
  resolveRead({ ...running, status: 'succeeded' })
  await settle()
  assert.equal(session.trackedJob.value.status, 'succeeded')
  assert.equal(session.job.value.jobId, 'old', 'background update does not replace history selection')
  assert.equal(session.active.value, false)
  session.close()
  await session.open(account)
  assert.equal(session.job.value.jobId, 'active', 'account button opens latest result, not previously viewed history')
  assert.equal(reads, 1, 'opening saved latest result does not duplicate reads')
  session.reset()
  assert.equal(session.job.value, null)
} finally { session.dispose() }
console.log('profile session observation tests passed')
