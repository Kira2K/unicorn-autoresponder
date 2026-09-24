import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// Same injected provider data against either checkout. No credentials, network or real writes.
globalThis.fetch = async () => { throw new Error('Live network is forbidden in this benchmark.') }
const require = createRequire(import.meta.url)
const sourceArgument = process.argv.slice(2).find(value => !value.startsWith('--'))
const source = sourceArgument ? resolve(sourceArgument, 'src/features/linkedin-automation/connection-inviter')
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { fixture } = require(resolve(source, 'tests/fixtures.ts'))
const { invitationRun, invitationRuntime, invitationCandidate, INVITATION_TEST_STARTED_AT } =
  require(resolve(source, 'tests/invitation-test-fixtures.ts'))
const { createInvitationPublisher } = require(resolve(source, 'publisher.ts'))
const { executeConnectionRun } = require(resolve(source, 'execution.ts'))
const save = async () => undefined

async function measure(scenario: string) {
  const setup = fixture({ stack: 'GO', connectionCount: 1663 }); const run = invitationRun()
  let clock = INVITATION_TEST_STARTED_AT.getTime()
  const runtime = invitationRuntime(setup, { now: () => new Date(clock),
    sleep: async (ms: number) => { clock += ms } })
  runtime.random = () => 0.5
  const counters: Record<string, number> = {}
  const sent: string[] = []
  const pending = Array.from({ length: 121 }, (_, i) => `old-${i}`)
  let profileFailed = false
  setup.adapter.listPendingInvitations = async (_account: string, offset = 0) =>
    ({ data: pending.slice(offset, offset + 50).map(id => ({ user: { id } })), total_count: pending.length })
  setup.adapter.getProfile = async (_account: string, id: string) => {
    if (scenario === 'profile_timeout' && !profileFailed) {
      profileFailed = true; throw Object.assign(new Error('mock timeout'), { code: 'unipile_timeout' })
    }
    return { network_distance: scenario === 'missing_but_accepted' && sent.includes(id) ? 1 : 2 }
  }
  setup.adapter.sendInvitation = async (_account: string, id: string) => {
    assert.equal(sent.includes(id), false, 'Repeated invitation POST')
    sent.push(id)
    if (scenario !== 'missing_but_accepted') {
      if (scenario === 'target_last') pending.push(id)
      else pending.unshift(id)
    }
    return { id: `request-${id}` }
  }
  for (const name of Object.keys(setup.adapter)) {
    const method = setup.adapter[name]
    setup.adapter[name] = async (...args: unknown[]) => {
      counters[name] = (counters[name] ?? 0) + 1
      return method(...args)
    }
  }
  if (['reconcile_and_send', 'batch_33', 'completed_quota'].includes(scenario)) {
    run.dailyQuota = scenario === 'batch_33' ? 33 : 1
    run.dailyLimit = run.dailyQuota; run.connectionCount = 1663
    run.audienceQuota = { recruiter: scenario === 'batch_33' ? 23 : 1,
      technical: scenario === 'batch_33' ? 10 : 0 }
    await setup.store.createRun(run)
    if (scenario === 'completed_quota') {
      await setup.store.updateHistory({ ...invitationCandidate(run, 'already-accepted'), status: 'accepted' })
    } else {
      for (const id of pending) await setup.store.updateHistory({
        ...invitationCandidate(run, id), runId: 'previous-run', status: 'sent' })
      run.searchProgress.pendingCandidates = Array.from({ length: run.dailyQuota }, (_, i) => ({
        ...invitationCandidate(run, `candidate-${i}`),
        audience: i < run.audienceQuota.recruiter ? 'recruiter' : 'technical'
      }))
    }
    await executeConnectionRun(runtime, run, new Set(), save)
    assert.equal(run.status, 'succeeded')
    assert.equal(run.counters.sent, run.dailyQuota)
  } else {
    const publisher = await createInvitationPublisher(runtime, run, save)
    const outcome = await publisher.publish('recruiter', [invitationCandidate(run, 'candidate')])
    assert.equal(outcome.sentCount, 1)
  }
  const confirmed = (await setup.store.listRunHistory(run.runId, 1000))
    .filter((item: any) => ['sent', 'accepted'].includes(item.status))
    .map((item: any) => ({ personId: item.personId, status: item.status, audience: item.audience }))
    .sort((a: any, b: any) => a.personId.localeCompare(b.personId))
  return { scenario, requests: Object.values(counters).reduce((a, b) => a + b, 0), counters,
    sent, confirmed, quota: run.counters.sentByAudience }
}

// Full flow: real discovery, policy, history, retry, scheduler, adapter and HTTP client.
// Only storage and the HTTP transport are substituted. No prepared candidate queue.
async function measureFull(scenario: string, options: {
  pendingCount?: number; rich?: boolean; sparse?: boolean; last?: boolean;
  transient?: boolean; missingHistory?: number; nextDay?: boolean;
  partialProfile?: boolean; staleProfile?: boolean; legacyReceipt?: boolean
} = {}) {
  const { createConnectionUnipileAdapter, connectionRequestDelay } = require(resolve(source, 'unipile-adapter.ts'))
  const { sendDelay } = require(resolve(source, 'run-model.ts'))
  const { createUnipileHttpClient } = require(resolve(source, '../../../integrations/unipile/http-client.ts'))
  const { createUnipileRequestScheduler } = require(resolve(source, '../../../integrations/unipile/request-scheduler.ts'))
  const { connectionSearchTerms } = require(resolve(source, 'catalog.ts'))
  const setup = fixture({ stack: 'GO', connectionCount: 1663 }); let run = invitationRun()
  if (process.argv.includes('--sql')) {
    const { featureFixture } = require(resolve(source, '../storage-postgres/fixture.mts'))
    const { createSqlInviterStore } = require(resolve(source, '../storage-postgres/inviter-store.mts'))
    const db = featureFixture(); db.grant.accountIds = new Set([run.platformAccountId])
    const catalog = await setup.store.listCatalog()
    catalog.forEach((item: any, index: number) => db.seed('linkedin_connection_search_catalog', index + 1, {
      source_key: item.sourceKey, audience: item.audience, city: item.city,
      keyword_template: item.keywordTemplate, priority: item.priority, enabled: item.enabled }))
    setup.store = createSqlInviterStore(db.db, db.grant)
  }
  run.runId = `full-flow-${scenario}`
  let clock = INVITATION_TEST_STARTED_AT.getTime()
  let startedAt = clock
  const counters: Record<string, number> = {}
  const pendingByStage: Record<string, number> = {}
  const events: any[] = []
  const calls: any[] = []; const sent: string[] = []
  const sentSet = new Set<string>(); const preflightBlocked = new Set<string>()
  const headlines = new Map<string, string>()
  const faults = new Set<string>()
  const pending = Array.from({ length: options.pendingCount ?? 121 }, (_, i) => `old-${i}`)
  const catalog = await setup.store.listCatalog()
  const seedHistory = async (item: any) => {
    await setup.store.claimHistory({ ...item, status: 'sending' })
    await setup.store.updateHistory(item)
  }
  for (const id of pending) await seedHistory({
    ...invitationCandidate(run, id), runId: 'previous-run', status: 'sent' })
  for (let i = 0; i < (options.missingHistory ?? 0); i++) await seedHistory({
    ...invitationCandidate(run, `no-longer-pending-${i}`), runId: 'previous-run', status: 'sent' })
  for (const audience of ['recruiter', 'technical']) await seedHistory({
    ...invitationCandidate(run, `blocked-${audience}`), runId: 'previous-run', audience, status: 'accepted' })
  await setup.store.createRun(run)
  const response = (value: unknown, status = 200, stale = false) => new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json', 'x-cache': stale ? 'HIT' : 'MISS',
      ...(stale ? { age: '3600' } : {}) }
  })
  const failOnce = (key: string) => {
    if (!options.transient || faults.has(key)) return false
    faults.add(key); return true
  }
  const idHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12)
  const http = createUnipileHttpClient({ apiKey: 'benchmark-only', baseUrl: 'https://benchmark.invalid/v2',
    fetchImpl: async (urlText: string, init: any) => {
      const url = new URL(urlText); const path = url.pathname; const method = init.method
      assert.equal(url.hostname, 'benchmark.invalid')
      if (calls.length >= 3000) throw new Error('Benchmark request guard reached.')
      if (clock - startedAt > 10 * 60 * 60_000) throw new Error('Benchmark clock guard reached.')
      const operation = path.includes('/accounts/') ? 'account'
        : path.endsWith('/search/parameters') ? 'locations'
        : path.endsWith('/search/people') ? 'people_search'
        : path.endsWith('/relation-requests') ? method === 'POST' ? 'invitation_post' : 'pending_pages'
        : path.endsWith('/users/me') ? 'own_profile' : 'candidate_profile'
      counters[operation] = (counters[operation] ?? 0) + 1
      calls.push({ operation, method, at: clock - startedAt, stage: run.stage })
      clock += 200 // Same synthetic transport latency in both versions.
      if (operation === 'account') return response({ provider: 'linkedin', status: 'running',
        is_locked: false, user_id: 'ACoOwner' })
      if (operation === 'own_profile') {
        if (failOnce('own_profile')) return response({ type: 'api/service_unavailable' }, 503)
        return response({ public_identifier: 'test-client', provider_id: 'ACoOwner', connections_count: 1663 })
      }
      if (operation === 'locations') {
        const city = url.searchParams.get('keywords')!
        return response({ data: [{ id: `location-${city}`, name: city }] })
      }
      if (operation === 'people_search') {
        if (failOnce('people_search')) return response({ type: 'api/service_unavailable' }, 503)
        const body = JSON.parse(init.body)
        assert.deepEqual(body.network_distance, [2])
        const city = String(body.location[0]).replace(/^location-/, '')
        const template = catalog.find((entry: any) => entry.city === city &&
          connectionSearchTerms(entry, 'GO', false).includes(body.keywords))
        assert.ok(template, 'Unexpected query or location')
        const key = `${city}|${body.keywords}`
        const page = Number(url.searchParams.get('cursor') ?? 0)
        if (options.sparse && Number.parseInt(idHash(key).slice(0, 2), 16) % 3 !== 0) {
          return response({ data: [] })
        }
        const data = Array.from({ length: 8 }, (_, index) => {
          const kind = options.rich ? 7 : index
          const rank = page * 8 + index
          const id = kind === 3 ? `blocked-${template.audience}`
            : kind === 5 ? `shared-${idHash(`${city}|${template.audience}`)}` : `person-${idHash(key)}-${rank}`
          if (kind === 4) preflightBlocked.add(id)
          const headline = kind === 0 ? 'Sales Manager' : template.audience === 'recruiter'
            ? 'Technical Recruiter' : 'Golang Software Engineer'
          headlines.set(id, headline)
          return { object: 'PeopleSearchResult', id, display_name: kind === 1 ? '' : `Person ${id}`,
            headline,
            network_distance: kind === 2 ? 'THIRD_DEGREE' : 'SECOND_DEGREE', location: city, product: 'classic' }
        })
        return response({ data, ...(page < 2 ? { next_cursor: String(page + 1) } : {}) })
      }
      if (operation === 'pending_pages') {
        pendingByStage[run.stage] = (pendingByStage[run.stage] ?? 0) + 1
        const offset = Number(url.searchParams.get('offset') ?? 0)
        if (offset === 50 && failOnce('pending_page')) return response({ type: 'api/service_unavailable' }, 503)
        return response({ data: pending.slice(offset, offset + 50).map(id => ({ user: { id } })),
          total_count: pending.length })
      }
      if (operation === 'candidate_profile') {
        if (failOnce('candidate_profile')) return response({ type: 'api/service_unavailable' }, 503)
        const id = decodeURIComponent(path.split('/').at(-1)!)
        if (options.partialProfile) return response({
          network_distance: preflightBlocked.has(id) ? 'FIRST_DEGREE' : 'SECOND_DEGREE' })
        return response({ object: 'UserProfile', type: 'individual', id, display_name: `Person ${id}`,
          provider: 'linkedin', is_blocked: false, description: headlines.get(id) ?? 'Test Person',
          specifics: { network_distance: preflightBlocked.has(id) ? 'FIRST_DEGREE' : 'SECOND_DEGREE' } },
          200, options.staleProfile)
      }
      assert.equal(operation, 'invitation_post')
      const id = JSON.parse(init.body).user_id
      assert.equal(sentSet.has(id), false, 'Duplicate invitation POST')
      sentSet.add(id); sent.push(id)
      if (options.last) pending.push(id)
      else pending.unshift(id)
      // Provider accepted one POST, but its response was lost: recovery must only read.
      if (sent.length === 5 && failOnce('post_response_lost')) throw new Error('mock response lost')
      return response(options.legacyReceipt ? { id: `request-${id}` } :
        { object: 'RelationRequest', id: `request-${id}`, type: 'sent' }, 201)
    } })
  const scheduler = createUnipileRequestScheduler({ now: () => clock,
    minIntervalMs: connectionRequestDelay ? () => connectionRequestDelay(() => 0.5) : 5_000,
    sleep: async (ms: number) => { clock += ms } })
  const logger = { event(stage: string, status: string, details: any) { events.push({ stage, status, details }) } }
  setup.adapter = createConnectionUnipileAdapter({ http, scheduler, logger, now: () => clock })
  const runtime = invitationRuntime(setup, { now: () => new Date(clock),
    sleep: async (ms: number) => { clock += ms }, logger })
  runtime.random = () => 0.5
  if (options.nextDay) {
    await executeConnectionRun(runtime, run, new Set(), async (current: any) => setup.store.updateRun(current))
    assert.equal(run.status, 'succeeded'); assert.equal(sent.length, 40)
    clock = INVITATION_TEST_STARTED_AT.getTime() + 24 * 60 * 60_000; startedAt = clock
    run = invitationRun(); run.runId = `full-flow-${scenario}-day2`
    run.localDate = '2026-08-25'; run.runKey = `${run.platformAccountId}:${run.localDate}`
    run.createdAt = run.updatedAt = new Date(clock).toISOString()
    await setup.store.createRun(run)
    for (const key of Object.keys(counters)) delete counters[key]
    for (const key of Object.keys(pendingByStage)) delete pendingByStage[key]
    calls.length = 0; events.length = 0; sent.length = 0
  }
  // The SQL mode uses the real store with a fake SQL transport; no live DB or ENV is used.
  await executeConnectionRun(runtime, run, new Set(), async (current: any) => setup.store.updateRun(current))
  assert.equal(run.status, 'succeeded', `${scenario}: ${run.stage} / ${run.errorCode}`)
  assert.equal(run.counters.sent, 40); assert.deepEqual(run.counters.sentByAudience, { recruiter: 28, technical: 12 })
  assert.equal(sent.length, 40); assert.equal(new Set(sent).size, 40)
  assert.equal(sentSet.size, options.nextDay ? 80 : 40)
  const postTimes = calls.filter(call => call.operation === 'invitation_post').map(call => call.at)
  const minimumPostGapSeconds = Math.min(...postTimes.slice(1).map((at, index) =>
    (at - postTimes[index]) / 1000))
  assert.ok(minimumPostGapSeconds >= sendDelay(() => 0.5) / 1000,
    'Fixed-random invitation pause must remain intact')
  const history = await setup.store.listRunHistory(run.runId, 1000)
  assert.equal(history.some((item: any) => ['sending', 'uncertain'].includes(item.status)), false)
  const confirmed = history.filter((item: any) => ['sent', 'accepted'].includes(item.status))
    .map((item: any) => ({ personId: item.personId, status: item.status, audience: item.audience }))
    .sort((a: any, b: any) => a.personId.localeCompare(b.personId))
  const policyEvents = events.filter(event => event.stage === 'candidate_policy')
  const searchEvents = events.filter(event => event.stage === 'candidate_search' && event.status === 'succeeded')
  const searchSequence = searchEvents.map(event => [event.details.searchKey, event.details.term, event.details.page])
  return { scenario, storage: process.argv.includes('--sql') ? 'sql-adapter' : 'memory',
    requests: calls.length, counters, pendingByStage,
    durationMinutes: Math.round((clock - startedAt) / 6000) / 10, minimumPostGapSeconds,
    discovered: run.counters.discovered, skipped: run.counters.skipped,
    rejectedInSearch: policyEvents.filter(event => event.details.hardReasonCodes !== 'none').length,
    emptySearchPages: searchEvents.filter(event => event.details.candidateCount === 0).length,
    carriedCandidates: run.searchProgress.carriedCandidateIds?.length ?? 0,
    quota: run.counters.sentByAudience, sent, confirmed, searchSequence,
    filterFunnel: run.counters.filterFunnel, skipReasons: run.skipReasonCounters,
    diagnostics: { faults: [...faults], requestTraceSummaries: events.filter(event =>
      event.stage === 'unipile_request_summary').map(event => event.details) } }
}

const results = []
if (process.argv.includes('--full')) {
  for (const [name, options] of [
    ['full_rich_121', { rich: true }], ['full_mixed_121', {}],
    ['full_sparse_121', { sparse: true }], ['full_mixed_0', { pendingCount: 0 }],
    ['full_mixed_501', { pendingCount: 501 }], ['full_last_121', { last: true }],
    ['full_transient_121', { transient: true }], ['full_history_121', { missingHistory: 30 }],
    ['full_partial_profile', { partialProfile: true }], ['full_stale_profile', { staleProfile: true }],
    ['full_legacy_receipt', { legacyReceipt: true }], ['full_next_day', { nextDay: true }]
  ] as const) results.push(await measureFull(name, options))
} else {
  for (const scenario of ['target_first', 'target_last', 'missing_but_accepted', 'profile_timeout',
    'reconcile_and_send', 'completed_quota', 'batch_33']) results.push(await measure(scenario))
}
console.log(JSON.stringify(results, null, 2))
