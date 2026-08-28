import { nocoErrorCode } from '../../../integrations/noco/core/error-policy.ts'

const SAFE_PREFIXES = ['unipile_', 'openai_', 'comment_monitor_', 'linkedin_', 'noco_']

export function commentError(code: string, message: string, details?: unknown) {
  return Object.assign(new Error(message), { code, details })
}

export function commentErrorCode(error: unknown) {
  const code = nocoErrorCode(error) ?? String((error as any)?.code ?? '')
  return SAFE_PREFIXES.some(prefix => code.startsWith(prefix))
    ? code.slice(0, 120) : 'comment_monitor_internal_error'
}

export function errorLogDetails(error: unknown) {
  const source = error as any
  const details = source?.details ?? {}
  return {
    errorCode: commentErrorCode(error),
    ...(Number.isInteger(details.httpStatus) ? { httpStatus: details.httpStatus } : {}),
    ...(typeof details.requestId === 'string' ? { requestId: details.requestId } : {}),
    ...(Number.isFinite(details.retryAfterMs) ? { retryAfterMs: details.retryAfterMs } : {})
  }
}
