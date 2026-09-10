import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { applyAction } from '../run-actions.ts'
import { runContentHash } from '../run-content.ts'
test('manual approval requires viewing this text + meme version; image read has no writes', async () => {
  const f = fixture()
  await f.service.update(203, { ...defaults(203), memes: true })
  await f.service.start(203, 'approval_required', 'meme-manual-key')
  await f.step()
  const run = await f.run()
  assert.equal(run.status, 'awaiting_approval')
  assert.equal(run.meme?.status, 'ready')
  assert.deepEqual([run.meme.plannerCalls, run.meme.imageCalls, f.counts.publish], [1, 1, 0])
  const image = await f.service.image(run.id)
  assert.equal(image.asset.sha256, run.meme.asset?.sha256)
  await assert.rejects(f.service.action(run.id, 'approve', run.hash), /meme_review_required/)
  await assert.rejects(f.service.action(run.id, 'approve', run.hash, 'previous-version'), /meme_review_required/)
  f.restart()
  await f.service.action(run.id, 'approve', run.hash, run.hash)
  await f.step(); await f.step(6000)
  const published = await f.run()
  assert.equal(published.status, 'published')
  assert.equal(published.memeReviewedHash, run.hash)
  assert.ok(published.postImageId)
  assert.equal(f.counts.publish, 1)
  assert.ok((await f.deps.store.list('history', 203))[0].meme)
})
test('manual automatic and scheduled runs publish memes without human review', async () => {
  for (const scheduled of [false, true]) {
    const f = fixture()
    await f.service.update(203, { ...defaults(203), memes: true, scheduled, days: [1] })
    if (!scheduled) await f.service.start(203, 'automatic', 'meme-automatic-key')
    await f.step(); await f.step(6000)
    const run = await f.run()
    assert.equal(run.status, 'published')
    assert.equal(run.mode, 'automatic')
    assert.equal(run.memeReviewedHash, undefined)
    assert.equal(run.approvedHash, undefined)
    assert.equal(f.counts.publish, 1)
  }
})
test('changing text or image invalidates prior manual approval', async () => {
  const f = fixture()
  await f.service.update(203, { ...defaults(203), memes: true })
  await f.service.start(203, 'approval_required', 'meme-hash-key')
  await f.step()
  const run = await f.run(), changedText = structuredClone(run), changedImage = structuredClone(run)
  changedText.draft!.text += ' Changed.'
  changedImage.meme!.asset!.sha256 = 'a'.repeat(64)
  for (const changed of [changedText, changedImage]) {
    assert.notEqual(runContentHash(changed), run.hash)
    assert.throws(() => applyAction(changed, 'approve', run.hash, run.hash), /hash_mismatch/)
  }
  assert.equal(f.counts.publish, 0)
})
test('memes off cause zero meme requests; disabled adapter cannot be enabled by UI', async () => {
  const f = fixture()
  f.deps.memes!.plan = async () => { throw new Error('must not call') }
  await f.service.start(203, 'automatic', 'meme-off-key')
  await f.step(); await f.step(6000)
  assert.equal((await f.run()).status, 'published')
  assert.equal((await f.run()).meme, undefined)
  f.deps.memes!.enabled = false
  await assert.rejects(f.service.update(203, { ...defaults(203), memes: true }), /generation_disabled/)
})
