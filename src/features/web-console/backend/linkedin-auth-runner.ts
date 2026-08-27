const { runLinkedInAuth } = require('../../linkedin-automation/account-connection/auth-service.ts') as {
  runLinkedInAuth(input: any, dependencies: any): Promise<any>
}
const { createLinkedInAuthLogger } = require('../../linkedin-automation/account-connection/auth-logger.ts') as {
  createLinkedInAuthLogger(options?: any): import('../../linkedin-automation/account-connection/auth-logger.ts').AuthLogger
}
const { createLinkedInAuthDependencies } = require('../../linkedin-automation/account-connection/runtime.ts') as {
  createLinkedInAuthDependencies(options: any): any
}

type Action = import('./linkedin-auth-types.ts').LinkedInAuthAction
type AuthLogRecord = import('../../linkedin-automation/account-connection/auth-logger.ts').AuthLogRecord

function authInput(account: { clientName: string; platformAccountId: number }, action: Action) {
  return {
    clientName: account.clientName,
    platformAccountId: account.platformAccountId,
    apply: action !== 'check',
    forceReauth: action === 'force_reauth'
  }
}

async function runLocalLinkedInAuth(
  account: { clientName: string; platformAccountId: number },
  action: Action,
  onEvent: (event: AuthLogRecord) => void,
  repository?: any
) {
  const input = authInput(account, action)
  const logger = createLinkedInAuthLogger({ onEvent })
  return await runLinkedInAuth(
    input, createLinkedInAuthDependencies({ apply: input.apply, logger, repository })
  )
}

module.exports = { authInput, runLocalLinkedInAuth }
