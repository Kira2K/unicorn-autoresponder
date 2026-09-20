import { test } from 'node:test'
import assert from 'node:assert/strict'
import { concurrencyFixture } from './concurrency-fixture.ts'

test('two students run independently; a same-account duplicate is blocked and Stop is scoped', async t => {
  const f = concurrencyFixture(); t.after(() => f.close())
  const first = await f.service.preview(203), second = await f.service.preview(103)
  await f.service.start(203, first.token); await f.entered(203)
  await assert.rejects(f.service.start(203, second.token))
  await f.service.start(103, second.token); await f.entered(103)
  assert.equal((await f.service.status(203))?.status, 'running')
  assert.equal((await f.service.status(103))?.status, 'running')
  await f.service.stop(203); f.release(203); f.release(103)
  for (let i = 0; i < 100 && f.service.busy(); i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.service.busy(), false)
  assert.deepEqual(f.calls.filter(row => row.accountId === 'acc_203').map(row => row.invitationId), ['old-1'])
  assert.deepEqual(f.calls.filter(row => row.accountId === 'acc_103').map(row => row.invitationId), ['old-1', 'old-2'])
  assert.equal((await f.service.status(203))?.status, 'stopped')
  assert.equal((await f.service.status(203))?.withdrawn, 1)
  assert.equal((await f.service.status(103))?.status, 'completed')
  assert.equal((await f.service.status(103))?.withdrawn, 2)
})
