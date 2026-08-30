const { createNocoQueueLogger } = require('./queue-logger.ts') as {
  createNocoQueueLogger(options?: any): (event: Record<string, unknown>) => void
}
type Kind = 'read' | 'write'
type Item = {
  kind: Kind
  action: () => Promise<any>
  resolve: (value: any) => void
  reject: (error: unknown) => void
}
function createNocoRequestLimiter(options: {
  maxStarts?: number
  windowMs?: number
  cooldownMs?: number
  log?: (event: Record<string, unknown>) => void
} = {}) {
  const maxStarts = options.maxStarts ?? 4
  const windowMs = options.windowMs ?? 1000
  const cooldownMs = options.cooldownMs ?? 30000
  const log = options.log ?? createNocoQueueLogger()
  const queue: Item[] = []
  let batchCount = 0
  let batchPausedUntil = 0
  let blockedUntil = 0
  let busy = false
  let timer: NodeJS.Timeout | undefined

  const depth = () => queue.length
  const nextAt = (now = Date.now()) => {
    if (blockedUntil && blockedUntil <= now) {
      blockedUntil = 0
      log({ event: 'cooldown_finished', queueDepth: depth() })
    }
    if (batchPausedUntil && batchPausedUntil <= now) {
      batchCount = 0
      batchPausedUntil = 0
      log({ event: 'batch_pause_finished', queueDepth: depth() })
    }
    return Math.max(blockedUntil, batchPausedUntil, now)
  }
  const snapshot = () => {
    const now = Date.now()
    const availableAt = nextAt(now)
    return {
      state: blockedUntil > now ? 'cooldown' : depth() ? 'queued' : 'ready',
      waiting: depth(),
      availableAt: availableAt > now ? new Date(availableAt).toISOString() : null,
      waitMs: Math.max(0, availableAt - now)
    }
  }
  function wake(at: number) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; pump() }, Math.max(1, at - Date.now()))
  }
  function pump() {
    if (busy || !depth()) return
    const now = Date.now()
    const availableAt = nextAt(now)
    if (availableAt > now) {
      wake(availableAt)
      return
    }
    const item = queue.shift()!
    batchCount += 1
    if (batchCount >= maxStarts) {
      batchPausedUntil = now + windowMs
      log({ event: 'batch_pause_started', queueDepth: depth(), waitMs: windowMs })
    }
    busy = true
    const startedAt = Date.now()
    log({ event: 'request_dispatched', kind: item.kind, queueDepth: depth() })
    void item.action().then(value => {
      log({ event: 'request_succeeded', kind: item.kind, durationMs: Date.now() - startedAt })
      item.resolve(value)
    }, error => {
      const status = Number(error?.response?.status)
      log({ event: 'request_failed', kind: item.kind, durationMs: Date.now() - startedAt,
        ...(Number.isFinite(status) ? { status } : {}) })
      item.reject(error)
    }).finally(() => { busy = false; pump() })
  }
  function schedule<T>(kind: Kind, action: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push({ kind, action, resolve, reject })
      log({ event: 'request_queued', kind, queueDepth: depth(), waitMs: snapshot().waitMs })
      pump()
    })
  }
  function rateLimited(waitMs = cooldownMs) {
    const safeWait = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : cooldownMs
    blockedUntil = Math.max(blockedUntil, Date.now() + safeWait)
    log({ event: 'cooldown_started', status: 429, queueDepth: depth(), waitMs: safeWait })
    if (depth()) wake(blockedUntil)
  }
  return { rateLimited, schedule, snapshot }
}
const sharedNocoRequestLimiter = createNocoRequestLimiter()
module.exports = { createNocoRequestLimiter, sharedNocoRequestLimiter }
