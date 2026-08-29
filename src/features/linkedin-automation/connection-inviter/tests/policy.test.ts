const assert = require('node:assert/strict')
const { evaluateCandidate, parseConnectionCandidate } = require('../policy.ts') as
  typeof import('../policy.ts')
const { networkDistance, profileAllowsInvitation } = require('../relation-policy.ts') as
  typeof import('../relation-policy.ts')

const recruiter: any = { sourceKey: 'r', audience: 'recruiter', city: 'Berlin',
  keywordTemplate: 'IT Recruiter {stack} Berlin', priority: 1, enabled: true }
const technical: any = { ...recruiter, sourceKey: 't', audience: 'technical',
  keywordTemplate: '{stack} Engineer Berlin' }
const candidate = (overrides = {}) => parseConnectionCandidate({ id: 'ACo1', display_name: 'Ada Doe',
  headline: 'Technical Recruiter', location: 'Berlin, Germany', network_distance: 2, ...overrides })

const exact = evaluateCandidate(candidate(), recruiter, 'Python')
assert.equal(exact.decision, 'eligible')
assert.equal(exact.roleCategory, 'recruiting')
assert.deepEqual(exact.hardReasons, [])
assert.equal(exact.softSignals.includes('city_exact'), true)

const offCity = evaluateCandidate(candidate({ location: 'Paris' }), recruiter, 'Python')
assert.equal(offCity.eligible, true)
assert.equal(offCity.softSignals.includes('city_outside_target'), true)

const unrelatedOffCity = evaluateCandidate(candidate({ headline: 'Sales Director', location: 'Paris' }),
  recruiter, 'Python')
assert.equal(unrelatedOffCity.eligible, false)
assert.equal(unrelatedOffCity.hardReasons.includes('role_mismatch'), true)
assert.equal(unrelatedOffCity.softSignals.includes('city_outside_target'), true)

const searchStackOnly = evaluateCandidate(candidate({ headline: 'Java Software Engineer' }), technical,
  'Python')
assert.equal(searchStackOnly.eligible, true)
assert.equal(searchStackOnly.softSignals.includes('stack_search_only'), true)
assert.equal(evaluateCandidate(candidate({ headline: 'Account Executive' }), technical,
  'Python').hardReasons.includes('role_mismatch'), true)

const missingLocation = evaluateCandidate(candidate({ location: '' }), recruiter, 'Python')
assert.equal(missingLocation.eligible, true)
assert.equal(missingLocation.softSignals.includes('location_missing'), true)

for (const headline of [
  'HR Business Partner', 'People Operations Lead', 'People & Culture Lead', 'Head of People',
  'Chief of People', 'Human Resources Manager',
  '\u0420\u0435\u043a\u0440\u0443\u0442\u0435\u0440',
  '\u041c\u0435\u043d\u0435\u0434\u0436\u0435\u0440 \u043f\u043e \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u0443',
  'Responsable ressources humaines', 'Especialista en recursos humanos',
  'Talent Acquisition Partner', 'Sourcing Specialist'
]) {
  assert.equal(evaluateCandidate(candidate({ headline }), recruiter, 'Python').eligible, true, headline)
}
assert.equal(evaluateCandidate(candidate({ headline: 'People Manager, Retail Store' }), recruiter,
  'Python').eligible, false)
assert.equal(evaluateCandidate(candidate({ headline: 'x' }), recruiter,
  'Python').hardReasons.includes('incomplete_profile'), true)

const missingDistance = evaluateCandidate(candidate({ network_distance: undefined }), recruiter,
  'Python')
assert.equal(missingDistance.eligible, true)
assert.equal(missingDistance.softSignals.includes('network_distance_unverified'), true)
for (const distance of [1, 3]) {
  assert.equal(evaluateCandidate(candidate({ network_distance: distance }), recruiter,
    'Python').hardReasons.includes('not_second_degree'), true)
}
for (const relation of [{ pending_invitation: true }, { is_connection: true }]) {
  assert.equal(evaluateCandidate(candidate(relation), recruiter, 'Python')
    .hardReasons.includes('existing_relation'), true)
}

const multiple = evaluateCandidate(candidate({ id: '', display_name: '', headline: '',
  location: '', network_distance: 1, pending_invitation: true }), recruiter, 'Python')
assert.deepEqual(multiple.hardReasons,
  ['missing_person_id', 'incomplete_profile', 'not_second_degree', 'existing_relation', 'role_mismatch'])
assert.equal(multiple.softSignals.includes('location_missing'), true)

assert.equal(candidate({ network_distance: 'SECOND_DEGREE' }).distance, 2)
assert.deepEqual(profileAllowsInvitation({ is_connection: true }),
  { allowed: false, reasonCode: 'existing_relation' })
assert.deepEqual(profileAllowsInvitation({ network_distance: 'FIRST_DEGREE' }),
  { allowed: false, reasonCode: 'not_second_degree' })
assert.deepEqual(profileAllowsInvitation({ network_distance: 'SECOND_DEGREE' }),
  { allowed: true, reasonCode: 'preflight_ok' })
assert.deepEqual(profileAllowsInvitation({}),
  { allowed: false, reasonCode: 'relationship_unverified' })
assert.equal(networkDistance('DISTANCE_2'), 2)
console.log('connection candidate policy tests passed')
