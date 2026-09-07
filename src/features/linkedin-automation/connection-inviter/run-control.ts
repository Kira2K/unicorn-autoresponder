import { connectionError } from './errors.ts'
import { dateParts } from './limits.ts'
import { publicRun } from './run-model.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

export async function requestRunStop(runtime: ConnectionRuntime, active: Map<string, ConnectionRun>,
  requests: Set<string>, runId: string, save: SaveRun,
  resumeOrphan?: (run: ConnectionRun) => Promise<void>) {
  const live = active.get(runId); const run = live ?? await runtime.store.getRun(runId)
  if (!run) throw connectionError('connection_run_not_found', 'Connection run was not found.')
  const details = { runId, platformAccountId: run.platformAccountId }
  runtime.logger.event('run_stop', 'started', details)
  if (run.status !== 'running') {
    runtime.logger.event('run_stop', 'succeeded', { ...details, runStatus: run.status,
      reasonCode: 'already_terminal' })
    return publicRun(run)
  }
  if (!live) {
    requests.add(runId); run.stage = 'stop_requested'
    await save(run, 'stage_changed', 'critical')
    await resumeOrphan?.(run)
    const stopped = await runtime.store.getRun(runId) ?? run
    runtime.logger.event('run_stop', 'succeeded', { ...details, runStatus: stopped.status,
      runStage: stopped.stage, reasonCode: 'orphan_executor_recovered' })
    return publicRun(stopped)
  }
  requests.add(runId); run.stage = 'stop_requested'; await save(run, 'stage_changed', 'critical')
  return publicRun(run)
}

export async function finishRunStop(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun) {
  if (!runtime.stopRequested(run.runId)) return false
  run.status = 'stopped'; run.stage = 'stopped_by_admin'
  run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
  run.errorCode = undefined
  run.executorId = undefined; run.heartbeatAt = undefined
  run.finishedAt = runtime.now().toISOString()
  try { await save(run, 'stopped', 'critical') }
  catch (error) {
    // Keep the durable Stop intent recoverable. A terminal state is not real until its
    // Noco snapshot has been confirmed by save().
    run.status = 'running'; run.stage = 'stop_requested'; run.finishedAt = undefined
    throw error
  }
  runtime.logger.event('run_stop', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, runStatus: run.status, runStage: run.stage,
    sentCount: run.counters.sent })
  return true
}

export async function waitOrStop(runtime: ConnectionRuntime, runId: string, milliseconds: number,
  expectedLocalDate?: string) {
  let remaining = milliseconds
  while (remaining > 0) {
    if (runtime.stopRequested(runId)) return false
    if (expectedLocalDate && dateParts(runtime.now(), runtime.timeZone).localDate !== expectedLocalDate) {
      throw connectionError('connection_daily_window_closed',
        'The local calendar day for this Connection Inviter run has ended.')
    }
    const step = Math.min(1000, remaining); await runtime.sleep(step); remaining -= step
  }
  if (expectedLocalDate && dateParts(runtime.now(), runtime.timeZone).localDate !== expectedLocalDate) {
    throw connectionError('connection_daily_window_closed',
      'The local calendar day for this Connection Inviter run has ended.')
  }
  return !runtime.stopRequested(runId)
}
