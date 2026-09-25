const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createConnectionUnipileAdapter } = require('../unipile-adapter.ts') as typeof import('../unipile-adapter.ts')
const { withConnectionRequestTrace, recordPendingReuse } = require('../logger.ts') as typeof import('../logger.ts')
const { withConnectionRetry } = require('../retry-state.ts') as typeof import('../retry-state.ts')
const { createConnectionLogger } = require('../logger.ts') as typeof import('../logger.ts')
const { createUnipileHttpClient } = require('../../../../integrations/unipile/http-client.ts') as any
const { fixture } = require('./fixtures.ts') as typeof import('./fixtures.ts')
const { invitationRun, invitationRuntime } = require('./invitation-test-fixtures.ts') as typeof import('./invitation-test-fixtures.ts')

test('shared queued adapter captures run/account before enqueue, even outside async context', async () => {
  const records: any[] = []; const queue: (() => Promise<void>)[] = []
  const logger = createConnectionLogger({ writeLine: line => records.push(JSON.parse(line)) })
  const adapter = createConnectionUnipileAdapter({ logger,
    scheduler: { run(action: () => Promise<unknown>) {
      return new Promise((resolve, reject) => queue.push(async () => {
        try { resolve(await action()) } catch (error) { reject(error) }
      }))
    } }, http: { async request() { return { data: [] } } } })
  const runs = [invitationRun(), invitationRun()]
  runs[1].runId = 'second-run'; runs[1].accountId = 'private-second-account'; runs[1].platformAccountId = 8
  const results = runs.map(run => withConnectionRequestTrace(run, logger,
    () => adapter.listPendingInvitations(run.accountId)))
  assert.equal(queue.length, 2)
  // Deliberately execute outside either request's async-local context, in reverse order.
  for (const action of queue.reverse()) await action()
  await Promise.all(results)
  const starts = records.filter(r => r.stage === 'unipile_request' && r.status === 'started')
  assert.deepEqual(starts.map(r => [r.runId, r.platformAccountId]),
    [[runs[1].runId, 8], [runs[0].runId, 7]])
  const summaries = records.filter(r => r.stage === 'unipile_request_summary')
  assert.equal(summaries.length, 2)
  assert.equal(new Set(summaries.map(r => r.executionId)).size, 2)
  for (const record of summaries) assert.equal(record.unipileRequests, 1)
  assert.doesNotMatch(JSON.stringify(records), /private-second-account/)
})

test('physical attempts, wrapper retries, pages and cache reuse are counted independently', async () => {
  const records: any[] = []; let requests = 0
  const logger = createConnectionLogger({ writeLine: line => records.push(JSON.parse(line)) })
  const http = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => {
    requests++
    if (requests === 1) throw new Error('network unavailable')
    return new Response('{"data":[]}', { headers: { 'X-Cache': 'HIT', Age: '20' } })
  } })
  const adapter = createConnectionUnipileAdapter({ logger, http, scheduler: { run: (action: any) => action() } })
  const setup = fixture(); const runtime = invitationRuntime(setup, { logger }); const run = invitationRun()
  await withConnectionRequestTrace(run, logger, async () => {
    await withConnectionRetry(runtime, run, async () => undefined, 'unipile', 'scan',
      () => adapter.listPendingInvitations(run.accountId))
    recordPendingReuse('pending_reconciliation_reused')
  })
  const summary = records.find(r => r.stage === 'unipile_request_summary')
  assert.equal(requests, 2); assert.equal(summary.unipileRequests, 2)
  assert.equal(summary.unipileRetries, 1); assert.equal(summary.unipilePages, 2)
  assert.equal(summary.unipileFailures, 1); assert.equal(summary.providerCacheHits, 1)
  assert.equal(records.find(r => r.stage === 'pending_cache_summary').cacheUses, 1)
  const succeeded = records.find(r => r.stage === 'unipile_request' && r.status === 'succeeded')
  assert.equal(succeeded.providerCache, 'HIT'); assert.equal(succeeded.providerCacheAgeSeconds, 20)
  assert.equal(succeeded.retryAttempt, 2)
})
