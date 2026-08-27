const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}

function linkedInNocoError(error: any): unknown {
  if (error?.response?.status === 429) {
    return new LinkedInAuthError(
      'noco_rate_limited',
      'NocoDB request limit was reached. Wait a minute and retry.'
    )
  }
  return error
}

module.exports = { linkedInNocoError }
