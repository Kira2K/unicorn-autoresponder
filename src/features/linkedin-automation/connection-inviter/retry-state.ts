import { connectionError, connectionErrorCode, connectionHttpStatus,
  normalizeConnectionProviderError, transientConnectionError } from './errors.ts'
import { waitOrStop } from './run-control.ts'
import { requireConnectionRunDay } from './day-window.ts'
import type { ConnectionRunStage, ConnectionRetryState, ConnectionRun } from './types.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import { withConnectionRequestAttempt } from './logger.ts'
import { providerRetryAt } from '../../../integrations/unipile/retry-after.ts'
import { recordFailure, recoveryExpired, recoveryWakeAt, skipRecovery, skippedAction } from '../action-recovery.ts'

const STEP_MS = 90_000
const MAX_MS = 30 * 60_000
const CAP_FLOOR_MS = 28.5 * 60_000
const UNIPILE_RATE_LIMIT_BASE_MS = 4.5 * 60_000
const UNIPILE_RATE_LIMIT_CAP_MS = 45 * 60_000

const boundedRandom = (value: number) => Math.min(1, Math.max(0, value))

export function retryAfterMilliseconds(error: any, now = Date.now()): number | undefined {
  if (Number.isFinite(error?.details?.retryAt)) return Math.max(0, error.details.retryAt - now)
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
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
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
  if (explicitRetryAfterMs !== undefined) return Math.max(0, explicitRetryAfterMs)
  const exponent = Math.max(0, Math.min(10, attempt - 1))
  const adaptive = Math.min(UNIPILE_RATE_LIMIT_CAP_MS,
    UNIPILE_RATE_LIMIT_BASE_MS * (2 ** exponent))
  void random
  return Math.max(adaptive, explicitRetryAfterMs ?? 0)
}

export function connectionRetryProvider(error: unknown): 'storage' | 'unipile' {
  const code = connectionErrorCode(error)
  return code.startsWith('noco_') || code === 'connection_storage_read_unavailable' ? 'storage' : 'unipile'
}

export function makeRetryState(runtime: ConnectionRuntime, run: ConnectionRun,
  provider: ConnectionRetryState['provider'], operation: string, error: unknown,
  previousState: ConnectionRetryState | undefined = run.retryState): ConnectionRetryState {
  const errorCode = connectionErrorCode(error)
  const rateLimited = provider === 'unipile' && (connectionHttpStatus(error) === 429 ||
    errorCode.includes('too_many_requests') || errorCode.includes('rate_limit'))
  const candidate = previousState?.provider === provider && previousState.operation === operation
    ? previousState : undefined
  const previousRateLimited = candidate?.provider === 'unipile' &&
    (candidate.errorCode.includes('429') || candidate.errorCode.includes('too_many_requests') ||
      candidate.errorCode.includes('rate_limit'))
  const previous = candidate && previousRateLimited === rateLimited ? candidate : undefined
  const attempt = (previous?.attempt ?? 0) + 1
  const failedAt = runtime.now()
  const explicitRetryAfter = retryAfterMilliseconds(error, failedAt.getTime())
  const proposedDelay = rateLimited
    ? explicitRetryAfter ?? Math.max(unipileRateLimitDelay(attempt, runtime.random),
      operation === 'invitation_write' && attempt >= 3 ? 2 * 60 * 60_000 : 0)
    : connectionRetryDelay(attempt, runtime.random, explicitRetryAfter)
  const nextRetryAt = providerRetryAt(error, failedAt.getTime(), proposedDelay)
  const delayMs = Math.max(0, nextRetryAt - failedAt.getTime())
  return {
    provider, operation, attempt, errorCode, delayMs,
    nextRetryAt: new Date(nextRetryAt).toISOString(),
    firstFailedAt: previous?.firstFailedAt ?? failedAt.toISOString(),
    lastFailedAt: failedAt.toISOString()
  }
}

export async function withConnectionRetry<T>(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, provider: ConnectionRetryState['provider'], operation: string, action: () => Promise<T>,
  options: { allowAfterDayClose?: boolean; ignoreStopRequested?: boolean; actionKey?: string;
    onFirstTransientError?: (error: unknown) => Promise<void> } = {}): Promise<T> {
  const resumeStage = run.stage
  let retried = false
  let requestAttempt = 0
  const key = options.actionKey ?? operation
  const recovery = run.searchProgress.actionRecovery ??= {}
  while (true) {
    try {
      if (provider === 'unipile' && recoveryExpired(recovery[key], runtime.now().getTime())) {
        skipRecovery(recovery[key], runtime.now().getTime())
        await save(run, 'progress', 'critical')
        throw Object.assign(skippedAction(), { actionKey: key })
      }
      runtime.assertWriterOwnership?.()
      if (provider === 'unipile' && runtime.stopRequested(run.runId))
        throw connectionError('connection_stop_requested', 'Connection run stop was requested.')
      if (!options.allowAfterDayClose) requireConnectionRunDay(runtime, run)
      requestAttempt++
      const result = await (provider === 'unipile'
        ? withConnectionRequestAttempt(requestAttempt, action) : action())
      if (provider === 'unipile' && !options.actionKey) delete recovery[key]
      if (retried) {
        run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
        run.pausedAt = undefined; run.errorCode = undefined; run.stage = resumeStage
        runtime.emit(run, 'retry_succeeded')
        if (provider === 'unipile') await save(run, 'retry_succeeded', 'critical')
      }
      return result
    } catch (caught) {
      const error = normalizeConnectionProviderError(provider, caught)
      if (!options.ignoreStopRequested && runtime.stopRequested(run.runId)) {
        throw connectionError('connection_stop_requested',
          'Connection run stop was requested.')
      }
      if (!transientConnectionError(error)) throw error
      if (provider === 'unipile') {
        const value = recordFailure(recovery[key], error, runtime.now().getTime())
        if (value) recovery[key] = value
      }
      if (!retried) await options.onFirstTransientError?.(error)
      retried = true
      runtime.store.recordRetry?.()
      run.retryState = makeRetryState(runtime, run, provider, operation, error)
      if (provider === 'unipile') run.retryState.nextRetryAt = new Date(
        recoveryWakeAt(recovery[key], Date.parse(run.retryState.nextRetryAt))).toISOString()
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
      if (runtime.cooperative && (!runtime.yieldWait || options.ignoreStopRequested)) {
        await save(run, 'retry_scheduled', 'critical')
        throw connectionError('connection_step_yield', 'Retry deadline saved.')
      }
      const remaining = Math.max(0, Date.parse(run.retryState.nextRetryAt) - runtime.now().getTime())
      const continued = runtime.yieldWait ? await runtime.yieldWait(Date.parse(run.retryState.nextRetryAt)) : options.ignoreStopRequested
        ? (await runtime.sleep(remaining), true)
        : await waitOrStop(runtime, run.runId, remaining,
          options.allowAfterDayClose ? undefined : run.localDate)
      if (!continued) {
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
  if (persist) await save(run, 'timer_started', delayMs >= 120_000 ? 'critical' : 'checkpoint')
  if (runtime.cooperative && !runtime.yieldWait && delayMs > 0) {
    await save(run, 'timer_started', 'critical')
    throw connectionError('connection_step_yield', 'Pacing deadline saved.')
  }
  const proceed = runtime.yieldWait ? await runtime.yieldWait(Date.parse(nextActionAt)) : await waitOrStop(runtime, run.runId,
    Math.max(0, Date.parse(nextActionAt) - runtime.now().getTime()), run.localDate)
  run.timerState = undefined; run.nextActionAt = undefined; run.stage = previousStage
  return proceed
}

export const searchRequestDelay = (random: () => number) =>
  40_000 + Math.floor(boundedRandom(random()) * 30_000)
