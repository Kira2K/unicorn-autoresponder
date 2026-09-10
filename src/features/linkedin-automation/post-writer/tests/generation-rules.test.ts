import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postLength, lengthFeedback } from '../post-length.ts'
import { FACT_INSTRUCTIONS, FACTS_VERSION } from '../fact-instructions.ts'
import { createPostOpenAi } from '../openai-client.ts'
import { createCvFiles } from '../cv-files.ts'
import { memoryJsonFiles } from '../text-runtime.ts'
import { mockContext, mockDraft } from '../mock-content.ts'

test('length feedback counts Unicode, spaces, paragraphs and hashtags exactly', () => {
  assert.equal(postLength(' A\n\n𝌆 #Go '), 8)
  assert.deepEqual(lengthFeedback('x'.repeat(1117)), {
    min: 900, max: 1100, target: 1000, current: 1117,
    removeAtLeast: 17, addAtLeast: 0, changeToTarget: -117
  })
  assert.equal(lengthFeedback('x'.repeat(899)).addAtLeast, 1)
  assert.equal(lengthFeedback('x'.repeat(1000)).changeToTarget, 0)
  assert.deepEqual(lengthFeedback(), { min: 900, max: 1100, target: 1000 })
})
test('draft receives exact correction budget without another model call', async () => {
  let calls = 0
  const model = createPostOpenAi(() => {}, {
    OPENAI_LINKEDIN_POST_API_KEY: 'mock', OPENAI_LINKEDIN_POST_MODEL: 'mock'
  }, async (_url, init) => {
    calls++
    const request = JSON.parse(String(init?.body))
    const input = JSON.parse(request.input[0].content[0].text)
    assert.equal(input.length.current, 1117)
    assert.equal(input.length.changeToTarget, -117)
    assert.deepEqual(input.issues, ['length_900_1100'])
    assert.match(request.instructions, /not undocumented events/)
    return new Response(JSON.stringify({ status: 'completed', output: [
      { content: [{ type: 'output_text', text: JSON.stringify(mockDraft) }] }] }))
  })
  await model.draft(mockContext, { title: 'Test', signature: 'test', score: 1, factIds: ['fact_1'] },
    { ...mockDraft, text: 'x'.repeat(1117) }, ['length_900_1100'])
  assert.equal(calls, 1)
})
test('fact instructions keep actions, metrics, provenance and separate employers', () => {
  assert.match(FACT_INSTRUCTIONS, /every distinct professional experience bullet/)
  assert.match(FACT_INSTRUCTIONS, /before\/after values/)
  assert.match(FACT_INSTRUCTIONS, /BOTH\ntext and source evidence/)
  assert.match(FACT_INSTRUCTIONS, /Keep separate employers/)
  assert.match(FACT_INSTRUCTIONS, /never supply an absent month/)
})
test('old CV facts refresh once; current cached facts and previous context need no calls', async () => {
  const files = memoryJsonFiles()
  let calls = 0
  const cv = createCvFiles(files, async () => { calls++; return mockContext })
  const ref = await cv.uploadCv({ mimeType: 'application/pdf',
    data: Buffer.from('%PDF-1.7 cache fixture').toString('base64') })
  const old = { ...mockContext, revision: ref }
  await files.put('facts', ref, old)
  const contexts = await Promise.all([cv.uploadedContext(ref, old), cv.uploadedContext(ref)])
  assert.equal(calls, 1)
  assert.equal(contexts[0].factsVersion, FACTS_VERSION)
  assert.equal(old.factsVersion, undefined)
  assert.deepEqual(await cv.uploadedContext(ref, contexts[0]), contexts[0])
  await cv.uploadedContext(ref)
  assert.equal(calls, 1)
})
