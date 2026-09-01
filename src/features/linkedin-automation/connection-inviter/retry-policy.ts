import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { dailyAudienceTargets } from './limits.ts'

export function failedRunCanRetry(run: ConnectionRun, history: ConnectionHistoryItem[]) {
  const unsafe = new Set(['sending', 'sent', 'pending', 'accepted', 'uncertain'])
  const runHistory = history.filter(item => item.runId === run.runId)
  return run.status === 'failed' && runHistory.every(item =>
    !unsafe.has(item.status) && !item.sentAt && !item.requestId)
}

export function prepareRunRetry(run: ConnectionRun, context: any, safeRecruiterOnly: boolean) {
  run.stackId = context.stackId; run.stack = context.stack
  run.safeRecruiterOnly = !context.stack && safeRecruiterOnly
  run.status = 'running'; run.stage = 'queued'; run.errorCode = undefined
  const hasFrozenQuota = run.dailyQuota !== undefined &&
    run.audienceQuota.recruiter + run.audienceQuota.technical > 0
  if (!hasFrozenQuota) {
    run.connectionCount = undefined; run.dailyLimit = undefined; run.dailyQuota = undefined
    run.audienceQuota = { recruiter: 0, technical: 0 }
  }
  run.counters = { searched: 0, discovered: 0, eligible: 0, sent: 0, skipped: 0,
    sentByAudience: { recruiter: 0, technical: 0 },
    shortfallByAudience: { recruiter: 0, technical: 0 },
    filterFunnel: {
      recruiter: { found: 0, structurallyValid: 0, roleMatched: 0, historyClear: 0,
        preflightPassed: 0, claimed: 0, sent: 0 },
      technical: { found: 0, structurallyValid: 0, roleMatched: 0, historyClear: 0,
        preflightPassed: 0, claimed: 0, sent: 0 }
    } }
  run.usedSearchKeys = []; run.seenPersonIds = []; run.skipReasonCounters = {}
  run.searchProgress = { keyIndex: { recruiter: 0, technical: 0 },
    keyTotal: { recruiter: 0, technical: 0 }, page: 0, found: 0, checked: 0,
    streams: { recruiter: { keyIndex: 0, page: 0 }, technical: { keyIndex: 0, page: 0 } },
    recentSearchAt: [], locations: {},
    eligible: 0, skipped: 0, consecutiveEmptyRecruiterSearches: 0,
    exhausted: { recruiter: false, technical: run.safeRecruiterOnly },
    pass: 1, passUsedSearchKeys: [], pendingCandidates: [] }
  run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
  run.pausedAt = undefined
  run.finishedAt = undefined
}

export function completedRunCanTopUp(run: ConnectionRun, context: any) {
  if (!['succeeded', 'partial', 'stopped'].includes(run.status)) return false
  if (!context.stack) return run.counters.sentByAudience.recruiter < run.audienceQuota.recruiter
  return run.counters.sentByAudience.recruiter < run.audienceQuota.recruiter ||
    run.counters.sentByAudience.technical < run.audienceQuota.technical
}

export function prepareRunTopUp(run: ConnectionRun, context: any, safeRecruiterOnly: boolean) {
  const pendingCandidates = run.searchProgress.pendingCandidates.filter(item =>
    ['eligible', 'deferred'].includes(item.status))
  const recentSearchAt = [...run.searchProgress.recentSearchAt]
  const locations = { ...run.searchProgress.locations }
  const wasSafeRecruiterOnly = run.safeRecruiterOnly
  run.stackId = context.stackId; run.stack = context.stack
  run.safeRecruiterOnly = !context.stack && safeRecruiterOnly
  if (wasSafeRecruiterOnly && context.stack && run.dailyLimit !== undefined) {
    run.audienceQuota = dailyAudienceTargets(run.dailyLimit)
    run.dailyQuota = run.dailyLimit
  }
  run.status = 'running'; run.stage = 'queued'; run.errorCode = undefined
  run.searchProgress = { keyIndex: { recruiter: 0, technical: 0 },
    keyTotal: { recruiter: 0, technical: 0 }, page: 0, found: 0, checked: 0,
    streams: { recruiter: { keyIndex: 0, page: 0 }, technical: { keyIndex: 0, page: 0 } },
    recentSearchAt, locations,
    eligible: 0, skipped: 0, consecutiveEmptyRecruiterSearches: 0,
    exhausted: { recruiter: false, technical: run.safeRecruiterOnly },
    pass: (run.searchProgress?.pass ?? 0) + 1, passUsedSearchKeys: [], pendingCandidates }
  run.seenPersonIds = []; run.retryState = undefined; run.timerState = undefined
  run.nextActionAt = undefined; run.pausedAt = undefined
  run.finishedAt = undefined
}

export const transientRunCanResume = (run: ConnectionRun) =>
  run.status === 'paused' && run.stage === 'paused_transient'
