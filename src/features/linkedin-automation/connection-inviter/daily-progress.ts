import type { SearchAudience } from './catalog.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'

const SENT_STATUSES = new Set(['sent', 'accepted'])

export function remainingAudienceQuota(run: ConnectionRun, history: ConnectionHistoryItem[],
  target: Record<SearchAudience, number>) {
  const sent = { recruiter: 0, technical: 0 }
  for (const item of history) {
    if (item.runId === run.runId && SENT_STATUSES.has(item.status)) sent[item.audience] += 1
  }
  const confirmedTotal = sent.recruiter + sent.technical
  const sentTotal = Math.max(run.counters.sent, confirmedTotal)
  let totalRemaining = Math.max(0, target.recruiter + target.technical - sentTotal)
  const remaining = { recruiter: 0, technical: 0 }
  for (const audience of ['recruiter', 'technical'] as const) {
    const audienceRemaining = Math.max(0, target[audience] - sent[audience])
    remaining[audience] = Math.min(audienceRemaining, totalRemaining)
    totalRemaining -= remaining[audience]
  }
  return { remaining, sent, sentTotal }
}
