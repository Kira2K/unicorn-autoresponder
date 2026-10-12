import type { BatchState } from '../types.ts'
import type { WorkflowInput } from './index.ts'

/** Skip redundant preparation only for the exact persisted batch; live gates still inspect and verify before writes. */
export function reusableBatch(input: WorkflowInput, saved?: BatchState): saved is BatchState {
  if (!input.resume || !saved || saved.id !== input.batchId || saved.candidateId !== input.candidate.id || saved.limit !== input.limit) return false
  if (JSON.stringify(saved.targetIds) !== JSON.stringify(input.positions.map(p => p.id))) return false
  const collection = { runId: input.collection.collection.runId, digest: input.collection.digest, stackId: input.stackId, ...(input.candidate.databaseClientId ? { studentId: input.candidate.databaseClientId } : {}) }
  if (JSON.stringify(saved.collection) !== JSON.stringify(collection) || JSON.stringify(saved.testCampaign) !== JSON.stringify(input.testCampaign)) return false
  return saved.records.length === saved.targetIds.length && saved.records.every(r => {
    const incoming = input.positions.find(p => p.id === r.position.id)
    if (!incoming || incoming.url !== r.position.url || incoming.applyUrl !== r.position.applyUrl) return false
    if (r.attempt > 0 || ['succeeded', 'skipped'].includes(r.status)) return true
    return !!r.preparation && !!r.answers && !r.answers.missing.length && ['prepared', 'blocked'].includes(r.status)
  })
}
