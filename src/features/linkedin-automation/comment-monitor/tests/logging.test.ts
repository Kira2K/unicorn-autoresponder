const assert = require('node:assert/strict')
const { createCommentLogger } = require('../logger.ts') as typeof import('../logger.ts')

const lines: string[] = []
const logger = createCommentLogger({ jobId: 'job', platformAccountId: 7,
  writeLine: line => lines.push(line) })
logger.event('openai_response', 'succeeded', { model: 'terra', inputTokens: 10,
  commentText: 'SECRET COMMENT', replyText: 'SECRET REPLY', apiKey: 'SECRET KEY' })
logger.event('paired', 'started')
logger.event('paired', 'succeeded')
const output = lines.join('\n')
assert.match(output, /"inputTokens":10/)
assert.doesNotMatch(output, /SECRET/)
assert.match(output, /"operationId":"[^"]+"/)
assert.equal(JSON.parse(lines[1]).operationId, JSON.parse(lines[2]).operationId)
assert.equal(typeof JSON.parse(lines[2]).durationMs, 'number')
console.log('comment logger tests passed')
