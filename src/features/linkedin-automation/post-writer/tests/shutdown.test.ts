import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { createWorkTracker } from '../work-tracker.ts'
import { acquirePostWriterLease } from '../writer-lease.ts'

test('shutdown holds the writer lease until in-flight work finishes', async () => {
  const release = await acquirePostWriterLease('shutdown-test', 4436)
  const work = createWorkTracker()
  let resolve!: () => void
  const operation = work.run(() => new Promise<void>(done => { resolve = done }))
  await setImmediate()
  const closing = work.drain().then(release)
  try {
    await assert.rejects(acquirePostWriterLease('second-writer', 4436), /already_running/)
    await assert.rejects(work.run(async () => undefined), /closing/)
  } finally { resolve(); await operation; await closing }
  const next = await acquirePostWriterLease('next-writer', 4436)
  next()
})

test('service shutdown waits for publication and its persisted verification state', async () => {
  const f = fixture(), publish = f.deps.adapter.publish
  let resolve!: () => void
  f.deps.adapter.publish = async (...args) => {
    await new Promise<void>(done => { resolve = done })
    return publish(...args)
  }
  await f.service.start(203, 'automatic', 'close-in-post')
  await f.step()
  let closed = false
  const closing = f.service.close().then(() => { closed = true })
  await setImmediate()
  assert.equal(closed, false)
  await assert.rejects(f.service.start(204, 'automatic', 'closed-new-run'), /closing/)
  resolve()
  await closing
  assert.equal(f.counts.publish, 1)
  assert.equal((await f.run()).status, 'verifying')
  f.restart()
  await f.step(6000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1)
})

test('shutdown during identity prevents a new POST and permits later recovery', async () => {
  const f = fixture()
  let resolve!: () => void
  f.deps.adapter.identity = () => new Promise<void>(done => { resolve = done })
  await f.service.start(203, 'automatic', 'close-at-identity')
  await f.step()
  const closing = f.service.close()
  resolve()
  await closing
  assert.equal(f.counts.publish, 0)
})

test('read-only backend cannot change settings, create jobs or apply actions', async () => {
  const f = fixture()
  f.deps.writable = false
  f.restart()
  await assert.rejects(f.service.update(203, defaults(203)), /read_only/)
  await assert.rejects(f.service.start(203, 'automatic', 'read-only-run'), /read_only/)
  await assert.rejects(f.service.action('missing', 'stop'), /read_only/)
  assert.equal(f.counts.publish + f.counts.like, 0)
})
