const assert = require('node:assert/strict')
const { publishReplies } = require('../reply-publisher.ts') as typeof import('../reply-publisher.ts')
const { reconcileUncertain } = require('../reply-verification.ts') as
  typeof import('../reply-verification.ts')

const baseJob = () => ({ accountId: 'account', status: 'replying', state: { published: 0,
  failed: 0, threadReplies: {}, items: [] } }) as any
const item = () => ({ incomingId: 'incoming', postId: 'post', parentId: 'incoming',
  threadId: 'thread', incomingText: 'text', threadText: 'text',
  replyText: 'Reliable retries keep distributed systems resilient.', status: 'queued',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) as any

async function run() {
  const logger = { event() {} }
  const job = baseJob(); const value = item(); job.state.items = [value]
  await publishReplies({ job, items: [value], logger, save: async () => undefined,
    sleep: async () => undefined, adapter: {
      async reply() { return { id: 'reply-id' } },
      async listReplies() { return { items: [{ id: 'reply-id', is_sender: true,
        text: value.replyText }] } }
    } })
  assert.equal(value.status, 'verified'); assert.equal(job.state.published, 1)

  const uncertainJob = baseJob(); const uncertain = item(); uncertainJob.state.items = [uncertain]
  await assert.rejects(() => publishReplies({ job: uncertainJob, items: [uncertain], logger,
    save: async () => undefined, sleep: async () => undefined, adapter: {
      async reply() { throw Object.assign(new Error('timeout'), { code: 'unipile_timeout' }) },
      async listReplies() { return { items: [] } }
    } }), { code: 'comment_reply_uncertain' })
  assert.equal(uncertain.status, 'uncertain')
  let writes = 0
  await reconcileUncertain({ job: uncertainJob, logger, save: async () => undefined, adapter: {
    async reply() { writes += 1 }, async listReplies() { return { items: [] } }
  } })
  assert.equal(writes, 0); assert.equal(uncertain.status, 'failed')
}

run().then(() => console.log('comment publisher tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
