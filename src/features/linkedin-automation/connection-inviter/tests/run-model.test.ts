const assert = require('node:assert/strict')
const { CONNECTION_SEARCH_CATALOG } = require('../catalog.ts') as typeof import('../catalog.ts')
const { selectTemplates } = require('../run-model.ts') as typeof import('../run-model.ts')
const { nextConnectionAudience } = require('../audience-sequence.ts') as
  typeof import('../audience-sequence.ts')

const run = {
  runId: 'random-city-order-2026-08-29', platformAccountId: 7, safeRecruiterOnly: false
} as any
const first = selectTemplates(CONNECTION_SEARCH_CATALOG, [], run)
const repeated = selectTemplates(CONNECTION_SEARCH_CATALOG, [], run)

assert.deepEqual(first, repeated)
assert.notEqual(first.recruiter[0].city, 'Abu Dhabi')
assert.notDeepEqual(first.recruiter.slice(0, 10).map(item => item.priority),
  [...first.recruiter].sort((a, b) => a.priority - b.priority).slice(0, 10)
    .map(item => item.priority))
assert.equal(first.recruiter.length, 200)
assert.equal(first.technical.length, 200)

const usedKey = first.recruiter[0].sourceKey
const historical = [{ ...run, usedSearchKeys: [usedKey] }] as any
const rotated = selectTemplates(CONNECTION_SEARCH_CATALOG, historical, run)
assert.notEqual(rotated.recruiter[0].sourceKey, usedKey)
assert.equal(rotated.recruiter.at(-1)?.sourceKey, usedKey)

const sent = { recruiter: 0, technical: 0 }
const sequence: string[] = []
for (let index = 0; index < 40; index += 1) {
  const audience = nextConnectionAudience(sent, { recruiter: 28, technical: 12 })!
  sequence.push(audience); sent[audience] += 1
}
assert.deepEqual(sequence.slice(0, 10), [
  'recruiter', 'recruiter', 'technical', 'recruiter', 'recruiter',
  'technical', 'recruiter', 'recruiter', 'technical', 'recruiter'
])
assert.deepEqual(sent, { recruiter: 28, technical: 12 })

const unbalanced = { recruiter: 5, technical: 0 }
assert.equal(nextConnectionAudience(unbalanced, { recruiter: 28, technical: 12 }), 'technical')

console.log('connection search rotation tests passed')
