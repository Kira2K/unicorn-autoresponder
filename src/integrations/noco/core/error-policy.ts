const TRANSPORT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'])
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'])

function responseHeader(error: any, name: string): string {
  const headers = error?.response?.headers
  if (!headers) return ''
  const matchingKey = Object.keys(headers)
    .find(key => key.toLowerCase() === name.toLowerCase())
  const value = headers.get?.(name) ?? headers[name] ?? headers[name.toLowerCase()] ??
    (matchingKey ? headers[matchingKey] : undefined)
  return String(value ?? '').trim()
}

export function nocoRetryAfterMs(error: any, timestamp = Date.now()): number | undefined {
  const value = responseHeader(error, 'retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - timestamp) : undefined
}

export function nocoErrorCode(error: any): string | undefined {
  const existing = String(error?.code ?? '')
  if (existing.startsWith('noco_')) return existing
  const status = Number(error?.response?.status)
  const message = String(error?.response?.data?.message ?? error?.message ?? '')
  if (status === 429 || /too many requests/i.test(message)) return 'noco_rate_limited'
  if (status >= 500) return 'noco_service_unavailable'
  if (TRANSPORT_CODES.has(existing) || error?.name === 'TimeoutError') return 'noco_timeout'
  if (UNREACHABLE_CODES.has(existing)) return 'noco_unreachable'
  return undefined
}

export function normalizeNocoError(error: any): any {
  const code = nocoErrorCode(error)
  if (!code || String(error?.code ?? '').startsWith('noco_')) return error
  const httpStatus = Number(error?.response?.status)
  const retryAfterMs = nocoRetryAfterMs(error)
  return Object.assign(new Error(`NocoDB request failed (${code}).`), {
    code,
    cause: error,
    response: error?.response,
    details: {
      ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {})
    }
  })
}

export function isRetryableNocoRequest(error: any, method: string): boolean {
  if (method === 'post') return false
  const code = nocoErrorCode(error)
  return Boolean(code && ['noco_rate_limited', 'noco_timeout', 'noco_unreachable',
    'noco_service_unavailable'].includes(code))
}
