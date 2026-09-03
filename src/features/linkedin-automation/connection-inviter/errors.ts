export function connectionError(code: string, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
}

const PROVIDER_TIMEOUT_CODES = new Set([
  'ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'
])
const PROVIDER_UNREACHABLE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'
])

export function normalizeConnectionProviderError(provider: 'noco' | 'unipile', error: any) {
  const code = String(error?.code ?? '')
  if (code.startsWith(`${provider}_`)) return error
  const normalizedCode = PROVIDER_TIMEOUT_CODES.has(code)
    ? `${provider}_timeout`
    : PROVIDER_UNREACHABLE_CODES.has(code) ? `${provider}_unreachable` : undefined
  if (!normalizedCode) return error
  return Object.assign(new Error(`${provider} request failed (${normalizedCode}).`), {
    code: normalizedCode,
    cause: error,
    details: error?.details
  })
}

export function connectionErrorCode(error: unknown): string {
  const code = String((error as any)?.code ?? '')
  return /^(connection_|linkedin_|unipile_|noco_)/.test(code) ? code.slice(0, 120) :
    'connection_inviter_internal_error'
}

export function transientConnectionError(error: any): boolean {
  const code = connectionErrorCode(error)
  const status = Number(error?.details?.httpStatus ?? error?.response?.status)
  return ['noco_rate_limited', 'noco_timeout', 'noco_unreachable', 'noco_service_unavailable',
    'noco_http_429', 'noco_http_502', 'noco_http_503', 'noco_http_504',
    'unipile_timeout', 'unipile_unreachable', 'unipile_rate_limit'].includes(code) ||
    ((code.startsWith('unipile_') || code.startsWith('noco_')) &&
      (status === 429 || (status >= 500 && status <= 599)))
}

export function connectionHttpStatus(error: any): number | undefined {
  const status = Number(error?.details?.httpStatus ?? error?.response?.status ?? error?.status)
  return Number.isInteger(status) ? status : undefined
}

export type UnipileRateLimitSource = 'api' | 'provider' | 'unknown'

export function unipileRateLimitSource(error: unknown): UnipileRateLimitSource | undefined {
  const code = connectionErrorCode(error)
  if (code === 'unipile_provider_too_many_requests') return 'provider'
  if (code === 'unipile_api_too_many_requests') return 'api'
  const rateLimited = connectionHttpStatus(error) === 429 ||
    code.includes('too_many_requests') || code.includes('rate_limit')
  return rateLimited ? 'unknown' : undefined
}
