const assert = require('node:assert/strict')
const { clearAuthorContext, resolveAuthorContext } = require('../author-context.ts') as
  typeof import('../author-context.ts')
const { monitorJobFromRow, monitorJobRow } = require('../job-row.ts') as typeof import('../job-row.ts')
const { publicMonitorJob } = require('../types.ts') as typeof import('../types.ts')
const { createCommentUnipileAdapter } = require('../unipile-adapter.ts') as
  typeof import('../unipile-adapter.ts')

const job = () => ({ jobId: 'job', platformAccountId: 7, accountId: 'account',
  clientName: 'Student', status: 'checking', stage: 'reading', state: {},
  expiresAt: '2026-08-27T00:00:00.000Z', createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z' }) as any

async function run() {
  let now = Date.parse('2026-08-25T00:00:00.000Z'); let reads = 0; let saves = 0
  const events: any[] = []; const logger = { event(stage: string, status: string, details?: any) {
    events.push({ stage, status, details })
  } }
  const current = job(); const adapter = { async getOwnProfile() {
    reads += 1; return { description: 'Secret Headline', bio: 'Secret About' }
  } }
  const options = { job: current, adapter, logger, now: () => now,
    save: async () => { saves += 1 } }
  assert.deepEqual(await resolveAuthorContext(options), {
    headline: 'Secret Headline', about: 'Secret About' })
  assert.equal(reads, 1); assert.equal(saves, 1); assert.equal(current.authorContextStatus, 'ready')
  await resolveAuthorContext(options); assert.equal(reads, 1)
  now += 24 * 60 * 60_000 + 1; await resolveAuthorContext(options); assert.equal(reads, 2)
  const restored = monitorJobFromRow({ Id: 1, ...monitorJobRow(current) })
  assert.equal(restored.authorHeadline, 'Secret Headline')
  let restoredReads = 0
  await resolveAuthorContext({ job: restored, logger, now: () => now,
    save: async () => undefined, adapter: { async getOwnProfile() { restoredReads += 1 } } })
  assert.equal(restoredReads, 0)
  assert.equal('authorHeadline' in publicMonitorJob(current), false)
  assert.equal('authorAbout' in publicMonitorJob(current), false)
  assert.doesNotMatch(JSON.stringify(events), /Secret Headline|Secret About/)
  let endpoint = ''
  const realAdapter = createCommentUnipileAdapter({ scheduler: { run: (action: any) => action() },
    http: { async request(_method: string, path: string) { endpoint = path; return {} } } })
  await realAdapter.getOwnProfile('account', logger)
  assert.equal(endpoint, '/account/users/me?variant=linkedin_classic')

  const partial = job()
  assert.deepEqual(await resolveAuthorContext({ job: partial, logger, now: () => now,
    save: async () => undefined, adapter: { async getOwnProfile() {
      return { description: 'Headline only' }
    } } }), { headline: 'Headline only' })
  assert.equal(partial.authorContextStatus, 'ready')
  const empty = job(); let emptyReads = 0
  const emptyOptions = { job: empty, logger, now: () => now, save: async () => undefined,
    adapter: { async getOwnProfile() { emptyReads += 1; return {} } } }
  assert.deepEqual(await resolveAuthorContext(emptyOptions), {})
  await resolveAuthorContext(emptyOptions); assert.equal(emptyReads, 1)
  assert.equal(empty.authorContextStatus, 'empty')

  const failed = job(); let failures = 0
  const failedOptions = { job: failed, logger, now: () => now, save: async () => undefined,
    adapter: { async getOwnProfile() { failures += 1; throw Object.assign(new Error('timeout'),
      { code: 'unipile_timeout' }) } } }
  assert.deepEqual(await resolveAuthorContext(failedOptions), {})
  await resolveAuthorContext(failedOptions); assert.equal(failures, 1)
  now += 30 * 60_000 + 1; await resolveAuthorContext(failedOptions); assert.equal(failures, 2)
  clearAuthorContext(current, logger); assert.equal(current.authorContextStatus, undefined)
}

run().then(() => console.log('comment author context tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
