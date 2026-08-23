const crypto = require('node:crypto')
const { createLinkedInAuthNocoRepository } = require('../../linkedin-automation/account-connection/noco-repository.ts') as {
  createLinkedInAuthNocoRepository(): any
}
const { createLinkedInAuthHistoryStore } = require('./linkedin-auth-history-store.ts') as {
  createLinkedInAuthHistoryStore(): any
}
const { executeLinkedInAuthRun } = require('./linkedin-auth-run-execution.ts') as {
  executeLinkedInAuthRun(options: any): void
}
const { publicLinkedInAccount } = require('./linkedin-auth-account-view.ts') as {
  publicLinkedInAccount(account: any): Record<string, unknown>
}
const { runLocalLinkedInAuth } = require('./linkedin-auth-runner.ts') as {
  runLocalLinkedInAuth(
    account: any, action: any, onEvent: (event: any) => void, repository?: any
  ): Promise<any>
}

type Action = import('./linkedin-auth-types.ts').LinkedInAuthAction
type Run = import('./linkedin-auth-types.ts').LinkedInAuthRun
const ACTIONS = new Set<Action>(['check', 'connect', 'force_reauth'])

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

function createLinkedInAuthRunService(options: {
  repository?: any
  execute?: typeof runLocalLinkedInAuth
  history?: any
} = {}): import('./linkedin-auth-types.ts').LinkedInAuthRunService {
  let repository = options.repository
  let history = options.history
  const getRepository = () => repository ??= createLinkedInAuthNocoRepository()
  const getHistory = () => history ??= createLinkedInAuthHistoryStore()
  const execute = options.execute ?? runLocalLinkedInAuth
  const runs = new Map<string, Run>()
  let activeRunId = ''

  function publicRun(run: Run): Run {
    return JSON.parse(JSON.stringify(run))
  }
  function update(run: Run, patch: Partial<Run>) {
    Object.assign(run, patch, { updatedAt: new Date().toISOString() })
  }

  async function listAccounts() {
    return (await getRepository().listAccounts()).map(publicLinkedInAccount)
  }
  async function listHistory() { return await getHistory().list() }
  async function updateAccount(platformAccountId: number, input: { linkedinUrl: unknown }) {
    if (activeRunId) throw codedError('linkedin_auth_run_active', 'Another LinkedIn run is active.')
    await getRepository().updateLinkedInUrl(platformAccountId, input.linkedinUrl)
    const account = (await getRepository().listAccounts())
      .find((row: any) => Number(row.platformAccountId) === platformAccountId)
    if (!account) throw codedError('linkedin_account_not_found', 'LinkedIn account was not found.')
    return publicLinkedInAccount(account)
  }

  async function start(platformAccountId: number, action: Action) {
    if (!ACTIONS.has(action)) throw codedError('linkedin_auth_action_invalid', 'Invalid action.')
    if (activeRunId) throw codedError('linkedin_auth_run_active', 'Another LinkedIn run is active.')
    const account = (await getRepository().listAccounts())
      .find((row: any) => Number(row.platformAccountId) === platformAccountId)
    if (!account) throw codedError('linkedin_account_not_found', 'LinkedIn account was not found.')
    const now = new Date().toISOString()
    const run: Run = {
      runId: crypto.randomUUID(), platformAccountId, clientName: account.clientName, action,
      status: 'running', stage: 'queued', stageStatus: 'started', startedAt: now, updatedAt: now
    }
    runs.set(run.runId, run)
    activeRunId = run.runId
    executeLinkedInAuthRun({
      account, action, execute, history: getHistory(), repository: getRepository(), run, update,
      onDone: () => { activeRunId = '' }
    })
    while (runs.size > 100) {
      const oldest = runs.keys().next().value
      if (oldest) runs.delete(oldest)
    }
    return publicRun(run)
  }

  return {
    listAccounts, listHistory, updateAccount, start,
    get: runId => runs.get(runId) && publicRun(runs.get(runId)!)
  }
}

module.exports = { createLinkedInAuthRunService }
