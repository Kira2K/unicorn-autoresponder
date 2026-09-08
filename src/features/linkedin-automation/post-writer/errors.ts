export class PostError extends Error {
  code: string
  retryAfterMs?: number
  httpStatus?: number
  constructor(code: string, retryAfterMs?: number, httpStatus?: number) {
    super(code)
    this.code = code
    this.retryAfterMs = retryAfterMs
    this.httpStatus = httpStatus
  }
}
export function errorCode(error: unknown): string {
  const value = error as { code?: unknown }
  return typeof value?.code === 'string' && /^[a-z0-9_/-]+$/i.test(value.code)
    ? value.code : 'post_writer_error'
}
export function retryDelay(error: unknown): number | undefined {
  const value = error as { httpStatus?: number; retryAfterMs?: number; details?: {
    httpStatus?: number; retryAfterMs?: number } }
  const delay = value?.retryAfterMs ?? value?.details?.retryAfterMs
  if (Number.isFinite(delay)) return Math.max(1000, Number(delay))
  const status = value?.httpStatus ?? value?.details?.httpStatus
  return status === 429 ? 30_000 : status && status >= 500 ? 60_000 : undefined
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PostError('invalid_shape')
  return value as Record<string, unknown>
}
