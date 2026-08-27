const assert = require('node:assert/strict')
const { createCommentMonitorService } = require('../service.ts') as {
  createCommentMonitorService(options: any): any
}

const wait = () => new Promise(resolve => setTimeout(resolve, 30))
function memoryStore(seed: any[] = []) {
  const jobs = new Map(seed.map(job => [job.jobId, structuredClone(job)]))
  return { jobs, async list() { return [...jobs.values()].map(job => structuredClone(job)) },
    async get(id: string) { const job = jobs.get(id); return job && structuredClone(job) },
    async create(job: any) { jobs.set(job.jobId, structuredClone(job)) },
    async update(job: any) { jobs.set(job.jobId, structuredClone(job)) }, async purge() {} }
}
const loggerFor = () => ({ event() {} })

async function run() {
  const store = memoryStore()
  const service = createCommentMonitorService({ autoStart: false, store, loggerFor,
    repository: { async listAccounts() { return [{ platformAccountId: 7, clientName: 'Diana',
      unipileAccountId: 'account', unipileAccountStatus: 'running', lastVerifiedAt: 'now' }] } },
    adapter: { async getAccount() { return { user_id: 'user' } },
      async listPosts() { return { items: [
        { id: 'old', text: 'Old', created_at: '2026-01-01T00:00:00Z' },
        { id: 'new', text: 'New', created_at: '2026-01-02T00:00:00Z' }] } },
      async listComments() { return { items: [] } }, async listReplies() { return { items: [] } } },
    openai: { async generate() { throw new Error('must not be called') } }, random: () => 0,
    sleep: async () => undefined })
  const first = await service.enable(7)
  const second = await service.enable(7)
  assert.equal(second.jobId, first.jobId)
  await wait()
  const current = (await service.list())[0]
  assert.deepEqual(current.state.posts.map((post: any) => post.id), ['new', 'old'])
  assert.equal(current.state.checks, 1); assert.equal(current.status, 'waiting')
  assert.equal((await service.disable(7)).status, 'disabled')
  service.stop()

  const publishing = { ...(await store.get(first.jobId)), status: 'replying', stage: 'publishing',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), authorHeadline: 'Private Headline',
    authorAbout: 'Private About', authorContextStatus: 'ready',
    authorContextFetchedAt: new Date().toISOString() }
  publishing.state.items = [{ incomingId: 'in', postId: 'post', threadId: 'thread',
    parentId: 'in', incomingText: 'comment', threadText: 'thread', replyText: 'A valid reply.',
    status: 'publishing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
  const restoredStore = memoryStore([publishing])
  const restored = createCommentMonitorService({ autoStart: false, store: restoredStore, loggerFor,
    repository: {}, adapter: {}, openai: {} })
  await wait()
  const paused = (await restored.list())[0]
  assert.equal(paused.status, 'paused')
  assert.equal(paused.state.items[0].status, 'uncertain')
  assert.equal('authorHeadline' in paused, false)
  assert.equal((await restoredStore.get(first.jobId)).authorContextStatus, 'ready')
  await restored.disable(7)
  const disabled = await restoredStore.get(first.jobId)
  assert.equal(disabled.authorHeadline, undefined)
  assert.equal(disabled.authorContextStatus, undefined)
  restored.stop()

  const terminal = { ...publishing, jobId: 'terminal', status: 'completed', stage: 'expired' }
  terminal.state.items = []
  const terminalStore = memoryStore([terminal])
  const terminalService = createCommentMonitorService({ autoStart: false, store: terminalStore,
    loggerFor, repository: {}, adapter: {}, openai: {} })
  await wait()
  const cleaned = await terminalStore.get('terminal')
  assert.equal(cleaned.authorContextStatus, undefined)
  assert.equal(cleaned.authorAbout, undefined)
  terminalService.stop()
}

run().then(() => console.log('comment monitor service tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
