import type { SearchAudience } from './catalog.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { dailyAudienceTargets, MAX_DAILY_INVITATIONS } from './limits.ts'

const SENT_STATUSES = new Set(['sent', 'accepted'])

export function remainingAudienceQuota(run: ConnectionRun, history: ConnectionHistoryItem[],
  target: Record<SearchAudience, number>) {
  const sent = { recruiter: 0, technical: 0 }
  for (const item of history) {
    if (item.runId === run.runId && SENT_STATUSES.has(item.status)) sent[item.audience] += 1
  }
  const confirmedTotal = sent.recruiter + sent.technical
  const remaining = {
    recruiter: Math.max(0, target.recruiter - sent.recruiter),
    technical: Math.max(0, target.technical - sent.technical)
  }
  return { remaining, sent, sentTotal: confirmedTotal }
}

export function synchronizeConfirmedProgress(run: ConnectionRun,
  history: ConnectionHistoryItem[], target = run.audienceQuota) {
  run.searchProgress.reservedInvitations = Object.fromEntries(history.filter(item => item.runId === run.runId &&
    ['sending', 'uncertain'].includes(item.status)).map(item => [item.personId, item.audience]))
  const progress = remainingAudienceQuota(run, history, target)
  run.counters.sent = progress.sentTotal
  run.counters.sentByAudience = progress.sent
  run.counters.shortfallByAudience = { ...progress.remaining }
  return progress
}

// Unknown writes occupy quota without being reported as confirmed sends.
export function invitationCapacity(run: ConnectionRun) {
  const used = { ...run.counters.sentByAudience }
  for (const audience of Object.values(run.searchProgress.reservedInvitations ?? {})) used[audience]++
  return { used, remaining: { recruiter: Math.max(0, run.audienceQuota.recruiter - used.recruiter),
    technical: Math.max(0, run.audienceQuota.technical - used.technical) } }
}

// Apply a lowered ceiling to saved runs without erasing confirmed or unknown writes.
// Historical sends above the new ceiling remain visible, but leave no new capacity.
export function applyDailyInvitationCap(run: ConnectionRun) {
  if (run.dailyQuota === undefined || run.dailyQuota <= MAX_DAILY_INVITATIONS) return
  const { used } = invitationCapacity(run)
  const remaining = Math.max(0, MAX_DAILY_INVITATIONS - used.recruiter - used.technical)
  const planned = dailyAudienceTargets(MAX_DAILY_INVITATIONS)
  const recruiter = Math.min(remaining,
    Math.max(0, Math.min(run.audienceQuota.recruiter, planned.recruiter) - used.recruiter))
  const technical = Math.min(remaining - recruiter,
    Math.max(0, run.audienceQuota.technical - used.technical))
  run.audienceQuota = { recruiter: used.recruiter + recruiter, technical: used.technical + technical }
  run.dailyLimit = MAX_DAILY_INVITATIONS
  run.dailyQuota = MAX_DAILY_INVITATIONS
}

export function confirmedQuotaReached(progress: ReturnType<typeof remainingAudienceQuota>,
  target: Record<SearchAudience, number>) {
  return progress.sent.recruiter === target.recruiter &&
    progress.sent.technical === target.technical
}

export function confirmedQuotaExceeded(progress: ReturnType<typeof remainingAudienceQuota>,
  target: Record<SearchAudience, number>) {
  return progress.sent.recruiter > target.recruiter || progress.sent.technical > target.technical
}
