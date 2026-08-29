import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'

export function failedRunCanRetry(run: ConnectionRun, history: ConnectionHistoryItem[]) {
  const unsafe = new Set(['sending', 'sent', 'pending', 'accepted', 'uncertain'])
  const runHistory = history.filter(item => item.runId === run.runId)
  return run.status === 'failed' && run.counters.sent === 0 && runHistory.every(item =>
    !unsafe.has(item.status) && !item.sentAt && !item.requestId)
}

export function prepareRunRetry(run: ConnectionRun, context: any, safeRecruiterOnly: boolean) {
  run.stackId = context.stackId; run.stack = context.stack
  run.safeRecruiterOnly = !context.stack && safeRecruiterOnly
  run.status = 'running'; run.stage = 'queued'; run.errorCode = undefined
  run.connectionCount = undefined; run.dailyLimit = undefined; run.dailyQuota = undefined
  run.audienceQuota = { recruiter: 0, technical: 0 }
  run.counters = { searched: 0, discovered: 0, eligible: 0, sent: 0, skipped: 0,
    sentByAudience: { recruiter: 0, technical: 0 } }
  run.usedSearchKeys = []; run.seenPersonIds = []; run.skipReasonCounters = {}
  run.searchProgress = { keyIndex: { recruiter: 0, technical: 0 },
    keyTotal: { recruiter: 0, technical: 0 }, page: 0, found: 0, checked: 0,
    eligible: 0, skipped: 0, exhausted: { recruiter: false, technical: run.safeRecruiterOnly },
    pass: 1, pendingCandidates: [] }
  run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
  run.pausedAt = undefined
  run.finishedAt = undefined
}

export function completedRunCanTopUp(run: ConnectionRun, context: any) {
  if (!['succeeded', 'partial', 'stopped'].includes(run.status)) return false
  const target = context.stack ? run.dailyLimit : run.dailyQuota
  return target === undefined || run.counters.sent < target
}

export function prepareRunTopUp(run: ConnectionRun, context: any, safeRecruiterOnly: boolean) {
  run.stackId = context.stackId; run.stack = context.stack
  run.safeRecruiterOnly = !context.stack && safeRecruiterOnly
  run.status = 'running'; run.stage = 'queued'; run.errorCode = undefined
  run.connectionCount = undefined; run.dailyLimit = undefined; run.dailyQuota = undefined
  run.audienceQuota = { recruiter: 0, technical: 0 }
  run.searchProgress = { keyIndex: { recruiter: 0, technical: 0 },
    keyTotal: { recruiter: 0, technical: 0 }, page: 0, found: 0, checked: 0,
    eligible: 0, skipped: 0, exhausted: { recruiter: false, technical: run.safeRecruiterOnly },
    pass: (run.searchProgress?.pass ?? 0) + 1, pendingCandidates: [] }
  run.seenPersonIds = []; run.retryState = undefined; run.timerState = undefined
  run.nextActionAt = undefined; run.pausedAt = undefined
  run.finishedAt = undefined
}

export const transientRunCanResume = (run: ConnectionRun) =>
  run.status === 'paused' && run.stage === 'paused_transient'
