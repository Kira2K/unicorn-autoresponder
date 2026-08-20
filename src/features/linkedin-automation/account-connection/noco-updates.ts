function authTimestamp(now: () => Date): string {
  return now().toISOString()
}

function successPatch(input: {
  accountId: string
  accountStatus: string
  providerId: string
  profileUrl: string
  profileName: string
  now?: () => Date
}) {
  const at = authTimestamp(input.now ?? (() => new Date()))
  return {
    unipile_account_id: input.accountId,
    unipile_account_status: input.accountStatus,
    linkedin_verified_provider_id: input.providerId,
    linkedin_verified_profile_url: input.profileUrl,
    linkedin_verified_profile_name: input.profileName,
    linkedin_last_verified_at: at,
    linkedin_auth_error_code: '',
    linkedin_auth_updated_at: at
  }
}

function failurePatch(input: {
  errorCode: string
  accountStatus?: string
  now?: () => Date
}) {
  return {
    ...(input.accountStatus ? { unipile_account_status: input.accountStatus } : {}),
    linkedin_auth_error_code: input.errorCode,
    linkedin_auth_updated_at: authTimestamp(input.now ?? (() => new Date()))
  }
}

module.exports = { failurePatch, successPatch }
