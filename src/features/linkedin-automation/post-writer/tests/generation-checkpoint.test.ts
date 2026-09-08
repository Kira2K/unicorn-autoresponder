import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { mockDraft } from '../mock-content.ts'
import { createServiceState } from '../service-state.ts'
import { generate } from '../generation.ts'

for (const failedRepair of [1, 2]) for (const committed of [false, true]) {
  test(`Noco recovery keeps repair ${failedRepair}; write committed before error=${committed}`, async () => {
    const f = fixture()
    const { put } = f.deps.store
    let calls = 0
    let failures = 0
    f.deps.generator.draft = async () => {
      calls++
      return calls < 3 ? { ...mockDraft, text: 'short' } : structuredClone(mockDraft)
    }
    f.deps.store.put = async (table, key, value) => {
      if (table === 'runs' && 'repairCount' in value && value.repairCount === failedRepair) {
        failures++
        if (committed) await put(table, key, value)
        throw new Error('storage response lost')
      }
      return put(table, key, value)
    }
    await f.service.start(203, 'approval_required', 'repair-checkpoint')
    await f.step()
    assert.equal(calls, failedRepair)
    assert.equal((await f.run()).repairCount, failedRepair - 1)
    assert.equal(failures, 1, 'rollback uses dirty queue, not another HTTP attempt during cooldown')
    await f.step(29_000)
    assert.equal(calls, failedRepair)
    f.deps.store.put = put
    await f.step(2000)
    assert.equal((await f.run()).status, 'awaiting_approval')
    assert.equal((await f.run()).repairCount, 2)
    assert.equal(calls, 3)
    assert.equal(f.counts.publish, 0)
    f.restart()
    await f.step()
    assert.equal((await f.run()).status, 'awaiting_approval')
    assert.equal(calls, 3)
  })
}

test('flushed unstarted repair survives restart before generation resumes', async () => {
  const f = fixture()
  const run = await f.service.start(203, 'approval_required', 'restart-before-repair')
  const state = createServiceState(f.deps)
  await state.hydrate()
  const put = f.deps.store.put
  let calls = 0
  f.deps.generator.draft = async () => {
    calls++
    return calls < 3 ? { ...mockDraft, text: 'short' } : structuredClone(mockDraft)
  }
  f.deps.store.put = async (table, key, value) => {
    if (table === 'runs' && 'repairCount' in value && value.repairCount === 1) {
      await put(table, key, value)
      throw new Error('storage acknowledgement lost')
    }
    return put(table, key, value)
  }
  await assert.rejects(generate(state.runs.get(run.id)!, state.e), /post_persistence_unavailable/)
  assert.equal(calls, 1)
  f.deps.store.put = put
  f.setNow(run.createdAt + 31_000)
  await state.flush()
  assert.equal((await f.deps.store.get('runs', run.id))?.repairCount, 0)
  const restored = createServiceState(f.deps)
  await restored.hydrate()
  await generate(restored.runs.get(run.id)!, restored.e)
  assert.equal(restored.snapshot(203).runs[0].status, 'awaiting_approval')
  assert.equal(calls, 3)
  assert.equal(f.counts.publish, 0)
})

test('Stop while a repair rollback is queued prevents model calls after recovery', async () => {
  const f = fixture()
  const put = f.deps.store.put
  let calls = 0
  f.deps.generator.draft = async () => { calls++; return { ...mockDraft, text: 'short' } }
  f.deps.store.put = async (table, key, value) => {
    if (table === 'runs' && 'repairCount' in value && value.repairCount === 1) throw new Error('Noco down')
    return put(table, key, value)
  }
  const run = await f.service.start(203, 'automatic', 'stop-queued-rollback')
  await f.step()
  await f.service.action(run.id, 'stop')
  f.deps.store.put = put
  await f.step(31_000)
  assert.equal((await f.run()).status, 'stopped')
  assert.equal((await f.run()).repairCount, 0)
  assert.equal(calls, 1)
  assert.equal(f.counts.publish, 0)
})
