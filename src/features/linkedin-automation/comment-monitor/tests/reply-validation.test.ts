const assert = require('node:assert/strict')
const { validateReply } = require('../reply-validation.ts') as typeof import('../reply-validation.ts')

assert.equal(validateReply('Reliable retries keep distributed systems resilient.', 'distributed systems',
  'The post discusses distributed systems and retries.').ok, true)
assert.equal(validateReply('Great insight about retries today.', 'retries', 'retries').ok, false)
assert.equal(validateReply('Retries help.', 'retries', 'retries').ok, false)
assert.equal(validateReply('Reliable retries keep systems resilient. Extra sentence.', 'retries',
  'retries').ok, false)
assert.equal(validateReply('Reliable systems need grounded retry strategies.', 'missing phrase',
  'retry strategies').ok, false)
console.log('comment reply validation tests passed')
