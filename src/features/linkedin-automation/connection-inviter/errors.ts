export function connectionError(code: string, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
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
