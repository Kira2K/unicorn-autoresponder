const { test } = require('node:test') as typeof import('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { assessCards, selectPosts, draftComment } = require('./selection.mts') as typeof import('./selection.mts')
import type { FeedCard } from '../../../integrations/unipile/home-feed.mts'
const card = (id: string, extra = {}): FeedCard => ({ id, text: 'Concrete professional content', resharedText: '', sponsored: false, ...extra })

test('selection keeps five unique eligible posts and a comment target among them, independent of stack', () => {
  const cards = Array.from({ length: 9 }, (_, i) => card(String(i), { canComment: i > 6 }))
  cards[0].sponsored = true; cards[1].reacted = true
  const assessments = cards.map(c => ({ id: c.id, category: 'professional' as const, reason: 'Практический опыт' }))
  assert.deepEqual(selectPosts(cards, assessments, ['2']), { likes: ['3', '4', '5', '6', '7'], comment: '7' })
})
test('model output must cover exactly the supplied cards; no invented IDs or categories', async () => {
  for (const assessments of [[], [{ id: 'invented', category: 'professional', reason: 'x' }],
    [{ id: '1', category: 'yes', reason: 'x' }]]) {
    await assert.rejects(assessCards([card('1')], { evaluate: async () => ({ assessments }), comment: async () => undefined }), /feed_assessment_invalid/)
  }
})
test('comment requires grounding and cannot contain a link; refusal is a local skip', async () => {
  const model = (value: unknown) => ({ evaluate: async () => undefined, comment: async () => value })
  assert.equal(await draftComment(card('1'), model({ text: '', evidence: '' })), undefined)
  await assert.rejects(draftComment(card('1'), model({ text: 'Buy https://example.com now!', evidence: 'Concrete professional' })), /feed_comment_invalid/)
  await assert.rejects(draftComment(card('1'), model({ text: 'A useful detailed comment.', evidence: 'invented quote' })), /feed_comment_invalid/)
  assert.equal(await draftComment(card('1'), model({ text: 'A useful detailed comment.', evidence: 'Concrete professional' })), 'A useful detailed comment.')
})
test('quotation wrappers around exact evidence do not reject a grounded comment; altered quotes still fail', async () => {
  const model = (evidence: string) => ({ evaluate: async () => undefined, comment: async () => ({ text: 'A useful detailed comment.', evidence }) })
  for (const evidence of ['“Concrete professional”', '"Concrete professional"', '«Concrete professional»', ' Concrete professional '])
    assert.equal(await draftComment(card('1'), model(evidence)), 'A useful detailed comment.')
  for (const evidence of ['“Invented professional”', 'Concrete  professional', '“Concrete professional"'])
    await assert.rejects(draftComment(card('1'), model(evidence)), /feed_comment_invalid/)
})
