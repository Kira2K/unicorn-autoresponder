const { test } = require('node:test') as typeof import('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createFeedActions } = require('./feed-actions.mts') as typeof import('./feed-actions.mts')
import type { FeedAction } from '../../features/linkedin-automation/feed-reader/run.mts'
const value = { object: 'Post', id: 'canonical/id', text: 'text', author: { id: 'author' },
  permissions: { can_react: true, can_post_comments: true }, user_reacted: false }
test('prepare resolves native activity ID through GET, likes and top-level comments use returned canonical ID', async () => {
  const calls: any[] = []
  const api = createFeedActions({ accountId: 'acc_test', now: Date.now, client: { request: async (...args) => {
    calls.push(args)
    return args[1].endsWith('reactions') ? { object: 'PostReactionAdded' } : args[1].endsWith('comments') ?
      { object: 'Comment', id: 'comment1', text: 'text', is_sender: true } : value
  } } })
  const p = await api.prepare({ id: 'urn:li:activity:123', text: 'text', resharedText: '', sponsored: false })
  await api.like(p.id); await api.comment(p.id, 'text')
  assert.equal(calls[0][1], '/acc_test/posts/activity%3A123')
  assert.equal(calls[1][1], '/acc_test/posts/canonical%2Fid/reactions')
  assert.equal(calls[2][1], '/acc_test/posts/canonical%2Fid/comments')
  assert.deepEqual(calls[1][2], { reaction: 'linkedin_like' })
  assert.deepEqual(calls[2][2], { text: 'text' })
})
test('old/missing date, foreign and ambiguous text matches never confirm an unknown comment', async () => {
  const action: FeedAction = { key: 'key', cardId: 'urn:li:activity:123', postId: 'canonical', kind: 'comment',
    state: 'verifying', attemptedAt: 100_000, text: 'text' }
  const good = { object: 'Comment', id: '1', text: 'text', is_sender: true, created_at: new Date(100_000).toISOString() }
  for (const [data, confirmed] of [ [[good], true], [[{ ...good, created_at: new Date(90_000).toISOString() }], false],
    [[{ ...good, created_at: undefined }], false], [[{ ...good, is_sender: false }], false], [[good, { ...good, id: '2' }], false] ] as [any[], boolean][]) {
    const api = createFeedActions({ accountId: 'acc_test', now: () => 200_000, client: { request: async () => ({ data, total_count: data.length }) } })
    assert.equal(await api.verify(action), confirmed)
  }
})
test('known comment ID takes priority over identical text; errors propagate without POST retry', async () => {
  let calls = 0
  const api = createFeedActions({ accountId: 'acc_test', now: Date.now, client: { request: async () => {
    calls++; throw Object.assign(new Error('server failure'), { details: { httpStatus: 500 } })
  } } })
  await assert.rejects(api.like('id')); assert.equal(calls, 1)
  const reader = createFeedActions({ accountId: 'acc_test', now: Date.now, client: { request: async () => ({
    data: [{ object: 'Comment', id: 'old', is_sender: true, text: 'text' }], total_count: 1 }) } })
  assert.equal(await reader.verify({ key: 'a', kind: 'comment', cardId: 'a', postId: 'id', text: 'text', state: 'verifying', commentId: 'new' }), false)
})

test('partial list without a total cannot confirm a text-only match; other reactions do not confirm a like', async () => {
  const comment: FeedAction = { key: 'a', kind: 'comment', cardId: 'a', postId: 'id', text: 'text', state: 'verifying', attemptedAt: 100_000 }
  const incomplete = createFeedActions({ accountId: 'acc_test', now: () => 200_000, client: { request: async () => ({
    data: [{ object: 'Comment', id: 'match', text: 'text', is_sender: true, created_at: new Date(100_000).toISOString() }] }) } })
  assert.equal(await incomplete.verify(comment), false)
  // V2 live read-back returns "like" although the write contract requires "linkedin_like".
  for (const [reaction, confirmed] of [['like', true], ['linkedin_like', true], [true, true], ['love', false], ['linkedin_love', false], [false, false]] as [any, boolean][]) {
    const api = createFeedActions({ accountId: 'acc_test', now: Date.now, client: { request: async () => ({ ...value, id: 'id', user_reacted: reaction }) } })
    assert.equal(await api.verify({ ...comment, kind: 'like' }), confirmed)
  }
})

test('a repost read-back can resolve to its original post ID, but never an unrelated post', async () => {
  const id = (...parts: string[]) => Buffer.from(JSON.stringify(parts)).toString('base64')
  const expected = id('activity:123', 'activity:456')
  for (const [actual, confirmed] of [[id('activity:456'), true], [id('activity:123'), false],
    [id('activity:789'), false], [id('activity:123', 'activity:789'), false]] as [string, boolean][]) {
    const api = createFeedActions({ accountId: 'acc_test', now: Date.now,
      client: { request: async () => ({ ...value, id: actual, user_reacted: 'like' }) } })
    assert.equal(await api.verify({ key: 'a', kind: 'like', cardId: 'urn:li:activity:123',
      postId: expected, state: 'verifying' }), confirmed)
  }
})
