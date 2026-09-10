export function providerDelayMs(error: unknown) {
  if (!error || typeof error !== 'object') return 0
  const details = (error as { details?: { retryAfterMs?: number; httpStatus?: number } }).details
  if (Number.isFinite(details?.retryAfterMs)) return Math.max(0, details!.retryAfterMs!)
  const code = String((error as { code?: string }).code ?? '')
  return details?.httpStatus === 429 || /429|too_many_requests/.test(code) ? 30_000 : 0
}
