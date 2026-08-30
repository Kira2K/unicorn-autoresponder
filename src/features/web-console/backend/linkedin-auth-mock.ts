const { publicLinkedInAccount } = require('./linkedin-auth-account-view.ts') as {
  publicLinkedInAccount(account: any): any
}

function createMockLinkedInAuthRunService(): import('./linkedin-auth-types.ts').LinkedInAuthRunService {
  const accounts = [
    {
      platformAccountId: 103, clientId: 1, clientName: 'Test Client',
      linkedinUrl: '', dolphinProfileId: 111111112,
      readinessErrorCode: 'linkedin_url_missing', unipileAccountStatus: '', authErrorCode: ''
    },
    {
      platformAccountId: 203, clientId: 2, clientName: 'Connected Client',
      linkedinUrl: 'https://www.linkedin.com/in/connected-client/', dolphinProfileId: 333333333,
      unipileAccountId: 'acc_mock', unipileAccountStatus: 'running',
      lastVerifiedAt: '2026-08-20T10:00:00.000Z'
    },
    {
      platformAccountId: 303, clientId: 3, clientName: 'Proxy Error Client',
      linkedinUrl: 'https://www.linkedin.com/in/proxy-error/', dolphinProfileId: 444444444,
      authErrorCode: 'dolphin_proxy_unhealthy', authUpdatedAt: '2026-08-20T11:00:00.000Z'
    }
  ].map(publicLinkedInAccount)
  const runs = new Map<string, any>()
  const history: any[] = [{
    runId: 'mock-history-1', platformAccountId: 203, clientName: 'Connected Client',
    action: 'connect', status: 'succeeded', stage: 'completed',
    startedAt: '2026-08-20T10:00:00.000Z', finishedAt: '2026-08-20T10:00:04.000Z'
  }, {
    runId: 'mock-history-url', platformAccountId: 103, clientName: 'Test Client',
    action: 'check', status: 'failed', stage: 'target_resolved', errorCode: 'linkedin_url_invalid',
    startedAt: '2026-08-20T09:00:00.000Z', finishedAt: '2026-08-20T09:00:01.000Z'
  }, {
    runId: 'mock-history-reconnect', platformAccountId: 203, clientName: 'Connected Client',
    action: 'connect', status: 'failed', stage: 'profile_started', errorCode: 'dolphin_local_api_unavailable',
    startedAt: '2026-08-20T08:00:00.000Z', finishedAt: '2026-08-20T08:00:01.000Z'
  }]
  let active = false

  return {
    async listAccounts() { return JSON.parse(JSON.stringify(accounts)) },
    async listHistory() { return JSON.parse(JSON.stringify(history)) },
    async updateAccount(platformAccountId, input) {
      const account = accounts.find(row => row.platformAccountId === platformAccountId)
      if (!account) throw Object.assign(new Error('Not found'), { code: 'linkedin_account_not_found' })
      account.linkedinUrl = String(input.linkedinUrl)
      account.readinessErrorCode = undefined
      Object.assign(account, publicLinkedInAccount(account))
      return JSON.parse(JSON.stringify(account))
    },
    async start(platformAccountId, action) {
      if (active) throw Object.assign(new Error('Active run'), { code: 'linkedin_auth_run_active' })
      const account = accounts.find(row => row.platformAccountId === platformAccountId)
      if (!account) throw Object.assign(new Error('Not found'), { code: 'linkedin_account_not_found' })
      active = true
      const now = new Date().toISOString()
      const run = {
        runId: `mock-${Date.now()}`, platformAccountId, clientName: account.clientName, action,
        status: 'running', stage: 'profile_started', stageStatus: 'started',
        startedAt: now, updatedAt: now
      }
      runs.set(run.runId, run)
      setTimeout(() => {
        Object.assign(run, {
          status: 'succeeded', stage: 'completed', stageStatus: 'succeeded',
          finishedAt: new Date().toISOString(), result: { mode: action === 'check' ? 'dry-run' : 'connected' }
        })
        active = false
        history.unshift(JSON.parse(JSON.stringify(run)))
      }, 25)
      return JSON.parse(JSON.stringify(run))
    },
    get(runId) {
      const run = runs.get(runId)
      return run && JSON.parse(JSON.stringify(run))
    }
  }
}

module.exports = { createMockLinkedInAuthRunService }
