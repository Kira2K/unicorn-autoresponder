import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retryLocalFile } from '../local-file-retry.ts'
test('brief Windows file lock retries only the local operation with a bounded delay', async () => {
  const waits: number[] = []
  let attempts = 0
  const result = await retryLocalFile(async () => {
    if (++attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' })
    return 'saved'
  }, async delay => { waits.push(delay) })
  assert.equal(result, 'saved')
  assert.deepEqual(waits, [25, 50])
  attempts = 0
  await assert.rejects(retryLocalFile(async () => {
    attempts++; throw Object.assign(new Error('bad disk'), { code: 'ENOSPC' })
  }, async () => {}), /bad disk/)
  assert.equal(attempts, 1)
})
