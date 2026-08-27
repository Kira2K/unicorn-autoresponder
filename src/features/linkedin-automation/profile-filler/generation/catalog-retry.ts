import type { ProfileLogger } from '../profile-logger.ts'

export type CatalogRetry = {
  attempt: number
  nextRetryAt: string
}

const retryable = (error: any) => [
  'unipile_api_too_many_requests', 'unipile_http_429',
  'unipile_timeout', 'unipile_unreachable'
].includes(String(error?.code ?? ''))

export async function withCatalogRetry<T>(operation: () => Promise<T>, options: {
  logger: ProfileLogger
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
  now?: () => number
  onRetry?: (retry: CatalogRetry) => Promise<void> | void
}) {
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise(resolve => setTimeout(resolve, milliseconds)))
  const random = options.random ?? Math.random
  const now = options.now ?? Date.now
  const fallback = [30_000, 60_000, 120_000]
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation() }
    catch (error: any) {
      if (!retryable(error) || attempt >= fallback.length) {
        if (retryable(error)) error.retryExhausted = true
        throw error
      }
      const supplied = Number(error?.details?.retryAfterMs)
      const base = Number.isFinite(supplied) ? supplied : fallback[attempt]
      const delayMs = Math.max(0, Math.round(base * (0.9 + random() * 0.2)))
      const retry = { attempt: attempt + 1,
        nextRetryAt: new Date(now() + delayMs).toISOString() }
      options.logger.event('unipile_retry_scheduled', 'succeeded', {
        attempt: retry.attempt, durationMs: delayMs, httpStatus: error?.details?.httpStatus
      })
      await options.onRetry?.(retry)
      await sleep(delayMs)
      options.logger.event('unipile_retry_attempt', 'started', { attempt: retry.attempt })
    }
  }
}
