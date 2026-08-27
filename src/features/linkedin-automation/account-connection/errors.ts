class LinkedInAuthError extends Error {
  code: string
  details?: Record<string, string | number>

  constructor(code: string, message: string, details?: Record<string, string | number>) {
    super(message)
    this.name = 'LinkedInAuthError'
    this.code = code
    this.details = details
  }
}

function safeErrorCode(value: unknown, fallback = 'linkedin_auth_failed'): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || fallback
}

function getAuthErrorCode(error: unknown): string {
  return error instanceof LinkedInAuthError
    ? error.code
    : 'linkedin_auth_internal_error'
}

function formatSafeAuthError(error: unknown): string {
  if (error instanceof LinkedInAuthError) {
    return `${error.code}: ${error.message}`
  }

  return 'linkedin_auth_internal_error: LinkedIn authentication failed unexpectedly.'
}

module.exports = {
  LinkedInAuthError,
  formatSafeAuthError,
  getAuthErrorCode,
  safeErrorCode
}
