import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'

async function legacyRun() {
  const f = fixture(), plan = f.deps.memes!.plan
  const post = { date: '2026-09-07', text: 'The original prepared post must remain exactly unchanged.' }
  f.deps.memes!.plan = async () => ({ status: 'blocked', reason: 'seed legacy state', concept: null })
  await f.service.update(203, { ...defaults(203), contentMode: 'prepared', scheduled: true, preparedPosts: [post] })
  await f.step()
  const run = await f.run()
  run.errorCode = run.meme!.errorCode = 'meme_prompt_invalid'
  run.meme!.plannerCalls = 1
  run.meme!.blockingReason = undefined
  await f.deps.store.put('runs', run.id, run)
  f.deps.memes!.plan = plan
  f.restart()
  return { f, run, post }
}

test('old blocked job resumes with the same ID and text, one new plan and one image', async () => {
  const { f, run, post } = await legacyRun()
  assert.equal((await f.run()).canRetryMeme, true)
  const results = await Promise.allSettled([f.service.action(run.id, 'retry-meme'), f.service.action(run.id, 'retry-meme')])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  f.restart(); await f.step(); await f.step(6000)
  const result = await f.run()
  assert.equal(result.id, run.id); assert.equal(result.draft!.text, post.text)
  assert.equal(result.status, 'published'); assert.ok(result.postImageId)
  assert.equal(result.meme!.plannerCalls, 2); assert.equal(result.meme!.imageCalls, 1)
  assert.equal((await f.service.get(203)).runs.length, 1)
  f.restart(); await f.step(600_000)
  assert.equal(f.counts.publish, 1)
  await assert.rejects(f.service.action(run.id, 'retry-meme'))
})

test('Stop, content issues, attempted sends, history reservations and busy account prohibit recovery', async () => {
  for (const reason of ['stop', 'issues', 'attempt', 'history', 'busy']) {
    const { f, run } = await legacyRun()
    if (reason === 'stop') run.stop = true
    if (reason === 'issues') run.issues = ['post_topic_forbidden']
    if (reason === 'attempt') run.attemptedAt = 1
    if (reason === 'history') await f.deps.store.claim('reserved', { id: 'reserved', account: 203,
      runId: run.id, hash: 'reserved', text: run.draft!.text, signature: 'reserved', status: 'sending' })
    if (reason === 'busy') await f.deps.store.put('runs', 'other', { ...run, id: 'other', status: 'queued' })
    await f.deps.store.put('runs', run.id, run); f.restart()
    await assert.rejects(f.service.action(run.id, 'retry-meme'))
    assert.equal(f.counts.publish, 0)
  }
})

test('QA quality warnings never stop the seven-day queue across restarts', async () => {
  const f = fixture()
  f.deps.memes!.review = async () => ({ issues: ['weak_relevance'], repair: 'Show the post topic more clearly' })
  const posts = Array.from({ length: 7 }, (_, index) => ({ date: `2026-09-${String(7 + index).padStart(2, '0')}`,
    text: `Original post for day ${index + 1}, with its own generated meme.` }))
  await f.service.update(203, { ...defaults(203), contentMode: 'prepared', scheduled: true, preparedPosts: posts })
  for (const post of posts) {
    f.setNow(Date.parse(`${post.date}T10:00:00+03:00`)); f.restart()
    await f.step(); await f.step(6000)
    const run = await f.run()
    assert.equal(run.status, 'published'); assert.equal(run.draft!.text, post.text)
    assert.ok(run.postImageId); assert.deepEqual(run.meme!.qa!.issues, ['weak_relevance'])
    assert.equal(run.meme!.imageCalls, 2)
  }
  assert.equal(f.counts.publish, 7)
})
