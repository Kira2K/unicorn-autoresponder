import test from 'node:test'
import assert from 'node:assert/strict'
import { planSlotTasks, minimumTaskPauseMs, taskTimeLimitMs } from './slot-plan.ts'

test('a slot reserves all task durations and distributes spare time into random gaps', () => {
  const tasks = [{ key: 'a', reserveMs: 100 }, { key: 'b', reserveMs: 200 }, { key: 'c', reserveMs: 300 }]
  const values = [.1, .8, .3, .6]
  const plan = planSlotTasks(0, 60_000, 0, tasks, () => values.shift()!)
  assert.equal(plan.size, 3)
  let end = 0
  for (const [index, task] of tasks.entries()) {
    const value = plan.get(task.key)!
    assert.equal(value.plannedAt, end + value.pauseBeforeMs)
    if (index) assert.ok(value.pauseBeforeMs >= minimumTaskPauseMs)
    assert.ok(value.plannedAt + task.reserveMs <= 60_000)
    end = value.plannedAt + task.reserveMs
  }
  assert.notEqual(plan.get('b')!.pauseBeforeMs, plan.get('c')!.pauseBeforeMs)
  assert.ok(end < 60_000)
})

test('task deadline adapts to work size, with at least thirty minutes of headroom',()=>{
  assert.equal(taskTimeLimitMs(10*60_000),40*60_000)
  assert.equal(taskTimeLimitMs(4*3600_000),8*3600_000)
})

test('a late tick uses the remaining slot and never squeezes a task past its end', () => {
  const plan = planSlotTasks(0, 30_000, 20_000,
    [{ key: 'large', reserveMs: 20_000 }, { key: 'fits', reserveMs: 10_000 }, { key: 'extra', reserveMs: 1 }], () => .5)
  assert.equal(plan.has('large'), false)
  assert.equal(plan.has('extra'), false)
  assert.equal(plan.get('fits')!.plannedAt, 20_000)
})

test('even the smallest/largest random values keep multiple tasks separate and inside the slot', () => {
  for (const random of [0, .01, .5, .99, 1]) {
    const plan = planSlotTasks(10, 100_000, 10,
      [{ key: 'one', reserveMs: 10_000 }, { key: 'two', reserveMs: 10_000 }], () => random)
    const one = plan.get('one')!, two = plan.get('two')!
    assert.ok(one.plannedAt >= 10)
    assert.ok(two.plannedAt >= one.plannedAt + 10_000 + minimumTaskPauseMs)
    assert.ok(two.plannedAt + 10_000 <= 100_000)
  }
})
