import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { createTextWorkspace } from '../text-workspace.ts'
import { createCvFiles } from '../cv-files.ts'
import { memoryJsonFiles } from '../memory-json-files.ts'
import { createMockDependencies } from '../mock.ts'
import { mockContext } from '../mock-content.ts'
test('failed checkpoint blocks model calls until persistence recovers, preserving the selected topic', async () => {
  const files = memoryJsonFiles()
  const model = createMockDependencies({ acquire: () => () => {} }).generator
  const originalPut = files.put, topics = model.topics, draft = model.draft
  let offline = false, now = 1000, topicCalls = 0, draftCalls = 0
  files.put = async (...args) => { if (offline) throw new Error('storage offline'); return originalPut(...args) }
  model.topics = async (...args) => { topicCalls++; offline = true; return topics(...args) }
  model.draft = async (...args) => { draftCalls++; return draft(...args) }
  const workspace = createTextWorkspace({ files, model, cv: createCvFiles(files, async () => mockContext),
    enabled: true, now: () => now }, false)
  await workspace.saveAuthor('one', { name: 'Mock', role: 'Engineer' }, { mimeType: 'application/pdf',
    data: Buffer.from('%PDF-1.7 test').toString('base64') })
  await workspace.start('one', 'storage-safety-key')
  await workspace.tick()
  for (let i = 0; i < 30; i++) await setImmediate()
  await workspace.tick()
  assert.equal(topicCalls, 1)
  assert.equal(draftCalls, 0)
  offline = false
  now = 32_000
  await workspace.tick()
  for (let i = 0; i < 30; i++) await setImmediate()
  assert.equal((await workspace.snapshot()).jobs[0].status, 'ready')
  assert.equal(topicCalls, 1)
  assert.equal(draftCalls, 1)
  await workspace.close()
})
