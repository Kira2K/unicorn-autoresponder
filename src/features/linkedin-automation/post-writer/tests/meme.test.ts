import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeMeme } from '../meme.ts'
import { createMockMemes, mockMemePng } from '../meme-mock.ts'
import { inspectMemeImage } from '../meme-image.ts'
import type { MemeState } from '../meme-types.ts'
const input = { post: 'A verified professional fact.', audience: 'Peers', forbiddenTopics: [], history: [] }
function setup() {
  const services = createMockMemes(), counts = { plan: 0, image: 0 }
  const plan = services.plan, render = services.render
  services.plan = async value => { counts.plan++; return plan(value) }
  services.render = async (prompt, signal) => { counts.image++; return render(prompt, signal) }
  let saved: MemeState | undefined
  const options = { id: 'job-1', onCheckpoint: async (value: MemeState) => { saved = structuredClone(value) } }
  return { services, counts, options, saved: () => saved }
}
test('one plan and image, input unchanged; ready restart makes no model calls', async () => {
  const f = setup(), before = structuredClone(input)
  const result = await writeMeme(input, f.services, f.options)
  assert.equal(result.status, 'ready'); assert.deepEqual(f.counts, { plan: 1, image: 1 })
  const resumed = await writeMeme(input, f.services, { ...f.options, checkpoint: f.saved() })
  assert.equal(resumed.asset?.sha256, result.asset?.sha256)
  assert.deepEqual(f.counts, { plan: 1, image: 1 }); assert.deepEqual(input, before)
})
test('lost image response, restart and 429 never retry a charged request', async () => {
  for (const code of ['timeout', '429']) {
    const f = setup()
    f.services.render = async () => { f.counts.image++; throw Object.assign(new Error(code), { code }) }
    const result = await writeMeme(input, f.services, f.options)
    assert.equal(result.status, 'uncertain')
    await writeMeme(input, f.services, { ...f.options, checkpoint: f.saved() })
    assert.deepEqual(f.counts, { plan: 1, image: 1 })
  }
})
test('intent save failure stops before paid requests; Stop between phases prevents image', async () => {
  const f = setup()
  await assert.rejects(writeMeme(input, f.services, { ...f.options, onCheckpoint: async () => { throw new Error('storage') } }))
  assert.deepEqual(f.counts, { plan: 0, image: 0 })
  const controller = new AbortController(), plan = f.services.plan
  f.services.plan = async value => { const result = await plan(value); controller.abort(); return result }
  const result = await writeMeme(input, f.services, { ...f.options, signal: controller.signal })
  assert.equal(result.status, 'cancelled'); assert.equal(f.counts.image, 0)
})
test('invalid concept blocks image; wrong dimensions block without correction', async () => {
  const f = setup()
  f.services.plan = async () => ({ status: 'ready', reason: '', concept: {} })
  assert.equal((await writeMeme(input, f.services, f.options)).status, 'blocked')
  assert.equal(f.counts.image, 0)
  const png = mockMemePng(); png.writeUInt32BE(1003, 16)
  assert.throws(() => inspectMemeImage(png), /dimensions_invalid/)
})
test('render result persisted before final checkpoint survives restart without another image', async () => {
  const f = setup()
  const originalSave = f.options.onCheckpoint
  f.options.onCheckpoint = async value => { if (value.status === 'ready') throw new Error('storage'); await originalSave(value) }
  await assert.rejects(writeMeme(input, f.services, f.options))
  assert.equal(f.saved()?.status, 'rendering')
  const result = await writeMeme(input, f.services, { id: 'job-1', checkpoint: f.saved(), onCheckpoint: originalSave })
  assert.equal(result.status, 'ready'); assert.deepEqual(f.counts, { plan: 1, image: 1 })
})
