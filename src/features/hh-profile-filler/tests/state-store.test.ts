import assert from 'node:assert/strict'
import { eligibleJobs, emptyState, markJobFailure, observeStatusTransitions } from '../state-store.ts'

export function runStateStoreTests() {
  const state = emptyState('2026-09-03T13:53:37Z')
  let created = observeStatusTransitions(state, [
    { Id: 1, client_name: 'Existing', client_status: 'on ru market',
      UpdatedAt: '2026-09-03T12:00:00Z' },
    { Id: 2, client_name: 'Future', client_status: 'studying',
      UpdatedAt: '2026-09-03T14:00:00Z' }
  ], '2026-09-03T14:10:00Z')
  assert.equal(created.length, 0)

  created = observeStatusTransitions(state, [
    { Id: 1, client_name: 'Existing', client_status: 'on ru market',
      UpdatedAt: '2026-09-03T12:00:00Z' },
    { Id: 2, client_name: 'Future', client_status: 'on en market',
      UpdatedAt: '2026-09-03T15:00:00Z' }
  ], '2026-09-03T15:01:00Z')
  assert.equal(created.length, 1)
  assert.equal(created[0].market, 'En')
  assert.equal(eligibleJobs(state).length, 1)

  observeStatusTransitions(state, [
    { Id: 2, client_name: 'Future', client_status: 'studying',
      UpdatedAt: '2026-09-03T16:00:00Z' }
  ], '2026-09-03T16:01:00Z')
  created = observeStatusTransitions(state, [
    { Id: 2, client_name: 'Future', client_status: 'on en market',
      UpdatedAt: '2026-09-03T17:00:00Z' }
  ], '2026-09-03T17:01:00Z')
  assert.equal(created.length, 1)
  assert.notEqual(created[0].id, state.jobs[0].id)

  const job = state.jobs[0]
  markJobFailure(job, 'first', 'first', '2026-09-03T18:00:00Z')
  assert.equal(job.status, 'failed')
  assert.equal(job.nextAttemptAt, '2026-09-04T18:00:00.000Z')
  markJobFailure(job, 'second', 'second', '2026-09-04T18:00:00Z')
  markJobFailure(job, 'third', 'third', '2026-09-05T18:00:00Z')
  assert.equal(job.status, 'exhausted')
}
