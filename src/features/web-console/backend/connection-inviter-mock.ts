import type { ConnectionInviterService } from './connection-inviter-types.ts'

export function createMockConnectionInviterService(): ConnectionInviterService {
  const runs = new Map<string, any>()
  const listeners = new Map<string, Set<(event: any) => void>>()
  const completionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let sequence = 0
  const stacks = [{ id: 10, name: 'FRONTEND' }, { id: 11, name: 'PYTHON' },
    { id: 12, name: 'DATA' }, { id: 13, name: 'GO' }, { id: 14, name: 'QA' }]
  const selected = new Map<number, { id: number; name: string }>()
  const latest = (id: number) => [...runs.values()].find(run => run.platformAccountId === id)
  const emit = (run: any, type: string) => {
    const event = { id: ++sequence, type, at: new Date().toISOString(), run: structuredClone(run) }
    for (const listener of listeners.get(run.runId) ?? []) listener(event)
  }
  const scheduleCompletion = (run: any, stack: { id: number; name: string } | undefined) => {
    clearTimeout(completionTimers.get(run.runId))
    completionTimers.set(run.runId, setTimeout(() => {
      completionTimers.delete(run.runId)
      if (run.status !== 'running') return
      run.status = 'succeeded'; run.stage = 'completed'; run.finishedAt = new Date().toISOString()
      run.counters = { searched: 5, discovered: 20, eligible: 11,
        sent: stack ? 11 : 8, skipped: 4,
        sentByAudience: { recruiter: 8, technical: stack ? 3 : 0 } }
      run.searchProgress = { ...run.searchProgress,
        keyIndex: { recruiter: 3, technical: stack ? 2 : 0 }, found: 20,
        checked: 20, eligible: 11, skipped: 4 }
      emit(run, 'completed')
    }, 1_000))
  }
  return {
    settings() { return { writerEnabled: true } },
    async list() { return [...runs.values()].map(run => structuredClone(run)) },
    async get(runId) { const run = runs.get(runId); return run && structuredClone(run) },
    async stopRun(runId) {
      const run = runs.get(runId)
      if (!run) throw Object.assign(new Error('Run not found.'), { code: 'connection_run_not_found' })
      if (run.status === 'running') {
        clearTimeout(completionTimers.get(run.runId)); completionTimers.delete(run.runId)
        run.status = 'stopped'; run.stage = 'stopped_by_admin'; emit(run, 'stopped')
      }
      return structuredClone(run)
    },
    subscribe(runId, listener) {
      const bucket = listeners.get(runId) ?? new Set()
      bucket.add(listener); listeners.set(runId, bucket)
      return () => { bucket.delete(listener); if (!bucket.size) listeners.delete(runId) }
    },
    async history(platformAccountId) {
      const run = latest(platformAccountId)
      const recruiter = Number(run?.counters?.sentByAudience?.recruiter || 0)
      const technical = Number(run?.counters?.sentByAudience?.technical || 0)
      return Array.from({ length: recruiter + technical }, (_, index) => ({
        runId: run.runId, personId: `ACoMock${index}`,
        audience: index < recruiter ? 'recruiter' : 'technical', name: `Mock Candidate ${index + 1}`,
        headline: index < recruiter ? 'Technical Recruiter' : 'Software Engineer',
        location: 'Berlin', status: 'sent', reasonCode: 'pending_readback_confirmed',
        sentAt: run.finishedAt, updatedAt: run.finishedAt
      }))
    },
    async stacks() { return structuredClone(stacks) },
    async readiness(platformAccountId) {
      const stack = selected.get(platformAccountId) ?? (platformAccountId === 203 ? stacks[0] : undefined)
      return { platformAccountId, stackId: stack?.id, stack: stack?.name, ready: Boolean(stack),
        writerEnabled: true, sevenDaySent: 0,
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
      const existing = latest(platformAccountId)
      const stack = selected.get(platformAccountId) ?? (platformAccountId === 203 ? stacks[0] : undefined)
      if (existing) {
        if (existing.status !== 'running' && Number(existing.counters?.sent || 0) <
          Number(existing.dailyQuota || 0)) {
          existing.status = 'running'; existing.stage = 'searching'; existing.finishedAt = undefined
          emit(existing, 'stage_changed'); scheduleCompletion(existing, stack)
        }
        return structuredClone(existing)
      }
      const now = new Date().toISOString()
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
      const run: any = {
        runId: `connections-${platformAccountId}`, runKey: `${platformAccountId}:${localDate}`,
        platformAccountId, clientName: 'Test Client', stack: stack?.name,
        safeRecruiterOnly: !stack && input.safeRecruiterOnly === true, localDate,
        weekKey: localDate, status: !stack && !input.safeRecruiterOnly ? 'paused' : 'running',
        stage: !stack && !input.safeRecruiterOnly ? 'stack_required' : 'searching',
        connectionCount: 320, dailyLimit: 11, dailyQuota: stack ? 11 : 8,
        audienceQuota: { recruiter: 8, technical: stack ? 3 : 0 },
        counters: { searched: 0, discovered: 0, eligible: 0, sent: 0, skipped: 0,
          sentByAudience: { recruiter: 0, technical: 0 } },
        searchProgress: { keyIndex: { recruiter: 0, technical: 0 },
          keyTotal: { recruiter: 200, technical: stack ? 200 : 0 }, page: 1,
          found: 0, checked: 0, eligible: 0, skipped: 0, pendingCandidates: [] },
        skipReasonCounters: {},
        usedSearchKeys: ['recruiter-berlin', ...(stack ? ['technical-barcelona'] : [])],
        createdAt: now, updatedAt: now
      }
      runs.set(run.runId, run)
      if (run.status === 'running') scheduleCompletion(run, stack)
      return structuredClone(run)
    }
  }
}
