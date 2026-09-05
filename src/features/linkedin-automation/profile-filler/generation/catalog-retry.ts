import type { ProfileLogger } from '../profile-logger.ts'

export type CatalogRetry = {
  attempt: number
  nextRetryAt: string
}

const RETRYABLE_CODES = new Set([
  'unipile_api_too_many_requests', 'unipile_http_429', 'unipile_api_internal_error',
  'unipile_timeout', 'unipile_unreachable'
])

export function isRetryableCatalogFailure(error: any) {
  const status = Number(error?.details?.httpStatus)
  return RETRYABLE_CODES.has(String(error?.code ?? error ?? '')) || status >= 500
}

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
      if (!isRetryableCatalogFailure(error) || attempt >= fallback.length) {
        if (isRetryableCatalogFailure(error)) error.retryExhausted = true
        throw error
      }
      const supplied = Number(error?.details?.retryAfterMs)
      const hasProviderDelay = Number.isFinite(supplied) && supplied >= 0
      const base = hasProviderDelay ? supplied : fallback[attempt]
      const delayMs = hasProviderDelay
        ? Math.round(base)
        : Math.max(0, Math.round(base * (0.9 + random() * 0.2)))
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
