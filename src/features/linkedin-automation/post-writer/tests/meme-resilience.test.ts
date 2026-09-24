import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMemeConcept } from '../meme-concept.ts'
import { writeMeme } from '../meme.ts'
import { createMockMemes } from '../meme-mock.ts'
import { createMemeServices } from '../meme-runtime.ts'
import { memoryJsonFiles } from '../memory-json-files.ts'
import { PostError } from '../errors.ts'
import type { MemeState } from '../meme-types.ts'

const input = { post: 'A careful code review takes time.', audience: 'Engineers', forbiddenTopics: [], history: [] }
const options = { id: 'resilience', onCheckpoint: async (_state: MemeState) => {} }

test('layout, exact style spelling, anchor and long alt text do not discard a usable concept', async () => {
  const services = createMockMemes(), raw = await services.plan(input) as any
  raw.concept.prompt = 'An expressive developer reading a very long code review.'
  raw.concept.postAnchor = 'A paraphrase of the source'
  raw.concept.altText = 'a'.repeat(400)
  const result = parseMemeConcept(raw, input)
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  assert.match(result.concept.prompt, /4:5.*1024x1280/s)
  assert.ok(result.concept.prompt.includes(result.concept.style))
  assert.ok(result.concept.altText.length <= 300)
})

test('malformed concept gets one repair; a bad repair still generates from the actual post', async () => {
  const services = createMockMemes(), render = services.render
  let plans = 0, images = 0
  services.plan = async value => { plans++; if (plans === 2) assert.ok(value.feedback); return { status: 'ready', concept: {} } }
  services.render = async prompt => { images++; assert.ok(prompt.includes(input.post)); return render(prompt) }
  const result = await writeMeme(input, services, options)
  assert.equal(result.status, 'ready'); assert.equal(plans, 2); assert.equal(images, 1)
  assert.ok(result.warnings?.includes('meme_direct_generation'))
})

test('weak relevance is repaired once, then a real generated image remains publishable', async () => {
  const services = createMockMemes(), render = services.render
  let reviews = 0, images = 0
  services.review = async () => { reviews++; return { issues: ['weak_relevance'], repair: 'Make the code review more visible.' } }
  services.render = async (...args) => { images++; return render(...args) }
  const result = await writeMeme(input, services, options)
  assert.equal(result.status, 'ready'); assert.ok(result.asset)
  assert.equal(images, 2); assert.equal(reviews, 2)
  assert.ok(result.qa?.issues.includes('weak_relevance'))
  await writeMeme(input, services, { ...options, checkpoint: result })
  assert.equal(images, 2); assert.equal(reviews, 2)
})

test('QA outage or failed improvement retains the already generated meme', async () => {
  for (const failure of ['review', 'repair']) {
    const services = createMockMemes(), render = services.render
    let images = 0
    services.review = async () => {
      if (failure === 'review') throw Error('QA unavailable')
      return { issues: ['weak_relevance'], repair: 'Improve relevance' }
    }
    services.render = async (...args) => { if (++images === 2) throw Error('render timeout'); return render(...args) }
    const result = await writeMeme(input, services, options)
    assert.equal(result.status, 'ready'); assert.ok(result.asset)
    assert.equal(images, failure === 'review' ? 1 : 2)
    assert.ok(result.warnings?.length)
  }
})

test('received broken JSON is repairable, but refusal and lost responses are not retried', async () => {
  for (const code of ['post_openai_invalid', 'post_openai_refusal', 'post_openai_error']) {
    const services = createMockMemes(); let calls = 0
    services.plan = createMemeServices(memoryJsonFiles(), async () => { calls++; throw new PostError(code) }, () => {}, {}).plan
    const result = await writeMeme(input, services, options)
    assert.equal(result.status, code === 'post_openai_invalid' ? 'ready' : 'uncertain')
    assert.equal(calls, code === 'post_openai_invalid' ? 2 : 1)
    assert.equal(result.imageCalls, code === 'post_openai_invalid' ? 1 : 0)
  }
})
