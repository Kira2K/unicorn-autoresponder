import assert from 'node:assert/strict'
import { jobElapsedSeconds, jobRetrySeconds } from './profile-job-timing.js'

const start = '2026-08-24T10:00:00.000Z'
const now = Date.parse('2026-08-24T10:00:10.000Z')
assert.equal(jobElapsedSeconds({ status: 'retrying', createdAt: start }, now), 10)
assert.equal(jobElapsedSeconds({ status: 'failed', createdAt: start,
  updatedAt: '2026-08-24T10:00:04.000Z' }, now), 4)
assert.equal(jobRetrySeconds({ retry: {
  nextRetryAt: '2026-08-24T10:00:30.000Z' } }, now), 20)
assert.equal(jobRetrySeconds({}, now), 0)
console.log('profile job timing tests passed')
