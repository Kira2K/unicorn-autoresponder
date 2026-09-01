const assert = require('node:assert/strict')
const { CONNECTION_SEARCH_CATALOG, connectionMarketTier } = require('../catalog.ts') as
  typeof import('../catalog.ts')
const { makeRun, publicRun, selectTemplates } = require('../run-model.ts') as
  typeof import('../run-model.ts')
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
const firstReserve = first.recruiter.findIndex(item => connectionMarketTier(item.city) === 'reserve')
assert.equal(firstReserve > 0, true)
assert.equal(first.recruiter.slice(0, firstReserve)
  .every(item => connectionMarketTier(item.city) === 'primary'), true)
assert.equal(first.recruiter.slice(firstReserve)
  .every(item => connectionMarketTier(item.city) === 'reserve'), true)

const usedKey = first.recruiter[0].sourceKey
const historical = [{ ...run, runId: 'prior-run', usedSearchKeys: [usedKey] }] as any
const rotated = selectTemplates(CONNECTION_SEARCH_CATALOG, historical, run)
assert.notEqual(rotated.recruiter[0].sourceKey, usedKey)
const rotatedPrimary = rotated.recruiter.filter(item => connectionMarketTier(item.city) === 'primary')
assert.equal(rotatedPrimary.at(-1)?.sourceKey, usedKey)

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

const privateRun = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
  linkedinUrl: 'https://linkedin.com/in/test', accountId: 'secret-account', stack: 'GO' },
new Date('2026-08-29T09:00:00Z'), 'Europe/Moscow', false)
privateRun.seenPersonIds = ['secret-person']
privateRun.usedSearchKeys = ['private-search-key']
privateRun.executorId = 'private-writer'; privateRun.heartbeatAt = privateRun.createdAt
privateRun.searchProgress.recentSearchAt = [privateRun.createdAt]
privateRun.searchProgress.searchReservedUntil = privateRun.createdAt
privateRun.searchProgress.nextCursor = 'private-cursor'
privateRun.searchProgress.locations.Berlin = { status: 'resolved', city: 'Berlin',
  id: 'private-location', resolvedAt: privateRun.createdAt }
privateRun.searchProgress.pendingCandidates = [{ personId: 'secret-person', name: 'Private Name',
  headline: 'Private Headline', audience: 'recruiter' } as any]
const publicValue: any = publicRun(privateRun)
assert.equal('accountId' in publicValue, false)
assert.equal('seenPersonIds' in publicValue, false)
assert.equal('usedSearchKeys' in publicValue, false)
assert.equal('executorId' in publicValue, false)
assert.equal('heartbeatAt' in publicValue, false)
assert.equal('pendingCandidates' in publicValue.searchProgress, false)
assert.equal('recentSearchAt' in publicValue.searchProgress, false)
assert.equal('searchReservedUntil' in publicValue.searchProgress, false)
assert.equal('nextCursor' in publicValue.searchProgress, false)
assert.equal('locations' in publicValue.searchProgress, false)
assert.equal(publicValue.searchProgress.queuedCandidateCount, 1)
assert.deepEqual(publicValue.searchProgress.queuedByAudience, { recruiter: 1, technical: 0 })

console.log('connection search rotation tests passed')
