import type { ProfileLogger } from '../profile-logger.ts'

const retryLimit = (error: any) => String(error?.code) === 'openai_timeout' ? 1 : 2
const retryable = (error: any) => ['openai_timeout', 'openai_rate_limited',
  'openai_service_unavailable'].includes(String(error?.code ?? ''))

export async function withOpenAiRetry<T>(operation: () => Promise<T>, options: {
  logger: ProfileLogger
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
}) {
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise(resolve => setTimeout(resolve, milliseconds)))
  const random = options.random ?? Math.random
  const fallback = [10_000, 30_000]
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation() }
    catch (error: any) {
      if (!retryable(error) || attempt >= retryLimit(error)) throw error
      const supplied = Number(error?.details?.retryAfterMs)
      const base = Number.isFinite(supplied) ? supplied : fallback[attempt]
      const delayMs = Math.max(0, Math.round(base * (0.9 + random() * 0.2)))
      options.logger.event('openai_retry_scheduled', 'succeeded', {
        attempt: attempt + 1, maxAttempts: retryLimit(error), durationMs: delayMs,
        httpStatus: error?.details?.httpStatus
      })
      await sleep(delayMs)
      options.logger.event('openai_retry_attempt', 'started', { attempt: attempt + 1 })
    }
  }
}
