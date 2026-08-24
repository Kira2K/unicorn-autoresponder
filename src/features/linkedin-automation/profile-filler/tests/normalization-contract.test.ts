const assert = require('node:assert/strict')
const { analyzeProfileFile, validateProfileFile } = require('../validator.ts') as any

const variant = analyzeProfileFile({ headline: 'Engineer', experiences: {
  company_name: 'Acme', title: 'Developer', startDate: '2024-8',
  technologies: [{ text: 'Go' }]
} })
assert.equal(variant.valid, true)
assert.equal(variant.document.profile.experience[0].data.job_title, 'Developer')
assert.equal(variant.document.profile.experience[0].data.start_date, '2024-08')
assert.deepEqual(variant.document.profile.experience[0].data.skills, ['Go'])
assert.ok(variant.issues.some((issue: any) => issue.autoFixed))

const clean = analyzeProfileFile({ profile: { headline: 'Safe', li_at: 'must-not-leak',
  proxy_password: 'must-not-leak' } })
assert.equal(JSON.stringify(clean.document).includes('must-not-leak'), false)
assert.ok(clean.issues.some((issue: any) => issue.path === 'profile.li_at' && issue.autoFixed))
assert.ok(clean.issues.some((issue: any) => issue.path === 'profile.proxy_password' && issue.autoFixed))

const disabledExperienceType = analyzeProfileFile({ profile: { experience: [{ data: {
  company: 'Acme', job_title: 'Engineer', employment_type: 'INTERNSHIP', start_date: '2024-01'
} }] } })
assert.equal(Object.hasOwn(disabledExperienceType.document.profile.experience[0].data,
  'employment_type'), false)
assert.ok(disabledExperienceType.issues.some((issue: any) =>
  issue.path === 'profile.experience[0].data.employment_type' && issue.autoFixed &&
  issue.message.includes('temporarily disabled')))

const ids = validateProfileFile({ profile: { open_to_work: {
  job_titles: [{ name: 'Engineer', id: 'untrusted-title-id' }], workplace_types: ['REMOTE'],
  locations: [{ name: 'Europe', id: 'untrusted-location-id' }],
  employment_types: ['FULL_TIME'], visibility: 'RECRUITERS_ONLY'
} } })
assert.equal(JSON.stringify(ids.normalized).includes('untrusted-'), false)
assert.ok(ids.issues.filter((issue: any) => issue.path.endsWith('.id') && issue.autoFixed).length === 2)

console.log('profile normalization contract tests passed')
