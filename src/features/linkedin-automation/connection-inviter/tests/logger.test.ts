const assert = require('node:assert/strict')
const { createConnectionLogger } = require('../logger.ts') as typeof import('../logger.ts')

const lines: string[] = []
const logger = createConnectionLogger({ writeLine: line => lines.push(line) })
logger.event('candidate_search', 'started', { runId: 'run-1', platformAccountId: 7,
  audience: 'recruiter', searchKey: 'recruiter-barcelona', personId: 'SECRET PERSON',
  keywords: 'SECRET KEYWORDS', apiKey: 'SECRET KEY' })
logger.event('candidate_search', 'succeeded', { runId: 'run-1', platformAccountId: 7,
  candidateCount: 4, eligibleCount: 2, skippedCount: 2 })
logger.event('invitation_write', 'failed', { runId: 'run-1', platformAccountId: 7,
  errorCode: 'unipile_timeout', profileUrl: 'SECRET URL' })
logger.event('run', 'failed', { runId: 'run-1', errorCode: 'connection_inviter_internal_error',
  errorName: 'AxiosError', causeCode: 'ECONNRESET', hasResponse: false, httpStatus: 503,
  errorMessage: 'SECRET MESSAGE' })

const output = lines.join('\n')
assert.match(output, /"candidateCount":4/)
assert.match(output, /"errorCode":"unipile_timeout"/)
assert.match(output, /"operationId":"[^"]+"/)
assert.doesNotMatch(output, /SECRET/)
assert.equal(JSON.parse(lines[0]).operationId, JSON.parse(lines[1]).operationId)
assert.equal(typeof JSON.parse(lines[1]).durationMs, 'number')
const failure = JSON.parse(lines.at(-1)!)
assert.equal(failure.errorName, 'AxiosError')
assert.equal(failure.causeCode, 'ECONNRESET')
assert.equal(failure.hasResponse, false)
assert.equal(failure.httpStatus, 503)
assert.equal(failure.errorMessage, undefined)
console.log('connection inviter logger tests passed')
