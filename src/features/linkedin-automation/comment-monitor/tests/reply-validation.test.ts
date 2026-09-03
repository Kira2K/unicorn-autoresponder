const assert = require('node:assert/strict')
const { validateReply } = require('../reply-validation.ts') as typeof import('../reply-validation.ts')
const { deterministicSkipReason, meaningfulWords, validateModelDecision } =
  require('../reply-policy.ts') as typeof import('../reply-policy.ts')

assert.equal(validateReply('Reliable retries keep distributed systems resilient.', 'distributed systems',
  'The post discusses distributed systems and retries.').ok, true)
assert.equal(validateReply('Great insight about retries today.', 'retries', 'retries').ok, false)
assert.equal(validateReply('Retries help.', 'retries', 'retries').ok, false)
assert.equal(validateReply('Reliable retries keep systems resilient. Extra sentence.', 'retries',
  'retries').ok, false)
assert.equal(validateReply('Reliable systems need grounded retry strategies.', 'missing phrase',
  'retry strategies').ok, false)
assert(validateReply('Call me at +48 123 456 789 today.', 'today', 'today').issues
  .includes('comment_reply_format_invalid'))
assert.equal(meaningfulWords('🔥').length, 0)
assert.equal(meaningfulWords('。!?').length, 0)
assert.equal(meaningfulWords('Thanks!').length, 1)
assert.equal(meaningfulWords('Спасибо!').length, 1)
assert.equal(meaningfulWords('don’t').length, 1)
assert.equal(meaningfulWords('c’est').length, 1)
assert.equal(meaningfulWords('Great post!').length, 2)
assert.ok(meaningfulWords('写得很好').length > 1)
assert.ok(meaningfulWords('これは素晴らしい投稿です').length > 1)
assert.equal(deterministicSkipReason('Спасибо!'), 'too_short')
assert.equal(deterministicSkipReason('谢谢'), 'too_short')
assert.equal(deterministicSkipReason('don’t'), 'too_short')
assert.equal(deterministicSkipReason('c’est'), 'too_short')
assert.equal(deterministicSkipReason('写得很好'), undefined)
assert.equal(deterministicSkipReason('これは素晴らしい投稿です'), undefined)
assert.equal(deterministicSkipReason('Great post!'), undefined)
assert.deepEqual(validateModelDecision({ action: 'skip', reason: 'ai_authorship_question',
  reply: '', grounding_phrase: '' }, 'Did AI write this?').decision,
{ action: 'skip', reason: 'ai_authorship_question' })
assert.deepEqual(validateModelDecision({ action: 'skip', reason: 'irrelevant_to_context',
  reply: '', grounding_phrase: '' }, 'Как зовут королеву Британии?').decision,
{ action: 'skip', reason: 'irrelevant_to_context' })
assert.equal(validateModelDecision({ action: 'skip', reason: 'too_short', reply: '',
  grounding_phrase: '' }, 'Great post!').ok, false)
assert.equal(validateModelDecision({ action: 'skip', reason: 'irrelevant_to_context',
  reply: 'Hidden write.', grounding_phrase: '' }, 'Unrelated question here.').ok, false)
assert.equal(validateModelDecision({ action: 'skip', reason: 'insult', reply: 'Hidden write.',
  grounding_phrase: '' }, 'You are an idiot.').ok, false)
console.log('comment reply validation tests passed')
