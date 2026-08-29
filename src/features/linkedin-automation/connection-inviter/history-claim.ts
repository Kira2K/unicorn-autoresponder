import type { ConnectionHistoryItem } from './types.ts'

const REUSABLE_STATUSES = new Set(['eligible', 'skipped', 'failed', 'deferred'])

export async function claimRunCandidate(store: any, proposed: ConnectionHistoryItem) {
  if (proposed.recordId) {
    await store.updateHistory(proposed)
    return proposed
  }
  if (await store.claimHistory(proposed)) return proposed
  const existing = await store.findHistory(proposed.accountId, proposed.personId)
  if (!existing || !REUSABLE_STATUSES.has(existing.status)) {
    return undefined
  }
  existing.runId = proposed.runId
  existing.audience = proposed.audience
  existing.searchKey = proposed.searchKey
  existing.name = proposed.name
  existing.headline = proposed.headline
  existing.location = proposed.location
  existing.profileUrl = proposed.profileUrl
  existing.status = proposed.status
  existing.reasonCode = proposed.reasonCode
  existing.updatedAt = proposed.updatedAt
  await store.updateHistory(existing)
  return existing as ConnectionHistoryItem
}
