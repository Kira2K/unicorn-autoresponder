import { connectionError, connectionErrorCode, connectionHttpStatus,
  transientConnectionError } from './errors.ts'
import { waitOrStop } from './run-control.ts'
import { requireConnectionRunDay } from './day-window.ts'
import type { ConnectionRunStage, ConnectionRetryState, ConnectionRun } from './types.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'

const STEP_MS = 90_000
const MAX_MS = 30 * 60_000
const CAP_FLOOR_MS = 28.5 * 60_000
const UNIPILE_RATE_LIMIT_BASE_MS = 3 * 60_000
const UNIPILE_RATE_LIMIT_CAP_MS = 30 * 60_000

const boundedRandom = (value: number) => Math.min(1, Math.max(0, value))

export function retryAfterMilliseconds(error: any): number | undefined {
  const explicitMilliseconds = Number(error?.details?.retryAfterMs)
  if (Number.isFinite(explicitMilliseconds) && explicitMilliseconds >= 0) {
    return Math.ceil(explicitMilliseconds)
  }
  const value = error?.details?.retryAfter ?? error?.response?.headers?.['retry-after'] ??
    error?.response?.headers?.get?.('retry-after')
  if (value === undefined || value === null || value === '') return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const date = Date.parse(String(value))
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

export function connectionRetryDelay(attempt: number, random: () => number,
  explicitRetryAfterMs?: number) {
  if (explicitRetryAfterMs !== undefined) return Math.max(0, explicitRetryAfterMs)
  const lower = attempt * STEP_MS
  if (lower >= MAX_MS) {
    return Math.round(CAP_FLOOR_MS + boundedRandom(random()) * (MAX_MS - CAP_FLOOR_MS))
  }
  const upper = Math.min(MAX_MS, lower + STEP_MS)
  return Math.round(lower + boundedRandom(random()) * (upper - lower))
}

export function unipileRateLimitDelay(attempt: number, random: () => number,
  explicitRetryAfterMs?: number) {
  const exponent = Math.max(0, Math.min(10, attempt - 1))
  const adaptive = Math.min(UNIPILE_RATE_LIMIT_CAP_MS,
    UNIPILE_RATE_LIMIT_BASE_MS * (2 ** exponent))
  void random
  return Math.max(adaptive, explicitRetryAfterMs ?? 0)
}

export function connectionRetryProvider(error: unknown): 'noco' | 'unipile' {
  return connectionErrorCode(error).startsWith('noco_') ? 'noco' : 'unipile'
}

export function makeRetryState(runtime: ConnectionRuntime, run: ConnectionRun,
  provider: 'noco' | 'unipile', operation: string, error: unknown): ConnectionRetryState {
  const errorCode = connectionErrorCode(error)
  const rateLimited = provider === 'unipile' && (connectionHttpStatus(error) === 429 ||
    errorCode.includes('too_many_requests') || errorCode.includes('rate_limit'))
  const candidate = run.retryState?.provider === provider && run.retryState.operation === operation
    ? run.retryState : undefined
  const previousRateLimited = candidate?.provider === 'unipile' &&
    (candidate.errorCode.includes('429') || candidate.errorCode.includes('too_many_requests') ||
      candidate.errorCode.includes('rate_limit'))
  const previous = candidate && previousRateLimited === rateLimited ? candidate : undefined
  const attempt = (previous?.attempt ?? 0) + 1
  const failedAt = runtime.now()
  const explicitRetryAfter = retryAfterMilliseconds(error)
  const delayMs = rateLimited
    ? unipileRateLimitDelay(attempt, runtime.random, explicitRetryAfter)
    : connectionRetryDelay(attempt, runtime.random, explicitRetryAfter)
  return {
    provider, operation, attempt, errorCode, delayMs,
    nextRetryAt: new Date(failedAt.getTime() + delayMs).toISOString(),
    firstFailedAt: previous?.firstFailedAt ?? failedAt.toISOString(),
    lastFailedAt: failedAt.toISOString()
  }
}

export async function withConnectionRetry<T>(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, provider: 'noco' | 'unipile', operation: string, action: () => Promise<T>,
  options: { allowAfterDayClose?: boolean } = {}): Promise<T> {
  const resumeStage = run.stage
  let retried = false
  while (true) {
    try {
      if (!options.allowAfterDayClose) requireConnectionRunDay(runtime, run)
      const result = await action()
      if (retried) {
        run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
        run.pausedAt = undefined; run.errorCode = undefined; run.stage = resumeStage
        runtime.emit(run, 'retry_succeeded')
        if (provider === 'unipile') await save(run, 'retry_succeeded', 'critical')
      }
      return result
    } catch (error) {
      if (!transientConnectionError(error)) throw error
      retried = true
      runtime.store.recordRetry?.()
      run.retryState = makeRetryState(runtime, run, provider, operation, error)
      run.status = 'running'; run.stage = 'waiting_retry'; run.errorCode = run.retryState.errorCode
      run.pausedAt = runtime.now().toISOString(); run.nextActionAt = run.retryState.nextRetryAt
      run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
        nextActionAt: run.retryState.nextRetryAt }
      runtime.logger.event('retry', 'failed', { runId: run.runId,
        platformAccountId: run.platformAccountId, provider, operation, attempt: run.retryState.attempt,
        errorCode: run.retryState.errorCode, delayMs: run.retryState.delayMs,
        nextRetryAt: run.retryState.nextRetryAt })
      runtime.emit(run, 'retry_scheduled')
      if (provider === 'unipile') await save(run, 'retry_scheduled', 'critical')
      if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs,
        options.allowAfterDayClose ? undefined : run.localDate)) {
        throw connectionError('connection_stop_requested', 'Connection run stop was requested.')
      }
    }
  }
}

export async function waitWithRunTimer(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, kind: ConnectionRun['timerState'] extends infer _ ?
    'search_pacing' | 'search_batch_cooldown' | 'invitation_delay' : never,
  stage: ConnectionRunStage, delayMs: number, persist = false) {
  const previousStage = run.stage
  const nextActionAt = new Date(runtime.now().getTime() + delayMs).toISOString()
  run.stage = stage; run.nextActionAt = nextActionAt; run.timerState = { kind, delayMs, nextActionAt }
  runtime.emit(run, 'timer_started')
  if (persist) await save(run, 'timer_started')
  const proceed = await waitOrStop(runtime, run.runId, delayMs, run.localDate)
  run.timerState = undefined; run.nextActionAt = undefined; run.stage = previousStage
  return proceed
}

export const searchRequestDelay = (random: () => number) =>
  60_000 + Math.floor(boundedRandom(random()) * 30_000)
