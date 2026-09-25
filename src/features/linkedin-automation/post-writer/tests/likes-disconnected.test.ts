import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { PostError } from '../errors.ts'
import { defaults } from '../types.ts'

for (const unavailable of [[901], [903], [906], [901, 902, 903, 904, 905, 906]]) {
  test(`unready accounts ${unavailable.join(',')} are skipped, not sent or replaced`, async () => {
    const f = fixture()
    try {
      await f.service.start(203, 'automatic', 'skip-disconnected'); await f.untilPublished()
      const before = await f.run(), reacted = f.deps.adapter.reacted
      f.deps.adapter.identity = async account => {
        if (unavailable.includes(account.platformAccountId)) throw new PostError('post_account_not_ready')
      }
      f.deps.adapter.reacted = async (account, id) => {
        assert.ok(!unavailable.includes(account.platformAccountId)); return reacted(account, id)
      }
      await f.service.action(before.id, 'start-likes')
      for (let i = 0; i < 24; i++) await f.step(90_001)
      const after = await f.run()
      assert.equal(after.status, 'published'); assert.equal(after.postId, before.postId)
      assert.equal(after.engagement.status, 'partial'); assert.equal(after.engagement.target, 6)
      assert.equal(after.engagement.items.length, 6); assert.equal(after.nextActionAt, undefined)
      assert.equal(after.errorCode, undefined); assert.equal(f.counts.publish, 1)
      assert.equal(f.counts.like, 6 - unavailable.length); assert.equal(f.held.size, 0)
      for (const item of after.engagement.items) {
        const skipped = unavailable.includes(item.account.platformAccountId)
        assert.equal(item.status, skipped ? 'failed' : 'sent')
        if (skipped) {
          assert.equal(item.errorCode, 'post_account_not_ready')
          assert.equal(item.attemptedAt, undefined); assert.equal(item.confirmedAt, undefined)
        }
      }
      f.restart(); await f.step(90_001)
      assert.deepEqual((await f.run()).engagement, after.engagement)
      assert.equal(f.counts.like, 6 - unavailable.length)
    } finally { await f.service.close() }
  })
}

test('skip persists across restart; previous reactions stay sent and next account waits', async () => {
  const f = fixture(), checks: number[] = []
  try {
    await f.service.start(203, 'automatic', 'skip-restart'); await f.untilPublished()
    f.deps.adapter.identity = async account => {
      checks.push(account.platformAccountId)
      if (account.platformAccountId === 902) throw new PostError('post_account_not_ready')
    }
    await f.service.action((await f.run()).id, 'start-likes')
    await f.step(); await f.step(5000); await f.step(5000); await f.step(5000)
    assert.equal((await f.run()).engagement.items[1].status, 'failed')
    assert.equal(f.counts.like, 1); assert.equal(f.held.size, 0)
    f.restart(); await f.step(4999)
    assert.equal(f.counts.like, 1)
    await f.step(1); assert.equal(f.counts.like, 2)
    for (let i = 0; i < 20; i++) await f.step(90_001)
    assert.equal(f.counts.like, 5); assert.equal(checks.filter(id => id === 902).length, 1)
    assert.equal((await f.run()).engagement.items[0].status, 'sent')
  } finally { await f.service.close() }
})

test('automatic likes also continue past an unready account', async () => {
  const f = fixture()
  try {
    await f.service.update(203, { ...defaults(203), likes: true })
    f.deps.adapter.identity = async account => {
      if (account.platformAccountId === 901) throw new PostError('post_account_not_ready')
    }
    await f.service.start(203, 'automatic', 'automatic-skip')
    for (let i = 0; i < 24; i++) await f.step(90_001)
    assert.equal(f.counts.like, 5); assert.equal((await f.run()).engagement.status, 'partial')
    assert.equal((await f.run()).engagement.requestedManually, undefined)
  } finally { await f.service.close() }
})
