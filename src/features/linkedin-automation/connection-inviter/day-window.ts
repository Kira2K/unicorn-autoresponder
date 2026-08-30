import { connectionError } from './errors.ts'
import { dateParts } from './limits.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

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
  save: SaveRun) {
  run.status = 'partial'; run.stage = 'daily_window_closed'
  run.errorCode ??= 'connection_daily_window_closed'
  run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
  run.pausedAt = undefined; run.executorId = undefined; run.heartbeatAt = undefined
  run.finishedAt = runtime.now().toISOString()
  await save(run, 'partial', 'critical')
  runtime.logger.event('run_day_close', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, sentCount: run.counters.sent,
    dailyQuota: run.dailyQuota ?? 0, shortfall: Math.max(0,
      Number(run.dailyQuota ?? 0) - run.counters.sent) })
}
