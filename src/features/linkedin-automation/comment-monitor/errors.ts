import { listReadDiagnostic } from '../../../integrations/unipile/read-retry.ts'
const SAFE_PREFIXES = ['unipile_', 'openai_', 'comment_monitor_', 'comment_reply_', 'linkedin_', 'automation_']
export const commentExecutionInterrupted = (error: unknown) =>
  /^automation_/.test(commentErrorCode(error)) || commentErrorCode(error) === 'comment_monitor_persistence_unavailable'

export function commentError(code: string, message: string, details?: unknown) {
  return Object.assign(new Error(message), { code, details })
}

export function commentErrorCode(error: unknown) {
  const code = String((error as any)?.code ?? '')
  return SAFE_PREFIXES.some(prefix => code.startsWith(prefix))
    ? code.slice(0, 120) : 'comment_monitor_internal_error'
}

export function errorLogDetails(error: unknown) {
  const source = error as any
  const details = source?.details ?? {}
  return {
    errorCode: commentErrorCode(error),
    ...(listReadDiagnostic(error) ? { reasonCode: details.readFailure.reason,
      ...(Number.isSafeInteger(details.readFailure.page) ? { page: details.readFailure.page } : {}) } : {}),
    ...(Number.isInteger(details.httpStatus) ? { httpStatus: details.httpStatus } : {}),
    ...(typeof details.requestId === 'string' ? { requestId: details.requestId } : {}),
    ...(Number.isFinite(details.retryAfterMs) ? { retryAfterMs: details.retryAfterMs } : {})
  }
}
