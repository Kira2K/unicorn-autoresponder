import { CONNECTION_SEARCH_CATALOG, renderSearchKeywords } from '../catalog.ts'
import { createMemoryConnectionInviterStore } from '../memory-store.ts'

export function fixture(options: { stack?: string; sendFailure?: any; pendingReadFailure?: any;
  stablePeople?: boolean; preflightRejectCount?: number; connectionCount?: number } =
  { stack: 'Frontend' }) {
  const pending = new Set<string>(); let person = 0; let sends = 0; let reads = 0
  let profileReads = 0
  let pendingReadFailure = options.pendingReadFailure
  const account = { platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', unipileAccountId: 'acc_test',
    unipileAccountStatus: 'running', lastVerifiedAt: '2026-08-20T00:00:00Z',
    verifiedProviderId: 'ACoOwner', ...(options.stack ? { primaryStackId: 10,
      primaryStack: options.stack } : {}) }
  const repository = {
    async listAccounts() { return [account] },
    async listStacks() { return [{ id: 10, name: 'Frontend' }] },
    async updatePrimaryStack() { account.primaryStackId = 10; account.primaryStack = 'Frontend'
      return { id: 10, name: 'Frontend' } }
  }
  const adapter = {
    async getAccount() { reads += 1; return { provider: 'linkedin', status: 'running',
      is_locked: false, user_id: 'ACoOwner' } },
    async getOwnProfile() { reads += 1; return { public_identifier: 'test-client',
      provider_id: 'ACoOwner', connections_count: options.connectionCount ?? 300 } },
    async getProfile() { reads += 1; profileReads += 1
      return { network_distance: profileReads <= (options.preflightRejectCount ?? 0) ? 1 : 2 } },
    async searchPeople(_accountId: string, keywords: string) {
      reads += 1
      const template = CONNECTION_SEARCH_CATALOG.find(item =>
        renderSearchKeywords(item, options.stack, !options.stack) === keywords)!
      return { items: Array.from({ length: 4 }, (_value, index) => { person += 1
        const personId = options.stablePeople ?
          `ACo_${template.audience}_${template.priority}_${index}` : `ACo${person}`
        return {
          id: personId, display_name: `Person ${personId}`,
          headline: template.audience === 'recruiter' ? 'Technical Recruiter' :
            `${options.stack} Software Engineer`, location: `${template.city}, Region`,
          network_distance: 2
        }
      }) }
    },
    async listPendingInvitations(_accountId: string, offset = 0) { reads += 1
      if (pendingReadFailure) { const error = pendingReadFailure; pendingReadFailure = undefined; throw error }
      return { items: [...pending].slice(offset).map(user_id => ({ user_id })) } },
    async sendInvitation(_accountId: string, personId: string) {
      sends += 1; if (options.sendFailure) throw options.sendFailure
      pending.add(personId); return { request_id: `request-${personId}` }
    }
  }
  return { adapter, repository, store: createMemoryConnectionInviterStore(), writerEnabled: true,
    logger: { event() {} },
    metrics: { get sends() { return sends }, get reads() { return reads } } }
}

export async function waitRun(service: any, runId: string) {
  for (let count = 0; count < 100; count += 1) {
    const run = await service.get(runId)
    if (run?.status !== 'running') return run
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Connection test run did not finish.')
}
