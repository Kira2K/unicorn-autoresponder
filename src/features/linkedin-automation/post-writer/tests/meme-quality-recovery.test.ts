import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockMemes } from '../meme-mock.ts'
import { writeMeme } from '../meme.ts'
import { createMemeReviewer } from '../meme-review.ts'
import { digest } from '../content-identity.ts'
import type { MemeState } from '../meme-types.ts'
const input = { post: 'Careful code reviews take time.', audience: 'Peers', forbiddenTopics: [], history: [] }

test('vision QA receives the real PNG and post; output is validated', async () => {
  const services = createMockMemes()
  const state = await writeMeme(input, services, { id: 'qa-contract', onCheckpoint: async () => {} })
  const file = (await services.assets.get(state.asset!.id))!
  let calls = 0
  const review = createMemeReviewer(async (value, _schema, instructions) => {
    calls++
    const messages = value as any
    assert.equal(JSON.parse(messages[0].content[0].text).post, input.post)
    assert.equal(messages[0].content[1].image_url, `data:image/png;base64,${file.content}`)
    assert.match(instructions, /not publication vetoes/)
    return calls === 1 ? { issues: ['weak_relevance'], repair: 'Show a code review' } : { issues: ['invented'], repair: '' }
  })
  assert.deepEqual((await review(input, file, state.concept!)).issues, ['weak_relevance'])
  await assert.rejects(review(input, file, state.concept!), /meme_qa_invalid/)
})

test('restart during QA or image improvement never repeats a paid call', async () => {
  for (const crashAt of ['reviewing', 'repairing', 'reviewing_repair'] as const) {
    const services = createMockMemes(), render = services.render
    let saved: MemeState | undefined, images = 0, reviews = 0
    services.review = async () => { reviews++; return { issues: ['weak_relevance'], repair: 'Improve it' } }
    services.render = async (...args) => { images++; return render(...args) }
    await assert.rejects(writeMeme(input, services, { id: 'restart-qa', onCheckpoint: async state => {
      saved = structuredClone(state)
      if (state.qaStage === crashAt) throw Error('crash after checkpoint')
    } }))
    const before = { images, reviews }
    const result = await writeMeme(input, services, { id: 'restart-qa', checkpoint: saved, onCheckpoint: async () => {} })
    assert.equal(result.status, 'ready'); assert.ok(result.asset)
    assert.deepEqual({ images, reviews }, before)
  }
})

test('failure saving a concept checkpoint is not swallowed as a generation defect', async () => {
  const services = createMockMemes()
  let images = 0
  services.plan = async () => ({ status: 'blocked', reason: 'forbidden topic', concept: null })
  services.render = async () => { images++; throw Error('must not render') }
  await assert.rejects(writeMeme(input, services, { id: 'save-failure', onCheckpoint: async state => {
    if (state.status === 'blocked') throw Error('SQL unavailable')
  } }), /SQL unavailable/)
  assert.equal(images, 0)
})

test('known forbidden image is not treated as a weak joke; improved allowed version is selected', async () => {
  for (const improves of [false, true]) {
    const services = createMockMemes(); let reviews = 0
    services.review = async () => ({ issues: ++reviews === 2 && improves ? [] : ['forbidden_content'], repair: 'Remove forbidden content' })
    const result = await writeMeme(input, services, { id: 'qa-policy', onCheckpoint: async () => {} })
    assert.equal(result.status, improves ? 'ready' : 'blocked')
    assert.equal(result.imageCalls, 2)
    if (improves) assert.equal(result.asset!.id, result.repairAsset!.id)
  }
})

test('recovered improvement for another source is ignored without another generation', async () => {
  const services = createMockMemes()
  const saved = await writeMeme(input, services, { id: 'wrong-source', onCheckpoint: async () => {} })
  const original = (await services.assets.get(saved.asset!.id))!
  await services.assets.put(digest(`${saved.assetId}:qa-repair`), 'different-source',
    Buffer.from(original.content, 'base64'), saved.concept!.altText)
  saved.status = 'reviewing'; saved.qaStage = 'repairing'; saved.imageCalls = 2
  saved.qa = { issues: ['weak_relevance'], repair: 'Improve it' }
  services.render = async () => { throw Error('must not render') }
  services.review = async () => { throw Error('must not review the wrong source') }
  const result = await writeMeme(input, services, { id: 'wrong-source', checkpoint: saved, onCheckpoint: async () => {} })
  assert.equal(result.status, 'ready'); assert.equal(result.asset!.id, original.asset.id)
  assert.ok(result.warnings!.includes('meme_quality_repair_failed'))
})
