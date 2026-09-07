const { nocoErrorCode, nocoRetryAfterMs } = require('./error-policy.ts') as
  typeof import('./error-policy.ts')
const { createNocoQueueLogger } = require('./queue-logger.ts') as {
  createNocoQueueLogger(options?: any): (event: Record<string, unknown>) => void
}

type Kind = 'read' | 'write'
type Loader<T> = () => Promise<T>

type LimiterOptions = {
  maxRequestsPerBatch?: number
  batchPauseMs?: number
  cooldownMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  log?: (event: Record<string, unknown>) => void
  /** Backward-compatible name for maxRequestsPerBatch. */
  maxStarts?: number
  /** Backward-compatible name for batchPauseMs. */
  windowMs?: number
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
}

function createNocoRequestLimiter(options: LimiterOptions = {}) {
  const maxRequestsPerBatch = positiveInteger(
    options.maxRequestsPerBatch ?? options.maxStarts,
    4
  )
  const batchPauseMs = positiveInteger(options.batchPauseMs ?? options.windowMs, 1_000)
  const cooldownMs = positiveInteger(options.cooldownMs, 30_000)
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise(resolve => setTimeout(resolve, milliseconds)))
  const log = options.log ?? createNocoQueueLogger()

  let tail = Promise.resolve()
  let waiting = 0
  let busy = false
  let completedInBatch = 0
  let batchPausedUntil = 0
  let blockedUntil = 0

  function refreshPauses(timestamp = now()): void {
    if (blockedUntil && blockedUntil <= timestamp) {
      blockedUntil = 0
      log({ event: 'cooldown_finished', queueDepth: waiting })
    }
    if (batchPausedUntil && batchPausedUntil <= timestamp) {
      batchPausedUntil = 0
      log({ event: 'batch_pause_finished', queueDepth: waiting })
    }
  }

  function availableAt(timestamp = now()): number {
    refreshPauses(timestamp)
    return Math.max(timestamp, blockedUntil, batchPausedUntil)
  }

  function waitReason(timestamp = now()): 'batch_pause' | 'rate_limit' | null {
    if (blockedUntil > timestamp) return 'rate_limit'
    if (batchPausedUntil > timestamp) return 'batch_pause'
    return null
  }

  function snapshot() {
    const timestamp = now()
    const nextAt = availableAt(timestamp)
    const reason = waitReason(timestamp)
    return {
      state: reason === 'rate_limit' ? 'cooldown' : waiting > 0 || busy || reason ? 'queued' : 'ready',
      waiting,
      busy,
      availableAt: nextAt > timestamp ? new Date(nextAt).toISOString() : null,
      waitMs: Math.max(0, nextAt - timestamp),
      waitReason: reason,
      completedInBatch
    }
  }

  function rateLimited(waitMs = cooldownMs): void {
    const safeWait = Number.isFinite(waitMs) && waitMs > 0 ? Number(waitMs) : cooldownMs
    const timestamp = now()
    blockedUntil = Math.max(blockedUntil, timestamp + safeWait)
    // Retry-After can be shorter than the mandatory pause; preserve both constraints.
    log({ event: 'cooldown_started', status: 429, queueDepth: waiting,
      waitMs: safeWait, completedInBatch })
  }

  async function waitForAvailability(): Promise<void> {
    while (true) {
      const timestamp = now()
      const delay = Math.max(0, availableAt(timestamp) - timestamp)
      if (!delay) return
      await sleep(delay)
    }
  }

  function completeAttempt(): void {
    completedInBatch += 1
    if (completedInBatch < maxRequestsPerBatch) return
    completedInBatch = 0
    batchPausedUntil = Math.max(batchPausedUntil, now() + batchPauseMs)
    log({ event: 'batch_pause_started', queueDepth: waiting,
      waitMs: batchPauseMs, completedInBatch })
  }

  function schedule<T>(kind: Kind, action: Loader<T>): Promise<T> {
    waiting += 1
    log({ event: 'request_queued', kind, queueDepth: waiting, waitMs: snapshot().waitMs,
      completedInBatch })

    const queued = tail.then(async () => {
      await waitForAvailability()
      waiting -= 1
      busy = true
      const startedAt = now()
      const requestInBatch = completedInBatch + 1
      let rateLimitError = false
      log({ event: 'request_dispatched', kind, queueDepth: waiting, completedInBatch,
        requestInBatch })
      try {
        const value = await action()
        log({ event: 'request_succeeded', kind, queueDepth: waiting,
          durationMs: now() - startedAt, requestInBatch })
        return value
      } catch (error: any) {
        const status = Number(error?.response?.status)
        const errorCode = nocoErrorCode(error)
        rateLimitError = errorCode === 'noco_rate_limited'
        if (rateLimitError) rateLimited(nocoRetryAfterMs(error, now()) ?? cooldownMs)
        log({ event: 'request_failed', kind, queueDepth: waiting,
          durationMs: now() - startedAt,
          requestInBatch,
          ...(Number.isFinite(status) ? { status } : {}),
          ...(errorCode ? { errorCode } : {}) })
        throw error
      } finally {
        completeAttempt()
        busy = false
      }
    })

    tail = queued.then(() => undefined, () => undefined)
    return queued
  }

  return { rateLimited, schedule, snapshot }
}

const sharedNocoRequestLimiter = createNocoRequestLimiter()

module.exports = { createNocoRequestLimiter, sharedNocoRequestLimiter }
export type { Kind, LimiterOptions }
