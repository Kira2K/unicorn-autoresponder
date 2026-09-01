import type { ConnectionHistoryItem } from './types.ts'

const REUSABLE_STATUSES = new Set(['eligible', 'skipped', 'failed', 'deferred'])

const safelyReusable = (item: ConnectionHistoryItem | undefined) => Boolean(item &&
  REUSABLE_STATUSES.has(item.status) && !item.sentAt && !item.requestId && !item.verifiedAt)

function confirmsOwnSending(existing: ConnectionHistoryItem | undefined,
  proposed: ConnectionHistoryItem) {
  return Boolean(existing?.recordId && existing.historyKey === proposed.historyKey &&
    existing.runId === proposed.runId && existing.accountId === proposed.accountId &&
    existing.personId === proposed.personId && existing.status === 'sending' &&
    !existing.sentAt && !existing.requestId)
}

export async function claimRunCandidate(store: any, proposed: ConnectionHistoryItem) {
  let existing: ConnectionHistoryItem | undefined
  if (proposed.recordId) {
    existing = await store.findHistory(proposed.accountId, proposed.personId, true)
    if (!existing || !safelyReusable(existing)) return undefined
  } else if (await store.claimHistory(proposed)) return proposed
  else existing = await store.findHistory(proposed.accountId, proposed.personId, true)
  if (!existing || !safelyReusable(existing)) {
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
  try { await store.updateHistory(existing) }
  catch (error) {
    const confirmed = await store.findHistory(proposed.accountId, proposed.personId, true)
    if (confirmsOwnSending(confirmed, proposed)) return confirmed
    throw error
  }
  const confirmed = await store.findHistory(proposed.accountId, proposed.personId, true)
  return confirmsOwnSending(confirmed, proposed) ? confirmed : undefined
}
