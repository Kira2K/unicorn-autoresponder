import { setTimeout as pause } from 'node:timers/promises'
import * as controlModule from './request-control.ts'
const { hasAccountRequestQueue } = (controlModule as any).default ?? controlModule
type Sleep = (milliseconds: number) => Promise<void>

// One physical request at a time per account, shared by every feature/client in the backend.
// Permission checks run after waiting; spacing is counted from dispatch, never added to elapsed waits.
export function createAccountRequestQueue(options: { now?: () => number; random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {}) {
  const now = options.now ?? Date.now, random = options.random ?? Math.random
  const sleep = options.sleep ?? ((ms, signal) => pause(ms, undefined, { signal }))
  const queues = new Map<string, { tail: Promise<void>; nextAt: number; pending: number }>()
  const stopped = () => Object.assign(new Error('Запрос отменён до отправки.'),
    { code: 'automation_stop_requested', notSent: true })
  return {
    run<T>(account: string, action: () => Promise<T>, request: { prepare?(): Promise<void>;
      signal?: AbortSignal; onWait?(until: number): Promise<void>;
      waitForRequest?<R>(action: () => Promise<R>): Promise<R> } = {}): Promise<T> {
      for (const [key, value] of queues) if (!value.pending && value.nextAt <= now()) queues.delete(key)
      const queue = queues.get(account) ?? { tail: Promise.resolve(), nextAt: 0, pending: 0 }
      queues.set(account, queue); queue.pending++
      const check = () => { if (request.signal?.aborted) throw stopped() }
      const previous = queue.tail
      const waitForTurn = async () => {
        try {
          await previous
          check()
          if (queue.nextAt > now()) {
            await request.onWait?.(queue.nextAt)
            try { await sleep(Math.max(0, queue.nextAt - now()), request.signal) }
            catch (error) { check(); throw error }
          }
          check()
        } catch (error: any) {
          throw Object.assign(error instanceof Error ? error : new Error('Request blocked.'), { notSent: true })
        }
      }
      const ready = Promise.resolve().then(() => request.waitForRequest ? request.waitForRequest(waitForTurn) : waitForTurn())
      const result = ready.then(async () => {
        try { check(); await request.prepare?.(); check() }
        catch (error: any) {
          throw Object.assign(error instanceof Error ? error : new Error('Request blocked.'), { notSent: true })
        }
        const value = random(), fraction = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
        queue.nextAt = now() + 10_000 + Math.floor(fraction * 10_000)
        return action()
      }).finally(() => { queue.pending-- })
      queue.tail = result.then(() => undefined, () => undefined)
      return result
    }
  }
}

export function createUnipileRequestScheduler(options: {
  minIntervalMs?: number | (() => number)
  now?: () => number
  sleep?: Sleep
} = {}) {
  const minIntervalMs = options.minIntervalMs ?? 5_000
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise(resolve => setTimeout(resolve, milliseconds)))
  let tail = Promise.resolve()
  let lastStartedAt = 0

  function run<T>(operation: () => Promise<T>) {
    // The HTTP boundary now owns pacing. Keeping this feature-local FIFO would
    // hold other accounts behind a queued request and create a second timer.
    if (hasAccountRequestQueue()) return operation()
    const queued = tail.then(async () => {
      const intervalMs = typeof minIntervalMs === 'function' ? minIntervalMs() : minIntervalMs
      const waitMs = Math.max(0, lastStartedAt + intervalMs - now())
      if (waitMs) await sleep(waitMs)
      lastStartedAt = now()
      return operation()
    })
    tail = queued.then(() => undefined, () => undefined)
    return queued
  }
  return { run }
}
