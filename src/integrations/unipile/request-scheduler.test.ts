import assert from 'node:assert/strict'
import { createUnipileRequestScheduler } from './request-scheduler.ts'

async function run() {
  let now = 10_000; const waits: number[] = []; const starts: number[] = []
  const scheduler = createUnipileRequestScheduler({ minIntervalMs: 5_000, now: () => now,
    sleep: async milliseconds => { waits.push(milliseconds); now += milliseconds } })
  await Promise.all([
    scheduler.run(async () => { starts.push(now); return 1 }),
    scheduler.run(async () => { starts.push(now); return 2 }),
    scheduler.run(async () => { starts.push(now); return 3 })
  ])
  assert.deepEqual(starts, [10_000, 15_000, 20_000])
  assert.deepEqual(waits, [5_000, 5_000])

  // Choose each interval when its queued operation is dispatched, including after failure.
  now = 100_000
  const variableStarts: number[] = []; const variableWaits: number[] = []
  const intervals = [6_500, 6_500, 11_000, 8_750, 6_500]
  let choices = 0; let active = 0
  const variable = createUnipileRequestScheduler({ minIntervalMs: () => intervals[choices++],
    now: () => now, sleep: async milliseconds => { variableWaits.push(milliseconds); now += milliseconds } })
  const pending = intervals.map((_interval, index) => variable.run(async () => {
    assert.equal(active++, 0)
    variableStarts.push(now)
    await Promise.resolve()
    active--
    if (index === 2) throw new Error('read failed')
    if (index === 3) now += 20_000
  }))
  assert.equal(choices, 0, 'Enqueueing must not choose the interval.')
  const results = await Promise.allSettled(pending)
  assert.equal(choices, 5)
  assert.deepEqual(results.map(result => result.status),
    ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
  assert.deepEqual(variableStarts, [100_000, 106_500, 117_500, 126_250, 146_250])
  assert.deepEqual(variableWaits, [6_500, 11_000, 8_750])
}

run().then(() => console.log('unipile request scheduler tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
