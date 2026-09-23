import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLivePostWriter } from '../runtime.ts'
import { createMemoryPostStore } from '../memory-store.ts'

test('normal runtime exposes prepared start and enforces read-only without external calls', async () => {
  const service = createLivePostWriter({ async listAccounts() { throw Error('no account lookup expected') } },
    { acquire() { throw Error('no external operation expected') } },
    { env: { LINKEDIN_POST_WRITER_ENABLED: 'false' }, storage: {
      store: createMemoryPostStore(), async cvRows() { throw Error('no CV lookup expected') }
    } })
  try {
    await assert.rejects(service.startPrepared(203, { date: '2026-09-23', text: 'Prepared text' }),
      /post_writer_read_only/)
  } finally { await service.close() }
})
