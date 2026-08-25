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
}

run().then(() => console.log('unipile request scheduler tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
