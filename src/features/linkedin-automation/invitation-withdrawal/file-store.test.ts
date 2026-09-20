import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWithdrawalFileStore } from './file-store.ts'
test('durable journal keeps attempted IDs, survives reopen and rejects corrupt data/path traversal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'withdrawal-test-'))
  try {
    const store = createWithdrawalFileStore(directory)
    assert.equal(await store.load(1), undefined)
    const state = { accountId: 'acc_test', attempted: ['manual-invitation'] }
    await store.save(1, state)
    assert.deepEqual(await createWithdrawalFileStore(directory).load(1), state)
    await assert.rejects(store.load(NaN)); await assert.rejects(store.save(-1, state))
    await writeFile(join(directory, '1.json'), '{bad json')
    await assert.rejects(store.load(1))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
