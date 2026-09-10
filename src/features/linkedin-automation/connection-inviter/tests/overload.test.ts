const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

const busy = (status: number) => Object.assign(new Error(`busy ${status}`), {
  code: `unipile_http_${status}`, details: { httpStatus: status }
})
const apiBusy = () => Object.assign(new Error('Unipile API rate limit'), {
  code: 'unipile_api_too_many_requests', details: { httpStatus: 429 }
})

async function searchRetriesSameCursor() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const original = test.adapter.searchPeople
  const failures = [busy(429), busy(503), busy(429)]
  const failedCursors: Array<string | undefined> = []
  test.adapter.searchPeople = async (accountId: string, keywords: string, cursor?: string) => {
    if (!cursor) {
      const response = await original(accountId, keywords)
      return { ...response, items: response.items.slice(0, 1), next_cursor: 'same-cursor' }
    }
    if (failures.length) { failedCursors.push(cursor); throw failures.shift() }
    return original(accountId, keywords)
  }
  const retryDelays: number[] = []
  const persistedTimerDelays: number[] = []
  const updateRun = test.store.updateRun.bind(test.store)
  test.store.updateRun = async (run: any) => {
    if (run.timerState?.delayMs) persistedTimerDelays.push(run.timerState.delayMs)
    return updateRun(run)
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined, logger: { event(stage: string, status: string, details?: any) {
      if (stage === 'retry' && status === 'failed') retryDelays.push(details.delayMs)
    } } })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  const internal: any = await test.store.getRun(started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.deepEqual(failedCursors, ['same-cursor', 'same-cursor', 'same-cursor'])
  assert.deepEqual(retryDelays.slice(0, 3), [180_000, 90_000, 180_000])
  assert.equal(persistedTimerDelays.some(delay => delay >= 30 * 60_000), false)
  assert.equal(internal.searchProgress.recentSearchAt.length > completed.counters.searched, true)
}

async function invitation429ReadbackThenRetry() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const original = test.adapter.sendInvitation; let posts = 0
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    posts += 1
    if (posts === 1) throw apiBusy()
    return original(accountId, personId)
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.equal(posts, 6); assert.equal(test.metrics.sends, 5)
}

async function invitation429RearmRequiresFreshClaimReadback() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const originalSend = test.adapter.sendInvitation
  const originalUpdate = test.store.updateHistory.bind(test.store)
  const postsByPerson = new Map<string, number>()
  let firstPersonId = ''; let suppressRearmPatch = true
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    postsByPerson.set(personId, (postsByPerson.get(personId) ?? 0) + 1)
    if (!firstPersonId) { firstPersonId = personId; throw apiBusy() }
    return originalSend(accountId, personId)
  }
  test.store.updateHistory = async (item: any) => {
    if (suppressRearmPatch && item.personId === firstPersonId && item.status === 'sending') {
      suppressRearmPatch = false
      return
    }
    return originalUpdate(item)
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.equal(postsByPerson.get(firstPersonId), 1)
  assert.equal((await test.store.findHistory('acc_test', firstPersonId))?.status, 'deferred')
}

async function invitation429InvalidReadbackNeverRepeatsBlindly() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const originalSend = test.adapter.sendInvitation
  const originalPending = test.adapter.listPendingInvitations
  let posts = 0; let attemptedPersonId = ''; let invalidReads = 0
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    posts += 1; attemptedPersonId = personId
    if (posts === 1) throw apiBusy()
    return originalSend(accountId, personId)
  }
  test.adapter.listPendingInvitations = async (accountId: string, offset = 0) => {
    if (posts === 1 && invalidReads++ === 0) return { results: [] }
    if (posts === 1 && invalidReads === 2) return { items: [{ name: 'missing-id' }] }
    const response = await originalPending(accountId, offset)
    return offset === 0 && attemptedPersonId
      ? { items: [{ user_id: attemptedPersonId }, ...response.items] } : response
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.equal(posts, 5)
}

async function freshPendingAfterDelayBlocksPost() {
  const test = fixture({ stack: 'GO', connectionCount: 149, stablePeople: true })
  const originalSearch = test.adapter.searchPeople
  const originalPending = test.adapter.listPendingInvitations
  const originalProfile = test.adapter.getProfile
  const originalSend = test.adapter.sendInvitation
  const discovered: string[] = []; const externalPending = new Set<string>()
  const sentPersonIds: string[] = []
  test.adapter.searchPeople = async (...args: any[]) => {
    const response = await originalSearch(...args)
    for (const person of response.items) if (!discovered.includes(person.id)) discovered.push(person.id)
    return response
  }
  test.adapter.listPendingInvitations = async (accountId: string, offset = 0) => {
    const response = await originalPending(accountId, offset)
    return offset === 0 ? { items: [...response.items,
      ...[...externalPending].map(user_id => ({ user_id }))] } : response
  }
  test.adapter.getProfile = async (accountId: string, personId: string) => {
    const profile = await originalProfile(accountId, personId)
    return externalPending.has(personId) ? { ...profile, pending_invitation: true } : profile
  }
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    sentPersonIds.push(personId); return originalSend(accountId, personId)
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => {
      if (test.metrics.sends === 1 && discovered[1]) externalPending.add(discovered[1])
    } })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.equal(externalPending.size, 1)
  assert.equal(sentPersonIds.includes([...externalPending][0]), false)
}

async function freshRelationAfterClaimBlocksPost(kind: 'pending' | 'connected') {
  const test = fixture({ stack: 'GO', connectionCount: 149, stablePeople: true })
  test.store.listCatalog = async () => [{ sourceKey: 'recruiter-berlin-only',
    audience: 'recruiter', city: 'Berlin', keywordTemplate: 'Recruiter',
    priority: 1, enabled: true }] as any
  const originalSearch = test.adapter.searchPeople
  let emitted = false
  test.adapter.searchPeople = async (...args: any[]) => {
    if (emitted) return { items: [] }
    emitted = true
    const response = await originalSearch(...args)
    return { items: response.items.slice(0, 1) }
  }
  const originalClaim = test.store.claimHistory.bind(test.store)
  const originalPending = test.adapter.listPendingInvitations
  const originalProfile = test.adapter.getProfile
  let externalPersonId = ''; let relationInjected = false
  let releaseClaim!: () => void; let claimStarted!: () => void
  const startedClaim = new Promise<void>(resolve => { claimStarted = resolve })
  const blockedClaim = new Promise<void>(resolve => { releaseClaim = resolve })
  test.store.claimHistory = async (item: any) => {
    const result = await originalClaim(item)
    if (!externalPersonId) {
      externalPersonId = item.personId; claimStarted(); await blockedClaim
    }
    return result
  }
  test.adapter.listPendingInvitations = async (accountId: string, page: number | string = 0) => {
    if (externalPersonId && relationInjected && kind === 'pending') {
      if (page === 0) return { items: [{ user_id: 'other-pending' }], next_cursor: 'page-two' }
      if (page === 'page-two') return { items: [{ user_id: externalPersonId }] }
    }
    return originalPending(accountId, typeof page === 'number' ? page : 0)
  }
  test.adapter.getProfile = async (accountId: string, personId: string) => {
    if (relationInjected && kind === 'pending' && personId === externalPersonId) {
      return { network_distance: 2, pending_invitation: true }
    }
    if (relationInjected && kind === 'connected' && personId === externalPersonId) {
      return { network_distance: 1, is_connection: true }
    }
    return originalProfile(accountId, personId)
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  await startedClaim
  relationInjected = true
  releaseClaim()
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'partial')
  assert.equal(completed.counters.sent, 0)
  assert.equal(test.metrics.sends, 0)
  const history: any[] = await service.history(7)
  assert.equal(history.some(item => ['sent', 'accepted'].includes(item.status)), false)
  assert.equal(history.find(item => item.personId === externalPersonId)?.status, 'failed')
}

async function unsafePendingReadbackBlocksProviderPost(kind: 'truncated' | 'request_id') {
  const test = fixture({ stack: 'GO', connectionCount: 149, stablePeople: true })
  let now = Date.parse('2026-08-24T09:00:00Z')
  test.adapter.listPendingInvitations = async (accountId: string,
    page: number | string = 0) => {
    if (page === 0) return { items: [{ user_id: 'other-person' }],
      next_cursor: 'unsafe-page-two', ...(kind === 'truncated' ? { total_count: 3 } : {}) }
    return kind === 'truncated'
      ? { items: [{ user_id: 'second-person' }] }
      : { items: [{ id: 'request-id-only' }] }
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date(now), random: () => 0,
    sleep: async () => { now += 86_400_000 } })
  const started: any = await service.start(7)
  const stopped: any = await waitRun(service, started.runId)
  assert.equal(stopped.status, 'partial')
  assert.equal(stopped.stage, 'daily_window_closed')
  assert.equal(test.metrics.sends, 0)
  const history: any[] = await service.history(7)
  assert.equal(history.some(item => ['sending', 'uncertain', 'sent', 'accepted']
    .includes(item.status)), false)
}

async function nocoRetriesWithoutStoppingRun() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const updateRun = test.store.updateRun.bind(test.store); let failures = 3
  test.store.updateRun = async (run: any) => {
    if (failures > 0) {
      failures -= 1
      throw Object.assign(new Error('Noco busy'), { code: 'noco_rate_limited',
        details: { httpStatus: 429 } })
    }
    return updateRun(run)
  }
  const retryDelays: number[] = []
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined, logger: { event(stage: string, status: string, details?: any) {
      if (stage === 'retry' && status === 'failed' && details?.provider === 'noco') {
        retryDelays.push(details.delayMs)
      }
    } } })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.deepEqual(retryDelays, [90_000, 180_000, 270_000])
}

async function nocoFailurePreservesUnipileRetry() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const search = test.adapter.searchPeople; let searchFailed = false
  test.adapter.searchPeople = async (accountId: string, keywords: string) => {
    if (!searchFailed) { searchFailed = true; throw busy(429) }
    return search(accountId, keywords)
  }
  const updateRun = test.store.updateRun.bind(test.store); let nocoFailed = false
  test.store.updateRun = async (run: any) => {
    if (!nocoFailed && run.retryState?.provider === 'unipile') {
      nocoFailed = true
      throw Object.assign(new Error('Noco busy'), { code: 'noco_rate_limited',
        details: { httpStatus: 429 } })
    }
    return updateRun(run)
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.equal(searchFailed, true); assert.equal(nocoFailed, true)
}

Promise.all([searchRetriesSameCursor(), invitation429ReadbackThenRetry(),
  invitation429RearmRequiresFreshClaimReadback(),
  invitation429InvalidReadbackNeverRepeatsBlindly(), freshPendingAfterDelayBlocksPost(),
  freshRelationAfterClaimBlocksPost('pending'), freshRelationAfterClaimBlocksPost('connected'),
  unsafePendingReadbackBlocksProviderPost('truncated'),
  unsafePendingReadbackBlocksProviderPost('request_id'),
  nocoRetriesWithoutStoppingRun(), nocoFailurePreservesUnipileRetry()])
  .then(() => console.log('connection overload tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
