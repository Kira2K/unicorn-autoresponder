import type { ConnectionInviterService } from './connection-inviter-types.ts'

export function createMockConnectionInviterService(): ConnectionInviterService {
  const runs = new Map<string, any>()
  const stacks = [{ id: 10, name: 'FRONTEND' }, { id: 11, name: 'PYTHON' },
    { id: 12, name: 'DATA' }, { id: 13, name: 'GO' }, { id: 14, name: 'QA' }]
  const selected = new Map<number, { id: number; name: string }>()
  const latest = (id: number) => [...runs.values()].find(run => run.platformAccountId === id)
  return {
    async list() { return [...runs.values()].map(run => structuredClone(run)) },
    async get(runId) { const run = runs.get(runId); return run && structuredClone(run) },
    async history(platformAccountId) {
      const run = latest(platformAccountId)
      return run?.counters?.sent ? [{ personId: 'ACoMock', audience: 'recruiter', name: 'Mock Recruiter',
        headline: 'Technical Recruiter', location: 'Berlin', status: 'sent',
        reasonCode: 'pending_readback_confirmed', sentAt: run.finishedAt }] : []
    },
    async stacks() { return structuredClone(stacks) },
    async readiness(platformAccountId) {
      const stack = selected.get(platformAccountId) ?? (platformAccountId === 203 ? stacks[0] : undefined)
      return { platformAccountId, stackId: stack?.id, stack: stack?.name, ready: Boolean(stack),
        safeRecruiterOnlyAvailable: !stack, latest: latest(platformAccountId) }
    },
    async saveStack(platformAccountId, stackId) {
      const stack = stacks.find(item => item.id === stackId)
      if (!stack) throw Object.assign(new Error('Stack not found.'), { code: 'noco_stack_not_found' })
      selected.set(platformAccountId, stack)
      return { platformAccountId, stackId, stack: stack.name, ready: true,
        safeRecruiterOnlyAvailable: false }
    },
    async start(platformAccountId, input = {}) {
      const existing = latest(platformAccountId); if (existing) return structuredClone(existing)
      const stack = selected.get(platformAccountId) ?? (platformAccountId === 203 ? stacks[0] : undefined)
      const now = new Date().toISOString(); const run = {
        runId: `connections-${platformAccountId}`, runKey: `${platformAccountId}:${now.slice(0, 10)}`,
        platformAccountId, clientName: 'Test Client', stack: stack?.name,
        safeRecruiterOnly: !stack && input.safeRecruiterOnly === true, localDate: now.slice(0, 10),
        weekKey: now.slice(0, 10), status: !stack && !input.safeRecruiterOnly ? 'paused' : 'succeeded',
        stage: !stack && !input.safeRecruiterOnly ? 'stack_required' : 'completed',
        connectionCount: 320, dailyLimit: 11, dailyQuota: stack ? 11 : 8,
        audienceQuota: { recruiter: 8, technical: stack ? 3 : 0 },
        counters: { searched: 5, discovered: 20, eligible: 11, sent: stack ? 11 : 8, skipped: 4 },
        usedSearchKeys: ['recruiter-berlin', ...(stack ? ['technical-barcelona'] : [])],
        createdAt: now, updatedAt: now, finishedAt: now
      }
      runs.set(run.runId, run); return structuredClone(run)
    }
  }
}
