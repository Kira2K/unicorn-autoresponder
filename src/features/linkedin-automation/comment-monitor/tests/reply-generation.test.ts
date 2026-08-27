const assert = require('node:assert/strict')
const { generateReplies } = require('../reply-generation.ts') as typeof import('../reply-generation.ts')

async function run() {
  const now = new Date().toISOString()
  const items = Array.from({ length: 8 }, (_, index) => ({ incomingId: `in-${index}`,
    postId: 'post', parentId: `in-${index}`, threadId: 'thread', incomingText: 'retries',
    threadText: 'distributed systems', status: 'detected', createdAt: now, updatedAt: now })) as any[]
  const job: any = { state: { posts: [{ id: 'post', text: 'distributed systems' }], items,
    published: 0, failed: 0, threadReplies: {} } }
  const inputs: any[] = []
  const openai = { async generate(input: any) { inputs.push(input); return { replies:
    input.items.map((item: any) => ({
    incoming_id: item.incoming_id, reply: 'Reliable retries keep distributed systems resilient.',
    grounding_phrase: 'distributed systems' })) } } }
  let contextLoads = 0
  const queued = await generateReplies({ job, items, openai, logger: { event() {} },
    loadAuthorContext: async () => { contextLoads += 1; return {
      headline: 'Backend Engineer', about: 'Builds reliable systems.' } } })
  assert.equal(queued.length, 7)
  assert.equal(items.filter(item => item.reasonCode === 'comment_thread_limit_reached').length, 1)
  assert.equal(contextLoads, 1)
  assert(inputs.every(input => input.author_context.headline === 'Backend Engineer'))

  const repairItem: any = { ...items[0], incomingId: 'repair', parentId: 'repair',
    threadId: 'repair-thread', status: 'detected' }
  const repairJob: any = { state: { ...job.state, items: [repairItem], published: 0,
    failed: 0, threadReplies: {} } }
  const repairInputs: any[] = []
  await generateReplies({ job: repairJob, items: [repairItem], logger: { event() {} },
    loadAuthorContext: async () => ({ headline: 'Backend Engineer' }),
    openai: { async generate(input: any) { repairInputs.push(input); return { replies: [{
      incoming_id: 'repair', reply: repairInputs.length === 1 ? 'Invalid.' :
        'Reliable retries keep distributed systems resilient.',
      grounding_phrase: 'distributed systems' }] } } } })
  assert.equal(repairInputs.length, 2)
  assert.equal(repairInputs[1].author_context.headline, 'Backend Engineer')

  const blocked: any = { ...items[0], incomingId: 'blocked', status: 'detected' }
  const blockedJob: any = { state: { ...job.state, items: [blocked], published: 30,
    failed: 0, threadReplies: {} } }
  let blockedLoads = 0
  await generateReplies({ job: blockedJob, items: [blocked], openai, logger: { event() {} },
    loadAuthorContext: async () => { blockedLoads += 1; return {} } })
  assert.equal(blockedLoads, 0)
}

run().then(() => console.log('comment reply generation tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
