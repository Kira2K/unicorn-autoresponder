const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string,
    details?: Record<string, string | number>) => Error
}
const { nocoErrorCode } = require('../../../integrations/noco/core/error-policy.ts') as
  typeof import('../../../integrations/noco/core/error-policy.ts')

function linkedInNocoError(error: any): unknown {
  const code = nocoErrorCode(error)
  if (code) {
    return new LinkedInAuthError(
      code,
      code === 'noco_rate_limited'
        ? 'NocoDB request limit was reached. Wait a minute and retry.'
        : 'NocoDB is temporarily unavailable. Wait a minute and retry.',
      error?.details
    )
  }
  return error
}

module.exports = { linkedInNocoError }
