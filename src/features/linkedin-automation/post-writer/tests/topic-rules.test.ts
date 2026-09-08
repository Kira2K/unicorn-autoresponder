import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writePost } from '../writer.ts'
import { writerFixture } from './writer-fixture.ts'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { rulesKey } from '../content-rules.ts'

test('custom topic bypasses automatic selection; review and draft receive the exact topic', async () => {
  const f = writerFixture()
  let reviews = 0
  f.model.review = async (_context, input) => {
    reviews++
    assert.equal(input.topic.title, 'Go error boundaries')
    return { allowed: true, uncertain: false, onTopic: true }
  }
  const input = { ...f.input, rules: { requestedTopic: 'Go error boundaries' } }
  const before = structuredClone(input)
  const result = await writePost(input, f.model)
  assert.equal(result.status, 'ready')
  assert.equal(f.calls.topics, 0)
  assert.equal(reviews, 2)
  assert.deepEqual(input, before)
  await writePost(input, f.model, { checkpoint: result.checkpoint })
  assert.equal(reviews, 2, 'unchanged checked text is not reviewed again after restart')
})
test('semantic prohibition and unknown decisions fail closed; provider errors remain separate', async () => {
  const f = writerFixture()
  const input = { ...f.input, rules: { requestedTopic: 'A paraphrase of a prohibited topic', forbiddenTopics: ['a broader forbidden theme'] } }
  for (const verdict of [{ allowed: false, uncertain: false, onTopic: true },
    { allowed: true, uncertain: true, onTopic: true }, { allowed: true, uncertain: false, onTopic: false }]) {
    f.model.review = async () => verdict
    assert.equal((await writePost(input, f.model)).status, 'blocked')
    assert.equal(f.calls.draft, 0)
  }
  f.model.review = async () => { throw new Error('lost provider reply') }
  await assert.rejects(writePost(input, f.model), /lost provider reply/)
})
test('global and personal rules are additive; changing them invalidates approval', async () => {
  const f = fixture()
  await f.service.update(0, { ...defaults(0), forbiddenTopics: ['global theme'] })
  await f.service.update(203, { ...defaults(203), forbiddenTopics: ['personal theme'] })
  const seen: string[][] = []
  f.deps.generator.review = async (_context, input) => {
    seen.push(input.rules.forbiddenTopics!)
    return { allowed: !input.rules.forbiddenTopics?.includes('new restriction'), uncertain: false, onTopic: true }
  }
  await f.service.start(203, 'approval_required', 'policy-test')
  await f.step()
  assert.equal((await f.run()).status, 'awaiting_approval')
  assert.deepEqual(seen[0], ['global theme', 'personal theme'])
  await f.service.update(0, { ...defaults(0), forbiddenTopics: ['new restriction'] })
  await f.step()
  assert.equal((await f.run()).status, 'blocked')
  assert.equal(f.counts.publish, 0)
  assert.equal((await f.run()).approvedHash, undefined)
  await f.service.close()
})
test('rules changed during publication identity read prevent POST', async () => {
  const f = fixture()
  f.deps.adapter.identity = async () => {
    await f.service.update(203, { ...defaults(203), forbiddenTopics: ['new policy'] })
  }
  await f.service.start(203, 'automatic', 'policy-race')
  await f.step()
  assert.equal(f.counts.publish, 0)
  assert.equal((await f.run()).status, 'blocked')
  assert.equal((await f.run()).errorCode, 'post_policy_changed')
  assert.notEqual((await f.run()).policyKey, rulesKey({ forbiddenTopics: ['new policy'] }))
  await f.service.close()
})
