const assert = require('node:assert/strict')
const { evaluateCandidate, parseConnectionCandidate } = require('../policy.ts') as typeof import('../policy.ts')
const { networkDistance, profileAllowsInvitation } = require('../relation-policy.ts') as
  typeof import('../relation-policy.ts')

const recruiter: any = { sourceKey: 'r', audience: 'recruiter', city: 'Berlin',
  keywordTemplate: 'IT Recruiter {stack} Berlin', priority: 1, enabled: true }
const technical: any = { ...recruiter, sourceKey: 't', audience: 'technical',
  keywordTemplate: '{stack} Engineer Berlin' }
const candidate = (overrides = {}) => parseConnectionCandidate({ id: 'ACo1', display_name: 'Ada Doe',
  headline: 'Technical Recruiter', location: 'Berlin, Germany', network_distance: 2, ...overrides })
assert.deepEqual(evaluateCandidate(candidate(), recruiter, 'Python'),
  { eligible: true, reasonCode: 'recruiter_match' })
assert.equal(evaluateCandidate(candidate({ id: '' }), recruiter, 'Python').reasonCode, 'missing_person_id')
assert.equal(evaluateCandidate(candidate({ location: 'Paris' }), recruiter, 'Python').reasonCode,
  'city_mismatch')
assert.equal(evaluateCandidate(candidate({ network_distance: 1 }), recruiter, 'Python').reasonCode,
  'not_second_degree')
assert.equal(evaluateCandidate(candidate({ network_distance: undefined }), recruiter, 'Python').reasonCode,
  'network_distance_unverified')
assert.equal(candidate({ network_distance: 'SECOND_DEGREE' }).distance, 2)
assert.equal(evaluateCandidate(candidate({ headline: 'Python Software Engineer' }), technical,
  'Python').eligible, true)
assert.equal(evaluateCandidate(candidate({ headline: 'Java Software Engineer' }), technical,
  'Python').reasonCode, 'stack_mismatch')
assert.equal(evaluateCandidate(candidate({
  headline: 'Senior Manager - Talent | Driving Leadership and Strategic Hiring'
}), recruiter, 'Python').eligible, true)
assert.equal(evaluateCandidate(candidate({ headline: 'Talent Development Manager' }), recruiter,
  'Python').reasonCode, 'role_mismatch')
assert.equal(evaluateCandidate(candidate({ headline: 'IT-рекрутер' }), recruiter, 'Python').eligible, true)
assert.equal(evaluateCandidate(candidate(), recruiter, undefined, true).reasonCode, 'safe_recruiter_match')
assert.deepEqual(profileAllowsInvitation({ is_connection: true }),
  { allowed: false, reasonCode: 'existing_relation' })
assert.deepEqual(profileAllowsInvitation({ network_distance: 'FIRST_DEGREE' }),
  { allowed: false, reasonCode: 'not_second_degree' })
assert.deepEqual(profileAllowsInvitation({ network_distance: 'SECOND_DEGREE' }),
  { allowed: true, reasonCode: 'preflight_ok' })
assert.deepEqual(profileAllowsInvitation({ specifics: { network_distance: 'FIRST_DEGREE' } }),
  { allowed: false, reasonCode: 'not_second_degree' })
assert.equal(networkDistance('DISTANCE_2'), 2)
console.log('connection candidate policy tests passed')
