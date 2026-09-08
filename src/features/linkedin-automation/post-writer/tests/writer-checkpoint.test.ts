import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writePost } from '../writer.ts'
import { writerFixture } from './writer-fixture.ts'
import { mockDraft } from '../mock-content.ts'
import type { WriterCheckpoint } from '../writer-types.ts'

for (const failedRepair of [1, 2]) for (const rollbackFails of [false, true]) {
  test(`repair ${failedRepair}: failed checkpoint preserves the slot; rollback error=${rollbackFails}`, async () => {
    const f = writerFixture()
    let checkpoint: WriterCheckpoint | undefined
    let failed = false
    const failure = new Error('storage unavailable')
    f.model.draft = async () => {
      f.calls.draft++
      return f.calls.draft < 3 ? { ...mockDraft, text: 'short' } : structuredClone(mockDraft)
    }
    await assert.rejects(writePost(f.input, f.model, { onCheckpoint: async value => {
      checkpoint = structuredClone(value)
      if (failed && rollbackFails) throw new Error('rollback queued, storage still unavailable')
      if (value.repairCount === failedRepair) {
        failed = true
        throw failure
      }
    } }), error => error === failure)
    assert.equal(f.calls.draft, failedRepair, 'no request after failed persistence')
    assert.equal(checkpoint?.repairCount, failedRepair - 1)
    const before = structuredClone(checkpoint)
    const result = await writePost(f.input, f.model, { checkpoint })
    assert.equal(result.status, 'ready')
    assert.equal(result.checkpoint.repairCount, 2)
    assert.deepEqual(f.calls, { topics: 1, draft: 3 })
    assert.deepEqual(checkpoint, before)
  })
}

test('two lost repair responses exhaust the budget across restarts', async () => {
  const f = writerFixture()
  let checkpoint: WriterCheckpoint | undefined
  f.model.draft = async () => {
    f.calls.draft++
    if (f.calls.draft > 1) throw new Error('model response lost')
    return { ...mockDraft, text: 'short' }
  }
  const onCheckpoint = async (value: WriterCheckpoint) => { checkpoint = structuredClone(value) }
  for (const attempt of [1, 2]) {
    await assert.rejects(writePost(f.input, f.model, { checkpoint, onCheckpoint }), /model response lost/)
    assert.equal(checkpoint?.repairCount, attempt)
  }
  assert.equal((await writePost(f.input, f.model, { checkpoint })).status, 'blocked')
  assert.deepEqual(f.calls, { topics: 1, draft: 3 })
})

test('crash before rollback persists conservatively keeps the uncertain durable reservation', async () => {
  const f = writerFixture()
  let durable: WriterCheckpoint | undefined
  let storageDown = false
  f.model.draft = async () => { f.calls.draft++; return { ...mockDraft, text: 'short' } }
  await assert.rejects(writePost(f.input, f.model, { onCheckpoint: async value => {
    if (storageDown) throw new Error('rollback not persisted')
    durable = structuredClone(value)
    if (value.repairCount === 1) {
      storageDown = true
      throw new Error('reservation committed, acknowledgement lost')
    }
  } }), /acknowledgement lost/)
  assert.equal(f.calls.draft, 1)
  const resumed = await writePost(f.input, f.model, { checkpoint: durable })
  assert.equal(resumed.status, 'blocked')
  assert.equal(resumed.checkpoint.repairCount, 2)
  assert.equal(f.calls.draft, 2, 'unknown reservation cannot be refunded after losing local state')
})
