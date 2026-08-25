const assert = require('node:assert/strict')
const { generateReplies } = require('../reply-generation.ts') as typeof import('../reply-generation.ts')

async function run() {
  const now = new Date().toISOString()
  const items = Array.from({ length: 8 }, (_, index) => ({ incomingId: `in-${index}`,
    postId: 'post', parentId: `in-${index}`, threadId: 'thread', incomingText: 'retries',
    threadText: 'distributed systems', status: 'detected', createdAt: now, updatedAt: now })) as any[]
  const job: any = { state: { posts: [{ id: 'post', text: 'distributed systems' }], items,
    published: 0, failed: 0, threadReplies: {} } }
  const openai = { async generate(input: any) { return { replies: input.items.map((item: any) => ({
    incoming_id: item.incoming_id, reply: 'Reliable retries keep distributed systems resilient.',
    grounding_phrase: 'distributed systems' })) } } }
  const queued = await generateReplies({ job, items, openai, logger: { event() {} } })
  assert.equal(queued.length, 7)
  assert.equal(items.filter(item => item.reasonCode === 'comment_thread_limit_reached').length, 1)
}

run().then(() => console.log('comment reply generation tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
