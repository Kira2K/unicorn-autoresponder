import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJsonFiles } from '../json-files.ts'
import { memoryJsonFiles } from '../text-runtime.ts'
import { createCvFiles } from '../cv-files.ts'
import { createTextWorkspace } from '../text-workspace.ts'
import { createMockDependencies } from '../mock.ts'
import { mockContext } from '../mock-content.ts'
import { PostError } from '../errors.ts'
const author = { name: 'Test author', role: 'Engineer', stack: ['Go'] }
const upload = { mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7 mocked CV').toString('base64') }
for (const mode of ['memory', 'file'] as const) {
  test(`${mode}: independent CV -> text, double click, restart, same author history`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'post-text-test-'))
    const files = mode === 'file' ? createJsonFiles(directory) : memoryJsonFiles()
    const model = createMockDependencies({ acquire: () => () => {} }).generator
    let extracts = 0
    const deps = { files, cv: createCvFiles(files, async () => { extracts++; return mockContext }),
      model, enabled: true, now: Date.now }
    const workspace = createTextWorkspace(deps, false)
    await workspace.saveAuthor('author-one', author, upload)
    const jobs = await Promise.all(Array.from({ length: 5 }, () => workspace.start('author-one', 'double-click-key')))
    assert.equal(new Set(jobs.map(x => x.id)).size, 1)
    await workspace.tick()
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && (await workspace.snapshot()).jobs[0].status !== 'ready') {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal((await workspace.snapshot()).jobs[0].status, 'ready', 'wait for durable file completion before shutdown')
    await workspace.close()
    const saved = (await workspace.snapshot()).jobs[0]
    assert.equal(saved.status, 'ready')
    assert.equal(extracts, 1)
    const restoredFiles = mode === 'file' ? createJsonFiles(directory) : files
    const restored = createTextWorkspace({ ...deps, files: restoredFiles }, false)
    await restored.saveAuthor('author-one', { ...author, level: 'Senior' }, upload)
    assert.equal((await restored.snapshot()).jobs.length, 1)
    const second = await restored.start('author-one', 'next-generation-key')
    assert.notEqual(second.id, saved.id)
    await restored.tick()
    await restored.close()
    assert.equal(extracts, 1)
    assert.equal((await restored.snapshot()).authors.length, 1)
  })
}
test('provider retry is persisted; Stop during cooldown survives restart', async () => {
  let now = 1000
  const files = memoryJsonFiles()
  const model = createMockDependencies({ acquire: () => () => {} }).generator
  model.topics = async () => { throw new PostError('post_openai_error', 180_000, 429) }
  const deps = { files, cv: createCvFiles(files, async () => mockContext), model, enabled: true, now: () => now }
  const workspace = createTextWorkspace(deps, false)
  await workspace.saveAuthor('author-one', author, upload)
  const job = await workspace.start('author-one', 'retry-test-key')
  await workspace.tick()
  for (let i = 0; i < 50 && (await workspace.snapshot()).jobs[0].status !== 'retrying'; i++) await setImmediate()
  assert.equal((await workspace.snapshot()).jobs[0].nextActionAt, 181_000)
  await workspace.stop(job.id)
  await workspace.close()
  now = 200_000
  const resumed = createTextWorkspace(deps, false)
  await resumed.tick()
  assert.equal((await resumed.snapshot()).jobs[0].status, 'cancelled')
  await resumed.close()
})
