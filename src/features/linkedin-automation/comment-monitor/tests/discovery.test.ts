const assert = require('node:assert/strict')
const { discoverComments } = require('../discovery.ts') as typeof import('../discovery.ts')

async function run() {
  const events: any[] = []
  const logger = { event(stage: string, status: string, details?: any) {
    events.push({ stage, status, details })
  } }
  const job: any = { accountId: 'account', state: { posts: [{ id: 'post', text: 'Retries matter.' }],
    items: [], knownIds: [], discovered: 0 } }
  const adapter = {
    async listComments() { return { items: [
      { id: 'comment', text: 'How do retries work?', created_at: '2026-01-01T00:00:00Z',
        reply_counter: 2, can_reply: true },
      { id: 'own', text: 'Own note', is_sender: true, created_at: '2026-01-01T00:04:00Z' }
    ] } },
    async listReplies() { return { items: [
      { id: 'student', text: 'Earlier answer', is_sender: true, created_at: '2026-01-01T00:01:00Z' },
      { id: 'followup', text: 'What about jitter?', can_reply: true,
        created_at: '2026-01-01T00:02:00Z' }
    ] } }
  }
  const first = await discoverComments({ job, adapter, logger })
  assert.deepEqual(first.map(item => item.incomingId), ['followup'])
  assert.equal(job.state.discovered, 1)
  assert.equal((await discoverComments({ job, adapter, logger })).length, 0)
  assert.ok(events.some(event => event.stage === 'comment_deduplicate'))
}

run().then(() => console.log('comment discovery tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
