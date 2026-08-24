const SAFE_CODES = new Set([
  'linkedin_account_not_found', 'profile_filler_auth_required', 'profile_validation_failed',
  'profile_job_not_found', 'profile_job_not_ready', 'profile_plan_hash_mismatch',
  'profile_entry_ambiguous', 'profile_entry_id_missing',
  'linkedin_operation_active', 'linkedin_profile_jobs_table_missing',
  'noco_rate_limited',
  'unipile_account_locked', 'unipile_provider_mismatch', 'linkedin_provider_id_mismatch'
])

export function codedError(code: string, message: string, details?: unknown) {
  return Object.assign(new Error(message), { code, details })
}

export function profileErrorCode(error: unknown) {
  const raw = String((error as any)?.code ?? '')
  if (SAFE_CODES.has(raw) || raw.startsWith('unipile_')) return raw.slice(0, 120)
  return 'profile_filler_internal_error'
}

export function profileErrorDetails(error: unknown) {
  const details = (error as any)?.details
  return {
    errorCode: profileErrorCode(error),
    ...(Number.isInteger(details?.httpStatus) ? { httpStatus: details.httpStatus } : {}),
    ...(typeof details?.requestId === 'string' ? { requestId: details.requestId } : {}),
    ...(typeof details?.diagnostic === 'string' ? { diagnostic: details.diagnostic } : {})
  }
}
