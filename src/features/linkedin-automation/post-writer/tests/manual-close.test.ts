import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'

test('Closing a restored uncertain run releases only local locks, never retries the publication', async () => {
  const f = fixture()
  const created = await f.service.start(203,'automatic','old-uncertain')
  await f.service.close()
  await f.deps.store.put('runs',created.id,{...created,status:'uncertain',attemptedAt:f.deps.now()})
  f.restart()
  await f.service.get(203)
  assert.equal(f.held.size,1)
  await f.service.close()
  assert.equal(f.held.size,0)
  assert.equal(f.counts.publish,0)
  assert.equal((await f.deps.store.get('runs',created.id))?.status,'uncertain')
  f.restart()
  await f.step()
  assert.equal(f.counts.publish,0)
  assert.equal((await f.run()).status,'uncertain')
  await f.service.close()
})
