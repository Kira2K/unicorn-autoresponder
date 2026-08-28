const assert = require('node:assert/strict')
const { pollMonitorJob } = require('../poll-job.ts') as typeof import('../poll-job.ts')

const job = () => ({ jobId: 'job', platformAccountId: 105, accountId: 'account', clientName: 'Diana',
  status: 'waiting', stage: 'waiting_next_check', nextCheckAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), authorHeadline: 'Private', authorContextStatus: 'ready',
  authorContextFetchedAt: new Date().toISOString(), state: { posts: [{ id: 'post', text: 'Post' }],
    items: [], knownIds: [], checks: 0, discovered: 0, published: 0, failed: 0,
    threadReplies: {} } }) as any

const providerError = (code: string, httpStatus: number) => Object.assign(new Error('provider'), {
  code, details: { httpStatus, requestId: 'safe-request' } })
const dependencies = (failure: any, events: any[]) => ({ store: { async update() {} },
  adapter: { async listComments() { return { items: [{ id: 'comment', text: 'Text',
    reply_counter: 1 }] } }, async listReplies() { throw failure } },
  openai: { async generate() { throw new Error('must not run') } }, random: () => 0,
  sleep: async () => undefined, logger: { event(stage: string, status: string, details?: any) {
    events.push({ stage, status, ...details })
  } } })

async function run() {
  const retryEvents: any[] = []; const retryJob = job()
  await pollMonitorJob({ job: retryJob, ...dependencies(
    providerError('unipile_api_internal_error', 500), retryEvents) })
  assert.equal(retryJob.status, 'waiting')
  assert.equal(retryJob.stage, 'temporary_provider_limit')
  assert.equal(retryJob.errorCode, 'unipile_api_internal_error')
  assert.ok(Date.parse(retryJob.nextCheckAt) > Date.now())
  assert.equal(retryJob.authorContextStatus, 'ready')
  assert.equal(retryEvents.find(event => event.stage === 'monitor_check').level, 'warn')

  const terminalEvents: any[] = []; const terminalJob = job()
  await pollMonitorJob({ job: terminalJob, ...dependencies(
    providerError('unipile_provider_invalid_parameters', 400), terminalEvents) })
  assert.equal(terminalJob.status, 'error'); assert.equal(terminalJob.stage, 'monitor_failed')
  assert.equal(terminalJob.nextCheckAt, undefined); assert.ok(terminalJob.finishedAt)
  assert.equal(terminalJob.authorContextStatus, undefined)
  assert.equal(terminalEvents.find(event => event.stage === 'monitor_check').level, 'error')

  const nocoEvents: any[] = []; const nocoJob = job(); let saves = 0
  await pollMonitorJob({ job: nocoJob, ...dependencies(new Error('must not read'), nocoEvents),
    store: { async update() {
      saves += 1
      if (saves === 1) throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
    } } })
  assert.equal(nocoJob.status, 'waiting')
  assert.equal(nocoJob.stage, 'temporary_provider_limit')
  assert.equal(nocoJob.errorCode, 'noco_timeout')
  assert.equal(nocoJob.authorContextStatus, 'ready')
  assert.equal(nocoEvents.find(event => event.stage === 'monitor_check').level, 'warn')
}

run().then(() => console.log('comment monitor polling tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
