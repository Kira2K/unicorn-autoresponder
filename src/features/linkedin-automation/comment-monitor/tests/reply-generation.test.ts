const assert = require('node:assert/strict')
const { generateReplies } = require('../reply-generation.ts') as typeof import('../reply-generation.ts')

async function run() {
  const now = new Date().toISOString()
  const items = Array.from({ length: 8 }, (_, index) => ({ incomingId: `in-${index}`,
    postId: 'post', parentId: `in-${index}`, threadId: 'thread',
    incomingText: 'How do reliable retries work?',
    threadText: 'distributed systems', status: 'detected', createdAt: now, updatedAt: now })) as any[]
  const job: any = { state: { posts: [{ id: 'post', text: 'distributed systems' }], items,
    published: 0, failed: 0, threadReplies: {} } }
  const inputs: any[] = []
  const openai = { async generate(input: any) { inputs.push(input); return { replies:
    input.items.map((item: any) => ({
    incoming_id: item.incoming_id, action: 'reply', reason: 'reply',
    reply: 'Reliable retries keep distributed systems resilient.',
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
      incoming_id: 'repair', action: 'reply', reason: 'reply',
      reply: repairInputs.length === 1 ? 'Invalid.' :
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

  const shortItems: any[] = [
    { ...items[0], incomingId: 'emoji', parentId: 'emoji', threadId: 'emoji',
      incomingText: '🔥', status: 'detected' },
    { ...items[0], incomingId: 'single', parentId: 'single', threadId: 'single',
      incomingText: 'Thanks!', status: 'detected' }
  ]
  let shortCalls = 0
  const shortJob: any = { state: { ...job.state, items: shortItems, published: 0,
    failed: 0, threadReplies: {} } }
  assert.deepEqual(await generateReplies({ job: shortJob, items: shortItems,
    openai: { async generate() { shortCalls += 1 } }, logger: { event() {} } }), [])
  assert.equal(shortCalls, 0)
  assert.ok(shortItems.every(item => item.status === 'ignored' &&
    item.reasonCode === 'too_short'))

  const policyItems: any[] = [
    { ...items[0], incomingId: 'ai', parentId: 'ai', threadId: 'ai',
      incomingText: 'Did ChatGPT write this post?', status: 'detected' },
    { ...items[0], incomingId: 'provocation', parentId: 'provocation', threadId: 'provocation',
      incomingText: 'Defend this nonsense if you dare.', status: 'detected' },
    { ...items[0], incomingId: 'insult', parentId: 'insult', threadId: 'insult',
      incomingText: 'Only an idiot believes this claim.', status: 'detected' },
    { ...items[0], incomingId: 'criticism', parentId: 'criticism', threadId: 'criticism',
      incomingText: 'I disagree because retries increase load.', status: 'detected' },
    { ...items[0], incomingId: 'praise', parentId: 'praise', threadId: 'praise',
      incomingText: 'Great post!', status: 'detected' },
    { ...items[0], incomingId: 'ai-topic', parentId: 'ai-topic', threadId: 'ai-topic',
      incomingText: 'AI improves distributed systems reliability.', status: 'detected' },
    { ...items[0], incomingId: 'irrelevant-trivia', parentId: 'irrelevant-trivia',
      threadId: 'irrelevant-trivia', incomingText: 'Как зовут королеву Британии?',
      status: 'detected' },
    { ...items[0], incomingId: 'irrelevant-advertising', parentId: 'irrelevant-advertising',
      threadId: 'irrelevant-advertising',
      incomingText: 'Visit our company page for consulting offers.', status: 'detected' },
    { ...items[0], incomingId: 'relevant-question', parentId: 'relevant-question',
      threadId: 'relevant-question', incomingText: 'Why does this retry strategy matter?',
      status: 'detected' },
    { ...items[0], incomingId: 'uncertain', parentId: 'uncertain', threadId: 'uncertain',
      incomingText: 'I am not sure how this applies here.', status: 'detected' }
  ]
  const policyJob: any = { state: { ...job.state, items: policyItems, published: 0,
    failed: 0, threadReplies: {} } }
  const policySkips: Record<string, string> = { ai: 'ai_authorship_question',
    provocation: 'provocation', insult: 'insult',
    'irrelevant-trivia': 'irrelevant_to_context',
    'irrelevant-advertising': 'irrelevant_to_context' }
  const policyQueued = await generateReplies({ job: policyJob, items: policyItems,
    logger: { event() {} }, openai: { async generate(input: any) { return { replies:
      input.items.map((row: any) => policySkips[row.incoming_id]
        ? { incoming_id: row.incoming_id, action: 'skip',
          reason: policySkips[row.incoming_id],
          reply: '', grounding_phrase: '' }
        : { incoming_id: row.incoming_id, action: 'reply', reason: 'reply',
          reply: 'Reliable retries keep distributed systems resilient.',
          grounding_phrase: 'distributed systems' }) } } } })
  assert.deepEqual(policyItems.filter(item => item.status === 'ignored')
    .map(item => item.reasonCode), ['ai_authorship_question', 'provocation', 'insult',
      'irrelevant_to_context', 'irrelevant_to_context'])
  assert.deepEqual(policyQueued.map(item => item.incomingId), [
    'criticism', 'praise', 'ai-topic', 'relevant-question', 'uncertain'])

  const contextualItems: any[] = [
    { ...items[0], incomingId: 'systems-question', postId: 'systems-post',
      parentId: 'systems-question', threadId: 'systems-question',
      incomingText: 'Как зовут королеву Британии?', status: 'detected' },
    { ...items[0], incomingId: 'monarchy-question', postId: 'monarchy-post',
      parentId: 'monarchy-question', threadId: 'monarchy-question',
      incomingText: 'Как зовут королеву Британии?', status: 'detected' }
  ]
  const contextualJob: any = { state: { ...job.state, posts: [
    { id: 'systems-post', text: 'distributed systems retries' },
    { id: 'monarchy-post', text: 'British monarchy succession' }
  ], items: contextualItems, published: 0, failed: 0, threadReplies: {} } }
  const contextualQueued = await generateReplies({ job: contextualJob, items: contextualItems,
    logger: { event() {} }, openai: { async generate(input: any) { return { replies:
      input.items.map((row: any) => row.post.includes('monarchy')
        ? { incoming_id: row.incoming_id, action: 'reply', reason: 'reply',
          reply: 'British monarchy context makes that question relevant.',
          grounding_phrase: 'British monarchy' }
        : { incoming_id: row.incoming_id, action: 'skip',
          reason: 'irrelevant_to_context', reply: '', grounding_phrase: '' }) } } } })
  assert.equal(contextualItems[0].status, 'ignored')
  assert.equal(contextualItems[0].reasonCode, 'irrelevant_to_context')
  assert.deepEqual(contextualQueued.map(item => item.incomingId), ['monarchy-question'])

  const mixedItems: any[] = Array.from({ length: 8 }, (_, index) => ({ ...items[0],
    incomingId: `mixed-${index}`, parentId: `mixed-${index}`, threadId: 'mixed-thread',
    incomingText: index ? 'How do reliable retries work?' : 'Did ChatGPT write this post?',
    status: 'detected' }))
  const mixedJob: any = { state: { ...job.state, items: mixedItems, published: 0,
    failed: 0, threadReplies: {} } }
  const mixedQueued = await generateReplies({ job: mixedJob, items: mixedItems,
    logger: { event() {} }, openai: { async generate(input: any) { return { replies:
      input.items.map((row: any) => row.incoming_id === 'mixed-0'
        ? { incoming_id: row.incoming_id, action: 'skip', reason: 'ai_authorship_question',
          reply: '', grounding_phrase: '' }
        : { incoming_id: row.incoming_id, action: 'reply', reason: 'reply',
          reply: 'Reliable retries keep distributed systems resilient.',
          grounding_phrase: 'distributed systems' }) } } } })
  assert.equal(mixedQueued.length, 7)
  assert.equal(mixedItems[0].reasonCode, 'ai_authorship_question')
  assert.equal(mixedItems.filter(item => item.reasonCode === 'comment_thread_limit_reached').length, 0)

  const orderedItems: any[] = ['older', 'newer'].map((incomingId, index) => ({ ...items[0],
    incomingId, parentId: incomingId, threadId: 'ordered-thread',
    incomingText: 'How do reliable retries work?', status: 'detected',
    createdAt: new Date(Date.now() + index).toISOString() }))
  const orderedJob: any = { state: { ...job.state, items: orderedItems, published: 0,
    failed: 0, threadReplies: { 'ordered-thread': 6 } } }
  let orderedCall = 0
  const orderedQueued = await generateReplies({ job: orderedJob, items: orderedItems,
    logger: { event() {} }, openai: { async generate(input: any) {
      orderedCall += 1
      return { replies: input.items.map((row: any) => ({ incoming_id: row.incoming_id,
        action: 'reply', reason: 'reply',
        reply: orderedCall === 1 && row.incoming_id === 'older' ? 'Invalid.' :
          'Reliable retries keep distributed systems resilient.',
        grounding_phrase: 'distributed systems' })) }
    } } })
  assert.deepEqual(orderedQueued.map(item => item.incomingId), ['older'])
  assert.equal(orderedItems[1].status, 'ignored')
  assert.equal(orderedItems[1].reasonCode, 'comment_thread_limit_reached')

  const staleItems: any[] = ['stale-valid', 'stale-invalid'].map(incomingId => ({ ...items[0],
    incomingId, parentId: incomingId, threadId: incomingId,
    incomingText: 'This comment has several meaningful words.', status: 'detected',
    replyText: 'Old reply text.', replyId: 'old-reply', reasonCode: 'insult' }))
  const staleJob: any = { state: { ...job.state, items: staleItems, published: 0,
    failed: 0, threadReplies: {} } }
  let staleCall = 0
  await assert.rejects(() => generateReplies({ job: staleJob, items: staleItems,
    logger: { event() {} }, openai: { async generate(input: any) {
      staleCall += 1
      if (staleCall === 2) throw new Error('repair unavailable')
      return { replies: input.items.map((row: any) => ({ incoming_id: row.incoming_id,
        action: 'reply', reason: 'reply',
        reply: row.incoming_id === 'stale-invalid' ? 'Invalid.' :
          'Reliable retries keep distributed systems resilient.',
        grounding_phrase: 'distributed systems' })) }
    } } }), /repair unavailable/)
  assert.ok(staleItems.every(item => item.status === 'detected' &&
    item.replyText === undefined && item.replyId === undefined && item.reasonCode === undefined))

  await generateReplies({ job: staleJob, items: [staleItems[0]], logger: { event() {} },
    openai: { async generate() { return { replies: [{ incoming_id: 'stale-valid',
      action: 'skip', reason: 'provocation', reply: '', grounding_phrase: '' }] } } } })
  assert.equal(staleItems[0].status, 'ignored')
  assert.equal(staleItems[0].replyText, undefined)
  assert.equal(staleItems[0].replyId, undefined)

  const requeued: any = { ...items[0], incomingId: 'requeued', parentId: 'requeued',
    threadId: 'requeued', incomingText: 'This comment has several meaningful words.',
    status: 'detected', replyText: 'Old reply text.', replyId: 'old-reply', reasonCode: 'insult' }
  const requeuedJob: any = { state: { ...job.state, items: [requeued], published: 0,
    failed: 0, threadReplies: {} } }
  await generateReplies({ job: requeuedJob, items: [requeued], logger: { event() {} },
    openai: { async generate() { return { replies: [{ incoming_id: 'requeued', action: 'reply',
      reason: 'reply', reply: 'Reliable retries keep distributed systems resilient.',
      grounding_phrase: 'distributed systems' }] } } } })
  assert.equal(requeued.status, 'queued')
  assert.equal(requeued.reasonCode, undefined)
  assert.equal(requeued.replyId, undefined)
}

run().then(() => console.log('comment reply generation tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
