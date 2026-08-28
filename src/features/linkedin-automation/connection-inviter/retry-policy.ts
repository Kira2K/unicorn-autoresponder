import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'

export function failedRunCanRetry(run: ConnectionRun, history: ConnectionHistoryItem[]) {
  const unsafe = new Set(['sending', 'sent', 'accepted', 'uncertain'])
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
  run.counters = { searched: 0, discovered: 0, eligible: 0, sent: 0, skipped: 0 }
  run.usedSearchKeys = []
  run.finishedAt = undefined
}
