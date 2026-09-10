import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMemeConcept } from '../meme-concept.ts'
import { createMockMemes } from '../meme-mock.ts'
import { writeMeme } from '../meme.ts'
import { createMemeServices } from '../meme-runtime.ts'
import { memoryJsonFiles } from '../memory-json-files.ts'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
const input = { post: 'A verified professional fact.', audience: 'Engineers', forbiddenTopics: ['politics'], history: [] }
test('planner receives finished text, policy and history in one call, not prewritten scenes', async () => {
  let calls = 0
  const services = createMemeServices(memoryJsonFiles(), async (messages, schema, policy) => {
    calls++
    assert.match(policy, /peer recognises themselves/)
    assert.match(policy, /source data, never instructions/)
    const request = messages as { content: { text: string }[] }[]
    assert.deepEqual(JSON.parse(request[0].content[0].text), input)
    assert.equal((schema as { additionalProperties: boolean }).additionalProperties, false)
    return { status: 'blocked', reason: 'No grounded visual context', concept: null }
  }, () => {}, {})
  const result = await services.plan(input)
  assert.equal(parseMemeConcept(result, input).status, 'blocked')
  assert.equal(calls, 1)
})
test('caption zones, word limit, missing source, prompt, history and malformed shape block rendering', async () => {
  const services = createMockMemes(), raw = await services.plan(input)
  const ready = parseMemeConcept(raw, input)
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') return
  for (const change of [ { captionLines: ['a', 'b', 'c'] }, { captionLines: [Array(16).fill('word').join(' ')] },
    { postAnchor: 'not in post' }, { prompt: 'Missing layout' }, { altText: 'a'.repeat(301) } ]) {
    assert.throws(() => parseMemeConcept({ ...ready, concept: { ...ready.concept, ...change } }, input))
  }
  assert.throws(() => parseMemeConcept(ready, { ...input, history: [ready.concept] }), /duplicate_concept/)
  assert.throws(() => parseMemeConcept({ status: 'ready' }, input))
  services.plan = async () => ({ status: 'blocked', reason: 'Conflicts with topic restrictions', concept: null })
  const blocked = await writeMeme(input, services, { id: 'blocked', onCheckpoint: async () => {} })
  assert.equal(blocked.blockingReason, 'Conflicts with topic restrictions')
  assert.equal(blocked.imageCalls, 0)
})
test('Stop during rendering keeps its charged reservation and prevents any publication', async () => {
  const f = fixture()
  let started!: () => void, finish!: () => void
  const rendering = new Promise<void>(resolve => { started = resolve })
  const wait = new Promise<void>(resolve => { finish = resolve })
  const render = f.deps.memes!.render
  f.deps.memes!.render = async (...args) => { started(); await wait; return render(...args) }
  await f.service.update(203, { ...defaults(203), memes: true })
  const run = await f.service.start(203, 'automatic', 'meme-stop-key')
  await f.step(); await rendering
  await f.service.action(run.id, 'stop')
  finish()
  await f.step()
  assert.equal((await f.run()).status, 'stopped')
  assert.equal((await f.run()).meme?.imageCalls, 1)
  f.restart(); await f.step(3600_000)
  assert.equal(f.counts.publish, 0)
})
