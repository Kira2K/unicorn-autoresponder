const { linkedinAuthErrorDisplay } = require('../../linkedin-automation/account-connection/error-display.ts') as {
  linkedinAuthErrorDisplay(code: unknown): any
}

type Account = import('../../linkedin-automation/account-connection/types.ts').LinkedInAuthAccountRow

function accountState(account: Account) {
  const code = account.readinessErrorCode || account.authErrorCode
  const error = linkedinAuthErrorDisplay(code)
  if (account.readinessErrorCode) return { state: 'attention', error }
  if (error) return { state: error.tone === 'danger' ? 'error' : 'attention', error }
  if (account.unipileAccountStatus === 'running' && account.lastVerifiedAt) {
    return { state: 'connected' }
  }
  if (account.unipileAccountId) return { state: 'attention' }
  return { state: 'not_connected' }
}

function publicLinkedInAccount(account: Account) {
  const { state: _state, error: _error, ...source } = account as Account & {
    state?: string
    error?: unknown
  }
  return { ...source, ...accountState(source) }
}

module.exports = { accountState, publicLinkedInAccount }
