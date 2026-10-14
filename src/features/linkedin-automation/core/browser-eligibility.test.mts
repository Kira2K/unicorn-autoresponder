import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { linkedInFixture } from '../../web-console/backend/postgres/linkedin-fixture.mts'
import { createSqlLinkedInStorage } from '../../web-console/backend/postgres/linkedin-repository.mts'
import { tableIds } from '../../web-console/backend/postgres/tables.mts'
import { findParameterOptions } from '../profile-filler/parameter-options.ts'
import { createConnectionInviterService } from '../connection-inviter/service.ts'
import { fixture as connectionFixture, waitRun } from '../connection-inviter/tests/fixtures.ts'
import { selectPosts } from '../comment-monitor/post-selection.ts'
import { createPostSource } from '../post-writer/source.ts'
import { fixture as postFixture } from '../post-writer/tests/helpers.ts'
import { processRun } from '../post-writer/process-run.ts'
import { createServiceState } from '../post-writer/service-state.ts'
import { engage } from '../post-writer/engagement.ts'
import { composeInvitationWithdrawal } from '../invitation-withdrawal/compose.ts'
import { executeConnectionRun } from '../connection-inviter/execution.ts'
import { accountContext } from '../connection-inviter/account.mts'
import { makeRun } from '../connection-inviter/run-model.ts'
const require = createRequire(import.meta.url)
import { assertDolphinAccount, readDolphinAccount } from './browser-eligibility.mts'
const { resolveProfileAccount } = require('../profile-filler/profile-account.ts') as any
const { createCommentMonitorService } = require('../comment-monitor/service.ts') as any
const { createProfileFillerService } = require('../profile-filler/service.ts') as any
const { runLinkedInAuth } = require('../account-connection/auth-service.ts') as any
const blocked = { code: 'linkedin_browser_unsupported' }
const quietLogger = { event() {} }

function repositories(browser: unknown, url?: string, connected = true) {
  const f = linkedInFixture()
  f.rows.get(tableIds.profiles)!.get('31')!.browser = browser
  if (url !== undefined) Object.assign(f.rows.get(tableIds.accounts)!.get('21')!, {
    url, unipile_account_id: connected ? 'fake-unipile' : '',
    unipile_account_status: connected ? 'running' : '',
    linkedin_verified_provider_id: connected ? 'fixture-owner' : ''
  })
  return [f.legacy.repository, createSqlLinkedInStorage(f.db).repository]
}

test('Dolphin policy excludes Octo/unknown/null and reads a changed browser freshly', async () => {
  for (const browser of ['octo', 'unknown', null, '']) {
    for (const repository of repositories(browser)) {
      const row = await repository.getAccount(21, { fresh: true })
      assert.equal(row?.unipileAccountId, 'fake-unipile') // Previously connected, not a new account.
      assert.equal(row?.readinessErrorCode, 'dolphin_en_profile_not_found')
      await assert.rejects(readDolphinAccount(repository, 21), blocked)
      await assert.rejects(repository.resolveTarget('SQL fixture', 21), { code: 'dolphin_en_profile_not_found' })
    }
  }
  for (const repository of repositories('dolphin')) assert.equal((await readDolphinAccount(repository, 21)).dolphinProfileId, 7001)
  const cached = linkedInFixture()
  cached.rows.get(tableIds.profiles)!.get('31')!.browser = 'dolphin'
  await cached.legacy.repository.listAccounts()
  cached.rows.get(tableIds.profiles)!.get('31')!.browser = 'octo'
  await assert.rejects(readDolphinAccount(cached.legacy.repository, 21), blocked)
  await assert.rejects(cached.legacy.repository.resolveTarget('SQL fixture', 21), { code: 'dolphin_en_profile_not_found' })
  assert.throws(() => assertDolphinAccount({ browser: 'octo' }), blocked)
  let fresh = false
  await assert.rejects(readDolphinAccount({
    listAccounts: async () => [{ platformAccountId: 21 }], // Stale allowed snapshot must not win.
    getAccount: async (_id: number, options: { fresh: boolean }) => {
      fresh = options.fresh
      return { platformAccountId: 21, readinessErrorCode: 'dolphin_en_profile_not_found' }
    }
  }, 21), blocked)
  assert.equal(fresh, true)
})

test('A missing or invalid URL cannot hide a connected Octo account', async t => {
  for (const url of ['', 'not-a-linkedin-url']) {
    for (const [index, repository] of repositories('octo', url).entries()) {
      await t.test(`${index === 0 ? 'Noco' : 'SQL'}: ${url ? 'invalid' : 'missing'} URL`, async () => {
        const row = await repository.getAccount(21, { fresh: true })
        assert.equal(row?.readinessErrorCode, url ? 'linkedin_url_invalid' : 'linkedin_url_missing')
        assert.equal(row?.dolphinProfileId, undefined)
        let calls = 0
        const remote = new Proxy({}, { get: () => async () => { calls++; throw Error('remote call forbidden') } })
        await assert.rejects(readDolphinAccount(repository, 21), blocked)
        await assert.rejects(resolveProfileAccount(repository, remote, 21, []), blocked)
        await assert.rejects(findParameterOptions({ repository, client: remote as any,
          platformAccountId: 21, type: 'SKILL', keywords: 'Python', logger: quietLogger as any }), blocked)
        await assert.rejects(selectPosts({ platformAccountId: 21, repository, adapter: remote,
          logger: quietLogger as any }), blocked)
        const source = createPostSource({ accounts: () => repository.listAccounts(),
          getAccount: (id, options) => repository.getAccount(id, options),
          cvRows: async () => { calls++; throw Error('CV read forbidden') },
          selectCv: () => { throw Error('CV selection forbidden') },
          loadCv: async () => { calls++; throw Error('CV download forbidden') },
          extractFacts: async () => { calls++; throw Error('model call forbidden') } })
        await assert.rejects(source.assertBrowser!(21), blocked)
        await assert.rejects(source.context(21), blocked)
        assert.equal(calls, 0)
      })
    }
    // URL validation remains separate: it must not mislabel a resolved Dolphin as Octo.
    for (const repository of repositories('dolphin', url)) {
      assert.equal((await readDolphinAccount(repository, 21)).dolphinProfileId, 7001)
    }
  }
})

test('Octo Check, Connect and forced reconnect never reach Unipile or Dolphin', async t => {
  for (const connected of [false, true]) {
    for (const url of ['https://www.linkedin.com/in/sql-test/', '', 'not-a-linkedin-url']) {
      for (const mode of [{ apply: false }, { apply: true }, { apply: true, forceReauth: true }]) {
        for (const [index, repository] of repositories('octo', url, connected).entries()) {
          const label = `${index === 0 ? 'Noco' : 'SQL'} / ${connected ? 'saved binding' : 'new'} / ` +
            `${url.startsWith('https:') ? 'valid URL' : url ? 'invalid URL' : 'missing URL'} / ` +
            `${mode.forceReauth ? 'reconnect' : mode.apply ? 'connect' : 'check'}`
          await t.test(label, async () => {
            let calls = 0
            const forbidden = async () => { calls++; throw Error('provider or browser call forbidden') }
            const before = await repository.getAccount(21, { fresh: true })
            await assert.rejects(runLinkedInAuth({ clientName: 'SQL fixture', platformAccountId: 21, ...mode }, {
              // Fixture metadata is partial; target resolution still uses the real repository.
              repository: { ...repository, async assertSchema() {} },
              adapter: new Proxy({}, { get: () => forbidden }),
              collectSession: forbidden, inspectProfile: forbidden
            }), { code: url.startsWith('https:') ? 'dolphin_en_profile_not_found' :
              url ? 'linkedin_url_invalid' : 'linkedin_url_missing' })
            assert.equal(calls, 0)
            assert.deepEqual(await repository.getAccount(21, { fresh: true }), before)
          })
        }
      }
    }
  }
})

test('Profile Filler and parameter search do not call Unipile for a connected Octo account', async () => {
  let calls = 0
  const client = new Proxy({}, { get: () => async () => { calls++; throw Error('provider must not be called') } })
  for (const repository of repositories('octo')) {
    await assert.rejects(resolveProfileAccount(repository, client, 21, []), blocked)
    await assert.rejects(findParameterOptions({ repository, client: client as any,
      platformAccountId: 21, type: 'SKILL', keywords: 'Python', logger: quietLogger as any }), blocked)
  }
  assert.equal(calls, 0)
})

test('Profile Filler restored verification, resume and field editing cannot bypass the browser', async () => {
  let calls = 0; const errors: string[] = []
  const job: any = { jobId: 'old-profile-job', platformAccountId: 21, status: 'verifying',
    createdAt: '', updatedAt: '', plan: { steps: [] }, result: { status: 'verifying', steps: [
      { stepId: 'headline', status: 'verifying', writeIntent: { step: {}, savedAt: new Date(0).toISOString() } }
    ] } }
  const service = createProfileFillerService({ repository: repositories('octo')[1],
    store: { async list() { return [job] }, async get() { return job }, async update() {} },
    client: new Proxy({}, { get: () => async () => { calls++; throw Error('provider call forbidden') } }),
    executorOptions: { logger: { event(_kind: string, _status: string, details: any) { if(details?.errorCode) errors.push(details.errorCode) } } } })
  await service.recoverPending()
  assert.ok(errors.includes('linkedin_browser_unsupported'))
  // An invalid resume remains locally rejected; it must not start any provider work.
  await assert.rejects(service.resume(job.jobId), { code: 'profile_retry_not_ready' })
  job.status = 'waiting_retry'; job.result = undefined
  job.checkpoint = { version: 1, stage: 'resolving_job_titles', profile: {}, issues: [],
    generation: { model: 'mock', guideRevision: '1', cvRevision: '1', proxyCountry: 'Poland', generatedAt: '' } }
  await assert.rejects(service.resume(job.jobId), blocked)
  await assert.rejects(service.editField(job.jobId, 'hash', { path: 'headline', value: 'New' }), blocked)
  assert.equal(calls, 0)
})

test('Inviter manual and restored execution skip Octo before reconciliation or provider reads', async () => {
  for (const restored of [false, true]) {
    const f = connectionFixture()
    let reads = 0
    const row = (await f.repository.listAccounts())[0]
    const service = createConnectionInviterService({ ...f,
      repository: { ...f.repository, async getAccount() {
        reads++
        return { ...row, ...(restored && reads === 1 ? {} : { readinessErrorCode: 'dolphin_en_profile_not_found' }) }
      } }, autoRecover: false, enforceWriterSingleton: false,
      now: () => new Date('2026-09-07T12:00:00Z'), sleep: async () => {}, random: () => 0 })
    try {
      if (!restored) await assert.rejects(service.start(7), blocked)
      else {
        const run = await service.start(7)
        const result = await waitRun(service, run.runId)
        assert.equal(result.errorCode, 'linkedin_browser_unsupported')
      }
      assert.equal(f.metrics.reads, 0); assert.equal(f.metrics.sends, 0)
    } finally { service.stop() }
  }
})

test('Invitation withdrawal also excludes Octo before reading the invitation list', async () => {
  const f = connectionFixture(); let calls = 0
  const row = (await f.repository.listAccounts())[0]
  const service = composeInvitationWithdrawal({ ...f, repository: { ...f.repository,
    async getAccount() { return { ...row, readinessErrorCode: 'dolphin_en_profile_not_found' } } },
    now: () => new Date(), timeZone: 'Europe/Moscow', random: () => 0, sleep: async () => {},
    stopRequested: () => false, emit() {} }, () => {}, {
    provider: { async list() { calls++; throw Error('provider must not be called') },
      async withdraw() { calls++; throw Error('provider must not be called') } } as any,
    store: { async load() { return undefined }, async save() {} }
  })
  try { await assert.rejects(service.preview(7), blocked); assert.equal(calls, 0) }
  finally { await service.close() }
})

test('Stopped Octo inviter does not reconcile an unknown invitation through Unipile', async () => {
  const f = connectionFixture(); const now = new Date('2026-09-07T12:00:00Z')
  const row = (await f.repository.listAccounts())[0]
  const run = makeRun(accountContext(row), now, 'Europe/Moscow', false)
  await f.store.claimHistory({ historyKey: 'unknown', runId: run.runId, platformAccountId: 7,
    accountId: row.unipileAccountId, personId: 'unknown-person', status: 'uncertain',
    discoveredAt: now.toISOString(), updatedAt: now.toISOString() } as any)
  await executeConnectionRun({ ...f, repository: { ...f.repository,
    async getAccount() { return { ...row, readinessErrorCode: 'dolphin_en_profile_not_found' } } },
    adapter: () => f.adapter, now: () => now, timeZone: 'Europe/Moscow', random: () => 0,
    sleep: async () => {}, stopRequested: () => true, emit() {} }, run, new Set(), async () => {})
  assert.equal(run.errorCode, 'linkedin_browser_unsupported')
  assert.equal((await f.store.listRunHistory(run.runId))[0].status, 'uncertain')
  assert.equal(f.metrics.reads, 0); assert.equal(f.metrics.sends, 0)
})

test('Comment monitor manual selection and restored polling do not read or generate for Octo', async () => {
  let calls = 0
  const remote = new Proxy({}, { get: () => async () => { calls++; throw Error('remote call forbidden') } })
  const repository = repositories('octo')[1]
  await assert.rejects(selectPosts({ platformAccountId: 21, repository, adapter: remote,
    logger: quietLogger as any }), blocked)
  const now = new Date().toISOString()
  let saved: any = { jobId: 'restored-octo', platformAccountId: 21, accountId: 'fake-unipile',
    status: 'waiting', stage: 'waiting_next_check', clientName: 'SQL fixture', createdAt: now, updatedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    state: { posts: [], items: [], knownIds: [], checks: 0, discovered: 0, published: 0, failed: 0, threadReplies: {} } }
  const service = createCommentMonitorService({ autoStart: false, repository, adapter: remote, openai: remote,
    loggerFor: () => quietLogger, store: { async list() { return [structuredClone(saved)] },
      async update(job: any) { saved = structuredClone(job) }, async purge() {} } })
  try {
    for (let i = 0; i < 40 && saved.status !== 'error'; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(saved.errorCode, 'linkedin_browser_unsupported'); assert.equal(calls, 0)
  } finally { service.stop() }
})

test('Post Writer skips Octo before CV/model work and all saved execution stages', async () => {
  let calls = 0
  const repository = repositories('octo')[1]
  const source = createPostSource({ accounts: () => repository.listAccounts(),
    getAccount: (id, options) => repository.getAccount(id, options),
    cvRows: async () => { calls++; throw Error('CV read forbidden') }, selectCv: () => { throw Error('CV selection forbidden') },
    loadCv: async () => { calls++; throw Error('CV download forbidden') },
    extractFacts: async () => { calls++; throw Error('model call forbidden') } })
  await assert.rejects(source.context(21), blocked)
  assert.deepEqual(await source.accounts(), [])
  const f = postFixture()
  f.deps.source = source
  f.restart()
  try {
    await assert.rejects(f.service.start(21, 'automatic', 'octo-manual'), blocked)
    const e = createServiceState(f.deps).e
    for (const status of ['queued', 'generating', 'ready', 'verifying', 'published'] as const) {
      const run: any = { id: 'saved-'+status, account: 21, trigger: 'scheduled', mode: 'automatic', status,
        createdAt: 1, updatedAt: 1, executorId: 'test', likesEnabled: false, repairCount: 0, issues: [], stop: false,
        ...(status === 'verifying' ? { attemptedAt: 1 } : {}), engagement: { status: 'off', target: 0, items: [] } }
      await processRun(run, e)
      assert.equal(run.errorCode, 'linkedin_browser_unsupported')
      if (status === 'verifying') assert.equal(run.attemptedAt, 1) // Unknown intent/history is retained.
    }
    assert.equal(f.counts.publish, 0); assert.equal(f.counts.like, 0); assert.equal(calls, 0)
  } finally { await f.service.close() }
})

test('Saved Octo likers are skipped and an unknown like is retained without provider checks', async () => {
  const f = postFixture()
  f.deps.source.assertBrowser = async () => { throw Object.assign(Error('Octo'), blocked) }
  let reads = 0
  f.deps.adapter.identity = f.deps.adapter.reacted = async () => { reads++; throw Error('provider read forbidden') }
  const e = createServiceState(f.deps).e
  try {
    for (const status of ['pending', 'uncertain'] as const) {
      const item: any = { account: { platformAccountId: 204 }, status }
      const run: any = { id: 'likes-'+status, account: 203, postId: 'post', status: 'published', stop: false,
        likesEnabled: true, engagement: { status: 'running', requestedManually: true, items: [item], target: 1 } }
      await engage(run, e)
      assert.equal(item.status, status === 'pending' ? 'cancelled' : 'uncertain')
      assert.equal(item.errorCode, 'linkedin_browser_unsupported')
    }
    assert.equal(reads, 0); assert.equal(f.counts.like, 0)
  } finally { await f.service.close() }
})
