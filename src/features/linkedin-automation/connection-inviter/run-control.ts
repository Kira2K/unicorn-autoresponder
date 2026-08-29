import { connectionError } from './errors.ts'
import { publicRun } from './run-model.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

export async function requestRunStop(runtime: ConnectionRuntime, active: Map<string, ConnectionRun>,
  requests: Set<string>, runId: string, save: SaveRun) {
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
    run.status = 'stopped'; run.stage = 'stopped_by_admin'
    run.finishedAt = runtime.now().toISOString(); await save(run, 'stopped', 'critical')
    runtime.logger.event('run_stop', 'succeeded', { ...details, runStatus: run.status,
      runStage: run.stage, reasonCode: 'no_active_executor' })
    return publicRun(run)
  }
  requests.add(runId); run.stage = 'stop_requested'; await save(run, 'stage_changed', 'critical')
  return publicRun(run)
}

export async function finishRunStop(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun) {
  if (!runtime.stopRequested(run.runId)) return false
  run.status = 'stopped'; run.stage = 'stopped_by_admin'
  run.finishedAt = runtime.now().toISOString(); await save(run, 'stopped', 'critical')
  runtime.logger.event('run_stop', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, runStatus: run.status, runStage: run.stage,
    sentCount: run.counters.sent })
  return true
}

export async function waitOrStop(runtime: ConnectionRuntime, runId: string, milliseconds: number) {
  let remaining = milliseconds
  while (remaining > 0) {
    if (runtime.stopRequested(runId)) return false
    const step = Math.min(1000, remaining); await runtime.sleep(step); remaining -= step
  }
  return !runtime.stopRequested(runId)
}
