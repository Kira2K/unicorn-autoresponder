const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createPendingSnapshotController, PENDING_SNAPSHOT_TTL_MS: TTL } =
  require('../pending-snapshot.ts') as typeof import('../pending-snapshot.ts')
const { createInvitationPublisher } = require('../publisher.ts') as typeof import('../publisher.ts')
const { reconcileInvitations } = require('../pending.ts') as typeof import('../pending.ts')
const { executeConnectionRun } = require('../execution.ts') as typeof import('../execution.ts')
const { fixture } = require('./fixtures.ts') as typeof import('./fixtures.ts')
const { invitationCandidate, invitationRun, invitationRuntime, INVITATION_TEST_STARTED_AT } =
  require('./invitation-test-fixtures.ts') as typeof import('./invitation-test-fixtures.ts')
const save = async () => undefined

test('missing profile count uses all relations pages, deduplicates and ignores followers', async () => {
  const setup = fixture(); const run = invitationRun(); const own = setup.adapter.getOwnProfile
  setup.adapter.getOwnProfile = async () => ({ ...(await own()), connections_count: null, followers_count: 9000 })
  const cursors: unknown[] = []
  setup.adapter.listRelations = async (_account: string, cursor?: string) => {
    cursors.push(cursor)
    return cursor ? { data: [{ user: { id: 'b' } }, { user: { id: 'c' } }], next_cursor: null }
      : { data: [{ user: { id: 'a' } }, { user: { id: 'b' } }], next_cursor: 'second' }
  }
  assert.equal(await verifyConnectionAccount(invitationRuntime(setup), run, save), 3)
  assert.deepEqual(cursors, [undefined, 'second'])
  setup.adapter.getOwnProfile = own
  setup.adapter.listRelations = () => { throw Error('Unnecessary relations request') }
  assert.equal(await verifyConnectionAccount(invitationRuntime(setup), run, save), 300)
})

for (const page of [{}, { data: [{ id: 'relation-without-user' }] },
  { data: [], next_cursor: 'more' }, { data: [{ user: { id: 'a' } }], next_cursor: 5 },
  { data: [{ user: { id: 'a' } }], next_cursor: 'repeated' }]) {
  test(`incomplete connection count fails closed: ${JSON.stringify(page)}`, async () => {
    const setup = fixture(); const own = setup.adapter.getOwnProfile
    setup.adapter.getOwnProfile = async () => ({ ...(await own()), connections_count: undefined })
    setup.adapter.listRelations = async () => page
    await assert.rejects(() => verifyConnectionAccount(invitationRuntime(setup), invitationRun(), save),
      { code: 'connection_count_unavailable' })
    assert.equal(setup.metrics.sends, 0)
  })
}

test('connection count retries only the failed page and Stop prevents the next page', async () => {
  const setup = fixture(); const own = setup.adapter.getOwnProfile; const cursors: unknown[] = []
  setup.adapter.getOwnProfile = async () => ({ ...(await own()), connections_count: undefined })
  setup.adapter.listRelations = async (_account: string, cursor?: string) => {
    cursors.push(cursor)
    if (cursors.length === 2) throw Object.assign(Error('network'), { code: 'unipile_unreachable' })
    return cursor ? { data: [{ user: { id: 'b' } }] } : { data: [{ user: { id: 'a' } }], next_cursor: 'second' }
  }
  assert.equal(await verifyConnectionAccount(invitationRuntime(setup), invitationRun(), save), 2)
  assert.deepEqual(cursors, [undefined, 'second', 'second'])
  let stopped = false, reads = 0
  setup.adapter.listRelations = async () => { reads++; stopped = true; return { data: [{ user: { id: 'a' } }], next_cursor: 'second' } }
  await assert.rejects(() => verifyConnectionAccount(invitationRuntime(setup, { stopRequested: () => stopped }), invitationRun(), save),
    { code: 'connection_stop_requested' })
  assert.equal(reads, 1)
})

test('Connection Inviter request pacing stays below ten starts in a minute', async () => {
  const { createUnipileRequestScheduler } = require('../../../../integrations/unipile/request-scheduler.ts')
  const { connectionRequestDelay } = require('../unipile-adapter.ts')
  assert.deepEqual([0, .5, 1].map(value => connectionRequestDelay(() => value)), [6500, 8750, 11000])
  let now = 100000; const starts: number[] = []
  let choices = 0
  const scheduler = createUnipileRequestScheduler({ minIntervalMs: () =>
    connectionRequestDelay(() => [0, .5, 1][choices++ % 3]),
    now: () => now, sleep: async (ms: number) => { now += ms } })
  await Promise.all(Array.from({ length: 25 }, () => scheduler.run(async () => { starts.push(now) })))
  assert.equal(choices, 25)
  assert.deepEqual(starts.slice(1, 4).map((start, index) => start - starts[index]), [8750, 11000, 6500])
  for (const start of starts) assert.ok(starts.filter(at => at >= start && at < start + 60000).length <= 10)
})

test('only a fresh complete snapshot of this account can seed the publisher', async () => {
  const run = invitationRun()
  const seed = { accountId: run.accountId, complete: true,
    personIds: new Set(['old']), refreshedAt: INVITATION_TEST_STARTED_AT.getTime() }
  for (const [change, expectedReads] of [
    [{}, 0], [{ accountId: 'another' }, 1], [{ complete: false }, 1],
    [{ valid: false }, 1], [{ refreshedAt: seed.refreshedAt - TTL - 1 }, 1],
    [{ refreshedAt: seed.refreshedAt + 1 }, 1], [{ refreshedAt: NaN }, 1]
  ] as const) {
    const setup = fixture(); let reads = 0
    setup.adapter.listPendingInvitations = async () => { reads++; return { data: [] } }
    const controller = await createPendingSnapshotController(invitationRuntime(setup), run, save,
      { ...seed, ...change })
    assert.equal(reads, expectedReads)
    assert.equal(controller.has('old'), expectedReads === 0)
    controller.add('new')
    assert.equal(seed.personIds.has('new'), false, 'Controller must own its copy of the seed.')
  }
})

test('partial positive confirmation never renews the full snapshot TTL', async () => {
  const setup = fixture(); const run = invitationRun()
  let now = INVITATION_TEST_STARTED_AT.getTime(); let reads = 0
  setup.adapter.listPendingInvitations = async (_account: string, offset: number) => {
    reads++
    return { data: [{ user_id: 'target' }, { user_id: 'old' }].slice(offset, offset + 1), total_count: 2 }
  }
  const runtime = invitationRuntime(setup, { now: () => new Date(now) })
  const pending = await createPendingSnapshotController(runtime, run, save)
  const originalTime = pending.snapshot().refreshedAt
  now += TTL - 1
  const found = await pending.findFresh('target')
  assert.equal(found.complete, false); assert.equal(reads, 3)
  assert.equal(pending.snapshot().refreshedAt, originalTime)
  now += 2
  await pending.ensureFresh()
  assert.equal(reads, 5, 'Expired full snapshot must be read again after a partial confirmation.')
})

for (const [code, elapsed, expectedReads] of [
  ['unipile_timeout', 90_000, 2], ['ECONNRESET', 90_000, 2],
  ['unipile_http_503', 90_000, 2], ['unipile_timeout', TTL + 1, 3]
] as const) {
  test(`pre-send ${code}, elapsed ${elapsed}: preserve only fresh pending data`, async () => {
    const setup = fixture(); const run = invitationRun()
    let now = INVITATION_TEST_STARTED_AT.getTime(); let reads = 0; let profiles = 0
    let sent = false
    setup.adapter.listPendingInvitations = async () => {
      reads++; return { data: sent ? [{ user_id: 'target' }] : [], total_count: sent ? 1 : 0 }
    }
    setup.adapter.getProfile = async () => {
      profiles++
      if (profiles === 1) { now += elapsed; throw Object.assign(new Error('read failed'),
        { code, details: { httpStatus: code.endsWith('503') ? 503 : undefined } }) }
      return { network_distance: 2 }
    }
    setup.adapter.sendInvitation = async () => { sent = true; return { id: 'request' } }
    const runtime = invitationRuntime(setup, { now: () => new Date(now) })
    const publisher = await createInvitationPublisher(runtime, run, save)
    const result = await publisher.publish('recruiter', [invitationCandidate(run, 'target')])
    assert.equal(result.sentCount, 1); assert.equal(profiles, 2); assert.equal(reads, expectedReads)
  })
}

for (const staleDuringSave of [false, true]) {
  test(`missing pending read-back handoff; stale during storage=${staleDuringSave}`, async () => {
    const setup = fixture(); const run = invitationRun()
    let now = INVITATION_TEST_STARTED_AT.getTime(); let reads = 0; let posts = 0
    let profiles = 0
    setup.adapter.listPendingInvitations = async () => { reads++; return { data: [], total_count: 0 } }
    setup.adapter.getProfile = async () => { profiles++; return { network_distance: posts ? 1 : 2 } }
    setup.adapter.sendInvitation = async () => { posts++; return { id: 'request' } }
    const runtime = invitationRuntime(setup, { now: () => new Date(now) })
    const publisher = await createInvitationPublisher(runtime, run, async (_run, event) => {
      if (staleDuringSave && event === 'uncertain') now += TTL + 1
    })
    const result = await publisher.publish('recruiter', [invitationCandidate(run, 'target')])
    assert.equal(result.sentCount, 1); assert.equal(posts, 1); assert.equal(profiles, 2)
    assert.equal(reads, staleDuringSave ? 3 : 2)
  })
}

test('reconciliation feeds the sender; old sent records are still checked on each run', async () => {
  const setup = fixture(); const run = invitationRun(); let reads = 0
  const old = { ...invitationCandidate(run, 'old'), status: 'sent' as const }
  await setup.store.updateHistory(old)
  setup.adapter.listPendingInvitations = async () => {
    reads++; return { data: [{ user_id: 'old' }], total_count: 1 }
  }
  const runtime = invitationRuntime(setup)
  const reconciled = await reconcileInvitations(runtime, run, save)
  await createInvitationPublisher(runtime, run, save, reconciled.snapshot)
  assert.equal(reads, 1)
  await reconcileInvitations(runtime, run, save)
  assert.equal(reads, 2, 'A new mailing always checks previously sent invitations.')
})

for (const status of ['accepted', 'sending'] as const) {
  test(`completed frozen quota recovery from ${status} performs only required reconciliation`, async () => {
    const setup = fixture(); const run = invitationRun()
    run.dailyQuota = 1; run.dailyLimit = 1; run.audienceQuota = { recruiter: 1, technical: 0 }
    run.stage = 'recovering'
    await setup.store.createRun(run)
    await setup.store.updateHistory({ ...invitationCandidate(run, 'old'), status })
    let reads = 0
    setup.adapter.listPendingInvitations = async () => {
      reads++; return { data: [{ user_id: 'old' }], total_count: 1 }
    }
    setup.adapter.getAccount = setup.adapter.getOwnProfile = setup.adapter.sendInvitation =
      async () => { throw new Error('No sending preparation allowed when quota is confirmed complete.') }
    await executeConnectionRun(invitationRuntime(setup), run, new Set(), save)
    assert.equal(run.status, 'succeeded'); assert.equal(run.counters.sent, 1)
    assert.equal(reads, status === 'accepted' ? 0 : 1)
  })
}

test('a manual invitation during a long profile wait is observed before POST', async () => {
  const setup = fixture(); const run = invitationRun(); let now = INVITATION_TEST_STARTED_AT.getTime()
  let reads = 0; let posts = 0
  setup.adapter.listPendingInvitations = async () => {
    reads++; return { data: reads > 1 ? [{ user_id: 'target' }] : [], total_count: reads > 1 ? 1 : 0 }
  }
  setup.adapter.getProfile = async () => { now += TTL + 1; return { network_distance: 2 } }
  setup.adapter.sendInvitation = async () => { posts++; return { id: 'request' } }
  const publisher = await createInvitationPublisher(invitationRuntime(setup, { now: () => new Date(now) }), run, save)
  const result = await publisher.publish('recruiter', [invitationCandidate(run, 'target')])
  assert.equal(result.sentCount, 0); assert.equal(posts, 0); assert.equal(reads, 2)
})

test('snapshots never leak between concurrent accounts and reject account changes', async () => {
  const setup = fixture(); const run1 = invitationRun(); const run2 = invitationRun()
  run2.accountId = 'second-account'; run2.platformAccountId = 8
  setup.adapter.listPendingInvitations = async (account: string) =>
    ({ data: [{ user_id: account }], total_count: 1 })
  const runtime = invitationRuntime(setup)
  const [first, second] = await Promise.all([createPendingSnapshotController(runtime, run1, save),
    createPendingSnapshotController(runtime, run2, save)])
  assert.equal(first.has(run2.accountId), false); assert.equal(second.has(run1.accountId), false)
  run1.accountId = run2.accountId
  await assert.rejects(() => first.ensureFresh(), { code: 'connection_account_changed' })
})

test('a scan expiring during the request or retry checkpoint cannot seed a new send', async () => {
  const setup = fixture(); const run = invitationRun()
  let now = INVITATION_TEST_STARTED_AT.getTime(); let reads = 0; let delayedSave = false
  setup.adapter.listPendingInvitations = async () => {
    reads++
    if (reads === 1) now += TTL + 1
    return { data: [], total_count: 0 }
  }
  const controller = await createPendingSnapshotController(
    invitationRuntime(setup, { now: () => new Date(now) }), run, async (_run, event) => {
      if (event === 'retry_succeeded' && !delayedSave) { delayedSave = true; now += TTL + 1 }
    })
  assert.equal(reads, 3)
  assert.equal(controller.snapshot().refreshedAt, now)
})

test('empty profile response cannot bypass an unknown previous POST during recovery', async () => {
  const setup = fixture(); const run = invitationRun(); let profiles = 0
  run.dailyQuota = 1; run.dailyLimit = 1; run.audienceQuota = { recruiter: 1, technical: 0 }
  await setup.store.createRun(run)
  await setup.store.updateHistory({ ...invitationCandidate(run, 'unknown'), status: 'uncertain' })
  setup.adapter.listPendingInvitations = async () => ({ data: [], total_count: 0 })
  setup.adapter.getProfile = async () => ++profiles === 1 ? null : { network_distance: 1 }
  setup.adapter.getAccount = setup.adapter.sendInvitation = async () => {
    throw new Error('Unknown history must be resolved before new sending preparation.')
  }
  await executeConnectionRun(invitationRuntime(setup), run, new Set(), save)
  assert.equal(run.status, 'succeeded'); assert.equal(profiles, 2)
  assert.equal((await setup.store.findHistory(run.accountId, 'unknown'))?.status, 'accepted')
})

const { createConnectionUnipileAdapter } = require('../unipile-adapter.ts') as typeof import('../unipile-adapter.ts')
const { createUnipileHttpClient } = require('../../../../integrations/unipile/http-client.ts')
const { runRow, runFromRow } = require('../store-rows.ts') as typeof import('../store-rows.ts')
const { verifyConnectionAccount } = require('../account.mts') as typeof import('../account.mts')
const { createCandidateDiscovery } = require('../discovery.ts') as typeof import('../discovery.ts')
const { featureFixture } = require('../../storage-postgres/fixture.mts') as typeof import('../../storage-postgres/fixture.mts')
const { createSqlInviterStore } = require('../../storage-postgres/inviter-store.mts') as typeof import('../../storage-postgres/inviter-store.mts')

function receiptFixture(options: { cache?: string; age?: string; mode?: string;
  profile?: (id: string) => any; post?: () => void } = {}) {
  const setup = fixture(); const run = invitationRun()
  let now = INVITATION_TEST_STARTED_AT.getTime()
  const pending: string[] = []; const posts: Array<{ id: string; at: number }> = []
  let pendingReads = 0
  const profile = (id: string) => ({ object: 'UserProfile', type: 'individual', id, provider: 'linkedin',
    display_name: 'Test Person', description: 'Technical Recruiter', is_blocked: false,
    specifics: { network_distance: 'SECOND_DEGREE' } })
  const http = createUnipileHttpClient({ apiKey: 'test-only', baseUrl: 'https://test.invalid/v2',
    fetchImpl: async (urlText: string, init: any) => {
      const url = new URL(urlText); assert.equal(url.hostname, 'test.invalid')
      let status = 200; let body: any
      if (url.pathname.endsWith('/relation-requests')) {
        if (init.method === 'POST') {
          const id = JSON.parse(init.body).user_id
          assert.equal(posts.some(item => item.id === id), false, 'No duplicate POST')
          posts.push({ id, at: now }); options.post?.()
          if (options.mode === 'reject-first' && posts.length === 1) {
            return new Response(JSON.stringify({ type: 'invalid_recipient' }), { status: 400 })
          }
          pending.push(id)
          if (options.mode === 'lost') throw new Error('response lost after acceptance')
          status = options.mode === 'wrong-status' ? 200 : 201
          body = { object: 'RelationRequest', type: options.mode === 'wrong-type' ? 'received' : 'sent',
            id: options.mode === 'empty-id' ? '' : `request-${id}`,
            user: { id: options.mode === 'wrong-user' ? 'someone-else' : id } }
        } else {
          pendingReads++; body = { data: pending.map(id => ({ user: { id } })), total_count: pending.length }
        }
      } else {
        const id = decodeURIComponent(url.pathname.split('/').at(-1)!)
        body = options.profile ? options.profile(id) : profile(id)
      }
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (options.cache !== 'absent') headers['x-cache'] = options.cache ?? 'MISS'
      if (options.age !== undefined) headers.age = options.age
      return new Response(JSON.stringify(body), { status, headers })
    } })
  setup.adapter = createConnectionUnipileAdapter({ http, now: () => now,
    scheduler: { run: (action: any) => action() } })
  const runtime = invitationRuntime(setup, { now: () => new Date(now), sleep: async ms => { now += ms } })
  runtime.random = () => 0.5
  return { setup, run, runtime, pending, posts, profile,
    advance(ms: number) { now += ms }, now: () => now, reads: () => pendingReads }
}

for (const mode of ['valid', 'wrong-status', 'wrong-type', 'wrong-user', 'empty-id', 'lost']) {
  test(`provider receipt ${mode}: only a valid 201 skips list read-back`, async () => {
    const t = receiptFixture({ mode })
    const publisher = await createInvitationPublisher(t.runtime, t.run, save)
    const result = await publisher.publish('recruiter', [invitationCandidate(t.run, 'target')])
    assert.equal(result.sentCount, 1); assert.equal(t.posts.length, 1)
    assert.equal(t.reads(), mode === 'valid' ? 1 : 2)
    const history = await t.setup.store.findHistory(t.run.accountId, 'target')
    assert.equal(history?.status, 'sent')
    assert.equal(history?.reasonCode, mode === 'valid' ? 'invitation_receipt_confirmed' : 'pending_readback_confirmed')
  })
}

for (const [cache, age, expectedReads] of [
  ['MISS', undefined, 1], ['HIT', '60', 1], ['HIT', '301', 2],
  ['HIT', undefined, 2], ['STALE', '0', 2], ['absent', undefined, 2]
] as const) {
  test(`profile evidence ${cache}/${age}: stale or unknown cache falls back to full list`, async () => {
    const t = receiptFixture({ cache, age })
    const publisher = await createInvitationPublisher(t.runtime, t.run, save)
    t.advance(TTL + 1)
    const result = await publisher.publish('recruiter', [invitationCandidate(t.run, 'target')])
    assert.equal(result.sentCount, 1); assert.equal(t.reads(), expectedReads)
  })
}

test('complete profile sees a manual pending request without scanning the old list again', async () => {
  const t = receiptFixture()
  const read = t.setup.adapter.getInvitationProfile
  t.setup.adapter.getInvitationProfile = async (...args: any[]) => {
    const result = await read(...args)
    result.profile.specifics.relation_request = { object: 'RelationRequest', type: 'sent', id: 'manual' }
    return result
  }
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  t.advance(TTL + 1)
  const result = await publisher.publish('recruiter', [invitationCandidate(t.run, 'target')])
  assert.equal(result.sentCount, 0); assert.equal(t.posts.length, 0); assert.equal(t.reads(), 1)
})

test('partial profile and a manual pending request force a full-list check', async () => {
  const t = receiptFixture({ profile: () => ({ network_distance: 2 }) })
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  t.advance(TTL + 1); t.pending.push('target')
  const result = await publisher.publish('recruiter', [invitationCandidate(t.run, 'target')])
  assert.equal(result.sentCount, 0); assert.equal(t.posts.length, 0); assert.equal(t.reads(), 2)
})

test('wrong profile identity cannot authorize an invitation', async () => {
  const t = receiptFixture({ profile: () => ({ object: 'UserProfile', id: 'another', network_distance: 2 }) })
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  assert.equal((await publisher.publish('recruiter', [invitationCandidate(t.run, 'target')])).sentCount, 0)
  assert.equal(t.posts.length, 0)
})

test('skipping a candidate consumes only the remaining shared invitation pause', async () => {
  const t = receiptFixture()
  const get = t.setup.adapter.getInvitationProfile
  t.setup.adapter.getInvitationProfile = async (...args: any[]) => {
    const read = await get(...args)
    if (args[1] === 'connected') read.profile.specifics.network_distance = 'FIRST_DEGREE'
    return read
  }
  t.run.counters.sent = 1
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  const result = await publisher.publish('recruiter', ['connected', 'target'].map(id => invitationCandidate(t.run, id)))
  assert.equal(result.sentCount, 1)
  assert.equal(t.posts[0].at - INVITATION_TEST_STARTED_AT.getTime(), 100_000)
})

test('a rejected actual POST still starts a new invitation pause', async () => {
  const t = receiptFixture({ mode: 'reject-first' })
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  const result = await publisher.publish('recruiter', ['rejected', 'target'].map(id => invitationCandidate(t.run, id)))
  assert.equal(result.sentCount, 1); assert.equal(t.posts.length, 2)
  assert.equal(t.posts[1].at - t.posts[0].at, 100_000)
})

test('restart preserves the chosen pause and resumes only its remainder', async () => {
  const t = receiptFixture(); t.run.counters.sent = 1
  let stopped = false
  t.runtime.stopRequested = () => stopped
  t.runtime.sleep = async ms => { t.advance(ms); if (t.now() - INVITATION_TEST_STARTED_AT.getTime() >= 20_000) stopped = true }
  const first = await createInvitationPublisher(t.runtime, t.run, save)
  await first.publish('recruiter', [invitationCandidate(t.run, 'target')])
  assert.equal(t.posts.length, 0)
  const restored = runFromRow(runRow(t.run)); stopped = false
  const { prepareRunTopUp } = require('../retry-policy.ts') as typeof import('../retry-policy.ts')
  prepareRunTopUp(restored, { stack: restored.stack, stackId: restored.stackId }, false)
  t.runtime.sleep = async ms => { t.advance(ms) }
  t.runtime.random = () => { throw new Error('A saved pause must not be randomized again.') }
  const second = await createInvitationPublisher(t.runtime, restored, save)
  await second.publish('recruiter', [invitationCandidate(restored, 'target')])
  assert.equal(t.posts[0].at - INVITATION_TEST_STARTED_AT.getTime(), 100_000)
})

test('stop after successful POST preserves the receipt and prevents the next write', async () => {
  let stopped = false
  const t = receiptFixture({ post: () => { stopped = true } })
  t.runtime.stopRequested = () => stopped
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  const result = await publisher.publish('recruiter', ['one', 'two'].map(id => invitationCandidate(t.run, id)), 2)
  assert.equal(result.sentCount, 1); assert.equal(t.posts.length, 1)
  assert.equal((await t.setup.store.findHistory(t.run.accountId, 'one'))?.status, 'sent')
})

test('own-profile retry reuses account read; same-day continuation reuses the frozen count', async () => {
  const setup = fixture(); const run = invitationRun(); let accounts = 0; let profiles = 0
  const accountRead = setup.adapter.getAccount; const ownRead = setup.adapter.getOwnProfile
  setup.adapter.getAccount = async () => { accounts++; return accountRead() }
  setup.adapter.getOwnProfile = async () => {
    profiles++; if (profiles === 1) throw Object.assign(new Error('timeout'), { code: 'unipile_timeout' })
    return ownRead()
  }
  const runtime = invitationRuntime(setup)
  run.connectionCount = await verifyConnectionAccount(runtime, run, save)
  assert.equal(accounts, 1); assert.equal(profiles, 2)
  run.dailyQuota = 1; run.audienceQuota = { recruiter: 1, technical: 0 }
  const { prepareRunTopUp } = require('../retry-policy.ts') as typeof import('../retry-policy.ts')
  prepareRunTopUp(run, { stack: run.stack, stackId: run.stackId }, false)
  await verifyConnectionAccount(runtime, runFromRow(runRow(run)), save)
  assert.equal(accounts, 2); assert.equal(profiles, 2)
  ;(await setup.repository.listAccounts())[0].lastVerifiedAt = '2026-08-24T09:00:00Z'
  await verifyConnectionAccount(runtime, run, save)
  assert.equal(accounts, 3); assert.equal(profiles, 3)
})

test('only a recent same-account same-stack unused queue can replace a search page', async () => {
  for (const variant of ['fresh', 'stale', 'account', 'stack', 'sent']) {
    const setup = fixture({ stack: 'GO' }); const run = invitationRun(); run.stack = 'GO'
    const catalog = await setup.store.listCatalog(); const template = catalog.find(row => row.audience === 'recruiter')!
    const previous = invitationRun(); previous.runId = 'previous'; previous.runKey = 'previous-key'
    previous.localDate = '2026-08-23'; previous.status = 'succeeded'; previous.stack = variant === 'stack' ? 'Java' : 'GO'
    if (variant === 'account') previous.accountId = 'different'
    const cached = { ...invitationCandidate(previous, 'cached-person'), searchKey: template.sourceKey,
      status: 'eligible' as const, discoveredAt: variant === 'stale' ? '2026-08-20T09:00:00Z' : '2026-08-23T12:00:00Z' }
    previous.searchProgress.pendingCandidates = [cached]
    await setup.store.createRun(previous)
    if (variant === 'sent') await setup.store.updateHistory({ ...cached, status: 'sent' })
    setup.adapter.resolveLocations = async () => { throw new Error('new-search-required') }
    const discovery = await createCandidateDiscovery(invitationRuntime(setup), run, save)
    if (variant === 'fresh') {
      const result = await discovery.next('recruiter')
      assert.equal(result[0].personId, 'cached-person'); assert.equal(result[0].runId, run.runId)
      assert.equal(result[0].discoveredAt, cached.discoveredAt)
      assert.deepEqual(run.searchProgress.carriedCandidateIds, ['cached-person'])
    } else await assert.rejects(() => discovery.next('recruiter'), /new-search-required/)
  }
})

test('carried search candidates are rechecked against their current role', async () => {
  const t = receiptFixture(); t.run.searchProgress.carriedCandidateIds = ['target']
  const { prepareRunRetry, prepareRunTopUp } = require('../retry-policy.ts') as typeof import('../retry-policy.ts')
  for (const resume of [prepareRunRetry, prepareRunTopUp]) {
    resume(t.run, { stack: t.run.stack, stackId: t.run.stackId }, false)
    assert.deepEqual(t.run.searchProgress.carriedCandidateIds, ['target'])
  }
  const get = t.setup.adapter.getInvitationProfile
  t.setup.adapter.getInvitationProfile = async (...args: any[]) => {
    const result = await get(...args); result.profile.description = 'Sales Manager'; return result
  }
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  assert.equal((await publisher.publish('recruiter', [invitationCandidate(t.run, 'target')])).sentCount, 0)
  assert.equal(t.posts.length, 0)
})

test('a failed receipt checkpoint retries storage without sending again', async () => {
  const t = receiptFixture(); let saves = 0
  const update = t.setup.store.updateHistory.bind(t.setup.store)
  t.setup.store.updateHistory = async item => {
    if (item.status === 'sent' && saves++ === 0) {
      throw Object.assign(new Error('database read unavailable before update'), { code: 'postgres_read_unavailable' })
    }
    return update(item)
  }
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  assert.equal((await publisher.publish('recruiter', [invitationCandidate(t.run, 'target')])).sentCount, 1)
  assert.equal(t.posts.length, 1); assert.equal(saves, 2)
})

test('a stale run timer cannot bypass the pause after a newer persisted send', async () => {
  const t = receiptFixture(); const run = t.run
  run.dailyQuota = 2; run.connectionCount = 300; run.audienceQuota = { recruiter: 2, technical: 0 }
  run.counters.sent = 0
  run.searchProgress.invitationNotBefore = new Date(t.now() - 1).toISOString()
  run.searchProgress.invitationPauseAfterPersonId = 'older'
  run.searchProgress.pendingCandidates = [invitationCandidate(run, 'target')]
  t.pending.push('previous')
  await t.setup.store.updateHistory({ ...invitationCandidate(run, 'previous'), status: 'sent',
    verifiedAt: new Date(t.now()).toISOString() })
  // Account reads are irrelevant to this pacing regression and are supplied by the fixture.
  const base = fixture()
  t.setup.adapter.getAccount = base.adapter.getAccount; t.setup.adapter.getOwnProfile = base.adapter.getOwnProfile
  await t.setup.store.createRun(run)
  await executeConnectionRun(t.runtime, run, new Set(), save)
  assert.equal(run.status, 'succeeded'); assert.equal(t.posts.length, 1)
  assert.ok(t.posts[0].at - INVITATION_TEST_STARTED_AT.getTime() >= 100_000)
})

test('a changed account cannot reuse profile evidence or the saved own-profile verification', async () => {
  const t = receiptFixture()
  const publisher = await createInvitationPublisher(t.runtime, t.run, save)
  const candidate = invitationCandidate(t.run, 'target')
  t.run.accountId = 'another'
  await assert.rejects(() => publisher.publish('recruiter', [candidate]), { code: 'connection_account_changed' })
  assert.equal(t.posts.length, 0)
  const setup = fixture(); const run = invitationRun(); const runtime = invitationRuntime(setup)
  run.connectionCount = await verifyConnectionAccount(runtime, run, save)
  run.dailyQuota = 1; run.audienceQuota = { recruiter: 1, technical: 0 }
  setup.adapter.getAccount = async () => ({ provider: 'linkedin', status: 'running', is_locked: false, user_id: 'different' })
  await assert.rejects(() => verifyConnectionAccount(runtime, run, save), { code: 'linkedin_provider_id_mismatch' })
})

test('SQL round-trip preserves queue, identity and pause; a committed receipt blocks another POST', async () => {
  const t = receiptFixture(); const f = featureFixture()
  f.grant.accountIds = new Set([t.run.platformAccountId])
  const store = createSqlInviterStore(f.db, f.grant)
  const runtime = { ...t.runtime, store }
  t.run.searchProgress.verifiedAccount = { accountId: t.run.accountId, providerId: 'owner', lastVerifiedAt: t.run.createdAt }
  t.run.searchProgress.carriedCandidateIds = ['unused']
  t.run.searchProgress.carriedCandidatesChecked = true
  t.run.searchProgress.invitationPacingStarted = true
  t.run.searchProgress.invitationPauseAfterPersonId = 'previous'
  t.run.searchProgress.invitationNotBefore = new Date(t.now() + 97_500).toISOString()
  t.run.searchProgress.pendingCandidates = [invitationCandidate(t.run, 'target')]
  await store.createRun(t.run)
  const restoredStore = createSqlInviterStore(f.db, f.grant)
  const restored = (await restoredStore.getRun(t.run.runId))!
  assert.deepEqual(restored.searchProgress, t.run.searchProgress)
  const publisher = await createInvitationPublisher(runtime, restored, async current => store.updateRun(current))
  assert.equal((await publisher.publish('recruiter', restored.searchProgress.pendingCandidates)).sentCount, 1)
  assert.equal(t.posts.length, 1); assert.ok(t.posts[0].at >= Date.parse(t.run.searchProgress.invitationNotBefore))
  assert.equal((await restoredStore.findHistory(t.run.accountId, 'target'))?.reasonCode, 'invitation_receipt_confirmed')
  const next = await createInvitationPublisher({ ...runtime, store: restoredStore }, restored, save)
  assert.equal((await next.publish('recruiter', [invitationCandidate(restored, 'target')])).sentCount, 0)
  assert.equal(t.posts.length, 1)
  assert.equal('resetNocoBudget' in store, false)
})

test('unknown SQL COMMIT after the receipt does not repeat either POST or transaction', async () => {
  const f = featureFixture(); const t = receiptFixture({ post: () => f.fail('commit') })
  f.grant.accountIds = new Set([t.run.platformAccountId])
  const store = createSqlInviterStore(f.db, f.grant), runtime = { ...t.runtime, store }
  await store.createRun(t.run)
  const publisher = await createInvitationPublisher(runtime, t.run, save)
  await assert.rejects(() => publisher.publish('recruiter', [invitationCandidate(t.run, 'target')]), { code: 'commit_uncertain' })
  assert.equal(t.posts.length, 1); assert.equal(f.calls.filter(call => call === 'patch').length, 1)
  f.fail('')
  const restored = createSqlInviterStore(f.db, f.grant)
  assert.equal((await restored.findHistory(t.run.accountId, 'target'))?.status, 'sent')
  const next = await createInvitationPublisher({ ...runtime, store: restored }, t.run, save)
  assert.equal((await next.publish('recruiter', [invitationCandidate(t.run, 'target')])).sentCount, 0)
  assert.equal(t.posts.length, 1)
})

test('service requires explicit storage; SQL retry is logged as storage and unsafe failures stop', async () => {
  const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
  const { withConnectionRetry, connectionRetryProvider } = require('../retry-state.ts') as typeof import('../retry-state.ts')
  const setup = fixture(); const { store: _store, ...withoutStore } = setup
  assert.throws(() => createConnectionInviterService(withoutStore), { code: 'connection_store_required' })
  const run = invitationRun(); let calls = 0; const logs: any[] = []
  const runtime = invitationRuntime(setup, { logger: { event(...args) { logs.push(args) } } })
  const error = Object.assign(new Error('SQL temporarily unavailable'), { code: 'postgres_read_unavailable' })
  const provider = connectionRetryProvider(error)
  assert.equal(provider, 'storage')
  assert.equal(await withConnectionRetry(runtime, run, save, provider, 'history_read', async () => {
    if (++calls === 1) throw error
    return 'restored'
  }), 'restored')
  assert.equal(logs.find(row => row[0] === 'retry')[2].provider, 'storage')
  for (const code of ['commit_uncertain', 'postgres_write_failed', 'ECONNRESET', 'ETIMEDOUT']) {
    let attempts = 0
    await assert.rejects(() => withConnectionRetry(runtime, run, save, 'storage', 'history_write', async () => {
      attempts++; throw Object.assign(new Error('uncertain database write'), { code })
    }), { code })
    assert.equal(attempts, 1)
  }
})
