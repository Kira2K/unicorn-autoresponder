import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCvFiles, parseCvUpload } from '../cv-files.ts'
import { memoryJsonFiles } from '../text-runtime.ts'
import { mockContext } from '../mock-content.ts'
import { createFactsExtractor } from '../extract-facts.ts'
import { fixture } from './helpers.ts'
const pdf = { mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7 test fixture').toString('base64') }
test('uploads validate bytes, size and format; cached CV extraction is coalesced', async () => {
  let extractions = 0
  const cv = createCvFiles(memoryJsonFiles(), async () => { extractions++; return mockContext })
  const reference = await cv.uploadCv(pdf)
  assert.equal(reference, await cv.uploadCv(pdf))
  const values = await Promise.all(Array.from({ length: 5 }, () => cv.uploadedContext(reference)))
  assert.equal(extractions, 1)
  assert.equal(values[0].facts.length, mockContext.facts.length)
  await cv.uploadedContext(reference)
  assert.equal(extractions, 1)
  for (const bad of [{ ...pdf, data: '' }, { ...pdf, data: '====' },
    { ...pdf, mimeType: 'text/plain' }, { ...pdf, data: Buffer.from('not PDF').toString('base64') }]) {
    assert.throws(() => parseCvUpload(bad))
  }
  await assert.rejects(cv.uploadedContext('../../file'))
})
test('DOCX is passed with correct MIME and extension, not disguised as PDF', async () => {
  const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('[Content_Types].xml word/document.xml')])
  const upload = parseCvUpload({ data: bytes.toString('base64'), mimeType })
  const extract = createFactsExtractor(async (input) => {
    const message = (input as { content: { filename: string; file_data: string }[] }[])[0].content[0]
    assert.equal(message.filename, 'cv.docx')
    assert.ok(message.file_data.startsWith(`data:${mimeType};base64,`))
    return { ...mockContext, facts: mockContext.facts }
  })
  await extract({ ...upload, bytes })
})
test('uploaded CV overrides only this run; source CV and account settings remain intact', async () => {
  const f = fixture()
  let nocoCvReads = 0
  const cv = createCvFiles(memoryJsonFiles(), async () => ({ ...mockContext, role: 'Uploaded author' }))
  Object.assign(f.deps.source, cv)
  f.deps.source.context = async () => { nocoCvReads++; return mockContext }
  await f.service.start(203, 'approval_required', 'uploaded-cv', { cv: pdf })
  await f.step()
  assert.equal(nocoCvReads, 0)
  assert.equal((await f.run()).context?.role, 'Uploaded author')
  assert.equal((await f.service.get(203)).settings.context, undefined)
  assert.equal(f.counts.publish, 0)
  await f.service.close()
})
