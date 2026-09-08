import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { createCvFiles } from '../cv-files.ts'
import { memoryJsonFiles } from '../memory-json-files.ts'
import { createTextWorkspace } from '../text-workspace.ts'
import { mockContext } from '../mock-content.ts'
import { createMockDependencies } from '../mock.ts'
import type { TextJob } from '../text-workspace-types.ts'
const author = { name: 'Test', role: 'Engineer', stack: ['Go'] }
const cv = { mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7 test').toString('base64') }
test('rules edited during model response cannot leave a ready unchecked text', async () => {
  const files = memoryJsonFiles()
  const model = createMockDependencies({ acquire: () => () => {} }).generator
  const draft = model.draft
  let workspace: ReturnType<typeof createTextWorkspace>
  model.draft = async (...args) => {
    await workspace.savePolicy(['error boundaries'])
    return draft(...args)
  }
  workspace = createTextWorkspace({ files, cv: createCvFiles(files, async () => mockContext), model,
    enabled: true, now: Date.now }, false)
  await workspace.saveAuthor('one', author, cv)
  await workspace.start('one', 'policy-race-key')
  await workspace.tick()
  for (let i = 0; i < 30; i++) await setImmediate()
  assert.equal((await workspace.snapshot()).jobs[0].status, 'queued')
  await workspace.tick()
  for (let i = 0; i < 30; i++) await setImmediate()
  assert.equal((await workspace.snapshot()).jobs[0].status, 'blocked')
  await workspace.close()
})
test('restart restores a saved draft without extracting CV or calling draft again', async () => {
  const files = memoryJsonFiles()
  const model = createMockDependencies({ acquire: () => () => {} }).generator
  let calls = 0
  const draft = model.draft
  model.draft = async (...args) => { calls++; return draft(...args) }
  const deps = { files, cv: createCvFiles(files, async () => mockContext), model, enabled: true, now: Date.now }
  const workspace = createTextWorkspace(deps, false)
  await workspace.saveAuthor('one', author, cv)
  const start = await workspace.start('one', 'recovery-key')
  await workspace.tick()
  for (let i = 0; i < 30; i++) await setImmediate()
  await workspace.close()
  const saved = (await files.get<TextJob>('text-jobs', start.id))!
  assert.equal(saved.status, 'ready')
  saved.status = 'generating'
  await files.put('text-jobs', start.id, saved)
  const restored = createTextWorkspace(deps, false)
  await restored.tick()
  for (let i = 0; i < 30; i++) await setImmediate()
  assert.equal((await restored.snapshot()).jobs[0].status, 'ready')
  assert.equal(calls, 1)
  await restored.close()
})
