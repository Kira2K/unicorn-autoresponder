const assert = require('node:assert/strict')
const { discoverComments } = require('../discovery.ts') as typeof import('../discovery.ts')

async function run() {
  const { allPages } = require('../pagination.ts') as typeof import('../pagination.ts')
  const quiet = { event() {} }
  for (const response of [{}, { data: null }, { data: [], next_cursor: 'more' },
    { data: [], total_count: 2 }, { data: [{ id: 'a' }], next_cursor: 123 }]) {
    await assert.rejects(allPages(async () => response, quiet, 'comments_page'))
  }
  let calls = 0
  await assert.rejects(allPages(async () => ({ data: [{ id: String(++calls) }],
    next_cursor: calls === 1 ? 'a' : calls === 2 ? 'b' : 'a' }), quiet, 'replies_page'))
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(allPages(async () => ({ data: [{ id: String(++calls) }],
    next_cursor: String(calls) }), quiet, 'comments_page', 2))
  assert.equal(calls, 2)
  const positions: any[] = []
  const paged = await allPages(async position => {
    positions.push(position)
    return { data: [{ id: position === undefined ? 'first' : 'last' }], total_count: 2 }
  }, quiet, 'comments_page')
  assert.deepEqual(positions, [undefined, 1]); assert.equal(paged.length, 2)
  // Selecting two recent posts intentionally reads one page, not the entire history.
  const { selectPosts } = require('../post-selection.ts') as typeof import('../post-selection.ts')
  let postReads = 0
  const selection = await selectPosts({ platformAccountId: 1, logger: quiet,
    repository: { listAccounts: async () => [{ platformAccountId: 1, unipileAccountId: 'acc',
      unipileAccountStatus: 'running', lastVerifiedAt: 'today', verifiedProviderId: 'self' }] },
    adapter: { getAccount: async () => ({ user_id: 'self' }), listPosts: async () => {
      postReads++; return { data: [{ id: 'recent', text: 'text', created_at: '2026-10-01T00:00:00Z' }], next_cursor: 'older' }
    } } })
  assert.equal(postReads, 1); assert.equal(selection.posts[0].id, 'recent')
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
  let reads = 0, count = 1, time = 1_000_000
  const settled = { listComments: async () => ({ data: [{ id: 'settled', text: 'Question', reply_counter: count,
    created_at: '2026-01-01T00:00:00Z' }] }), listReplies: async () => {
    reads++; return { data: [{ id: 'answer', is_sender: true, created_at: '2026-01-01T00:01:00Z' },
      ...(count === 2 ? [{ id: 'new-question', text: 'New question', created_at: '2026-01-01T00:02:00Z' }] : [])] }
  } }
  const options = { job, adapter: settled, logger, now: () => time }
  await discoverComments(options); await discoverComments(options)
  assert.equal(reads, 1)
  time += 3_600_000; await discoverComments(options); assert.equal(reads, 2)
  count = 2
  assert.deepEqual((await discoverComments(options)).map(item => item.incomingId), ['new-question'])
  assert.equal(reads, 3)
}

run().then(() => console.log('comment discovery tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
