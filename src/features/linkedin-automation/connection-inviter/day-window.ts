import { connectionError } from './errors.ts'
import { synchronizeConfirmedProgress } from './daily-progress.ts'
import { dateParts } from './limits.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'

export function connectionRunDayIsOpen(runtime: ConnectionRuntime, run: ConnectionRun) {
  return dateParts(runtime.now(), runtime.timeZone).localDate === run.localDate
}

export function requireConnectionRunDay(runtime: ConnectionRuntime, run: ConnectionRun) {
  if (!connectionRunDayIsOpen(runtime, run)) {
    throw connectionError('connection_daily_window_closed',
      'The local calendar day for this Connection Inviter run has ended.')
  }
}

export async function closeConnectionRunDay(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, confirmedHistory?: ConnectionHistoryItem[]) {
  const history = confirmedHistory ?? await runtime.store.listRunHistory(run.runId, 1000)
  const progress = synchronizeConfirmedProgress(run, history, run.audienceQuota)
  run.status = 'partial'; run.stage = 'daily_window_closed'
  run.errorCode ??= 'connection_daily_window_closed'
  run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
  run.pausedAt = undefined; run.executorId = undefined; run.heartbeatAt = undefined
  run.finishedAt = runtime.now().toISOString()
  await save(run, 'partial', 'critical')
  runtime.logger.event('run_day_close', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, sentCount: run.counters.sent,
    dailyQuota: run.dailyQuota ?? 0,
    recruiterShortfall: progress.remaining.recruiter,
    technicalShortfall: progress.remaining.technical,
    shortfall: progress.remaining.recruiter + progress.remaining.technical })
}
