const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}

function diagnostic(error: any): string {
  return [
    error?.message,
    error?.details?.error,
    error?.details?.message,
    error?.cause?.message
  ].filter(Boolean).join(' ').toLowerCase()
}

function linkedInDolphinLocalError(error: unknown): unknown {
  if (error instanceof LinkedInAuthError) return error
  const message = diagnostic(error)
  if (
    message.includes('invalid session token') ||
    message.includes('token refresh timeout') ||
    message.includes('refresh token') ||
    message.includes('unauthorized')
  ) {
    return new LinkedInAuthError(
      'dolphin_local_session_invalid',
      'Dolphin Local API session is invalid.'
    )
  }
  if (
    message.includes('fetch failed') ||
    message.includes('econnrefused') ||
    message.includes('not reachable') ||
    message.includes('port 3001')
  ) {
    return new LinkedInAuthError(
      'dolphin_local_api_unavailable',
      'Dolphin Local API is unavailable.'
    )
  }
  return error
}

module.exports = { linkedInDolphinLocalError }
