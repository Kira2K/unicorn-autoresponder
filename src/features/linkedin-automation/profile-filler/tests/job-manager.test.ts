const assert = require('node:assert/strict')
const test = require('node:test')
const { AccountJobManager, JobCancelledError } = require('../job-manager.ts') as typeof import('../job-manager.ts')

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('jobs serialize per account while different accounts run independently', async () => {
  const manager = new AccountJobManager()
  const gate = deferred()
  const events: string[] = []
  const first = manager.enqueue({
    type: 'mutation', kind: 'first', accountId: 'a',
    run: async () => { events.push('a1-start'); await gate.promise; events.push('a1-end'); return 1 },
  })
  const second = manager.enqueue({
    type: 'read_only', kind: 'second', accountId: 'a',
    run: async () => { events.push('a2-start'); return 2 },
  })
  const other = manager.enqueue({
    type: 'mutation', kind: 'other', accountId: 'b',
    run: async () => { events.push('b-start'); return 3 },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(events.includes('a1-start'), true)
  assert.equal(events.includes('b-start'), true)
  assert.equal(events.includes('a2-start'), false)
  gate.resolve()
  assert.deepEqual(await Promise.all([first.result, second.result, other.result]), [1, 2, 3])
  assert.ok(events.indexOf('a2-start') > events.indexOf('a1-end'))
})

test('queued job can be cancelled before it starts', async () => {
  const manager = new AccountJobManager()
  const gate = deferred()
  const first = manager.enqueue({
    type: 'mutation', kind: 'first', accountId: 'a',
    run: async () => { await gate.promise; return 1 },
  })
  const second = manager.enqueue({
    type: 'mutation', kind: 'second', accountId: 'a',
    run: async () => 2,
  })
  assert.equal(manager.cancel(second.jobId), true)
  gate.resolve()
  await first.result
  await assert.rejects(second.result, JobCancelledError)
  assert.equal(manager.getJob(second.jobId)?.status, 'cancelled')
})
