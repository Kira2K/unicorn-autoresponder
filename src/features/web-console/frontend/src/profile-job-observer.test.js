import assert from 'node:assert/strict'
import { createProfileJobObserver } from './profile-job-observer.js'

export async function testProfileObserver() {
  const timers = new Map()
  const seen = []
  let sequence = 0
  let reads = 0
  let errors = 0
  let resolveOld
  const observer = createProfileJobObserver({
    read: async id => {
      reads += 1
      if (id === 'old') return new Promise(resolve => { resolveOld = resolve })
      if (reads === 1) throw new Error('temporary network failure')
      return { jobId: id, status: reads >= 3 ? 'succeeded' : 'verifying' }
    },
    onValue: value => seen.push(value), onError: () => { errors += 1 },
    isTerminal: value => value.status === 'succeeded',
    schedule: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id },
    cancel: id => timers.delete(id)
  })
  const settle = () => new Promise(resolve => setImmediate(resolve))
  observer.start('current')
  await settle()
  assert.equal(errors, 1)
  assert.equal(timers.size, 1)
  assert.equal([...timers.values()][0].delay, 5000)
  let pending = [...timers.entries()][0]
  timers.delete(pending[0]); await pending[1].callback()
  assert.equal(seen.at(-1).status, 'verifying')
  assert.equal(timers.size, 1)
  observer.start('current')
  await settle()
  assert.equal(seen.at(-1).status, 'succeeded')
  assert.equal(timers.size, 0)
  observer.start('old'); await settle()
  observer.start('new'); await settle()
  resolveOld({ jobId: 'old', status: 'verifying' }); await settle()
  assert.equal(seen.at(-1).jobId, 'new')
  assert.equal(timers.size, 0)
  observer.stop()
}
