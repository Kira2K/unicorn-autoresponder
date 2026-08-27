const assert = require('node:assert/strict')
const { validatePlanPayloads } = require('../payload-contract.ts') as any

const step = (section: string, value: unknown) => ({
  id: `${section}-1`, section, action: 'create', summary: section, before: null, after: value,
  payload: section === 'about' ? { bio: value } :
    { specifics: { linkedin: { [section]: value } } },
  verification: { kind: section, expected: value }
})

const valid: any[] = [
  step('headline', 'Engineer'), step('about', 'About'),
  step('skills', [{ name: 'Go' }]),
  step('experience', {
    operation: 'create', notify_network: false, job_title: { name: 'Engineer' },
    company: { name: 'Acme' }, start_date: { year: 2024, month: 1 },
    workplace_type: 'REMOTE'
  }),
  step('education', {
    operation: 'create', notify_network: false, school: { name: 'University' },
    start_date: { year: 2020, month: 9 }
  }),
  step('open_to_work', {
    job_title: [{ title: 'Engineer', id: 'job-id' }],
    workplace: [{ type: 'REMOTE', location: ['location-id'] }],
    employment_type: ['FULL_TIME'], visibility: 'RECRUITERS_ONLY'
  })
]
valid.push(step('experience', { operation: 'edit', id: 'experience-id', description: 'New' }))
valid.push(step('education', { operation: 'edit', id: 'education-id', degree: { name: 'Master' } }))

const validIssues: any[] = []
const events: any[] = []
validatePlanPayloads(valid, validIssues, { event: (...args: any[]) => events.push(args) })
assert.deepEqual(validIssues, [])
assert.equal(events.length, valid.length)
assert.ok(events.every(event => event[0] === 'payload_validation' && event[1] === 'succeeded'))

const invalid = structuredClone(valid)
invalid[3].payload.specifics.linkedin.experience.unknown = 'not-allowed'
invalid[5].payload.specifics.linkedin.open_to_work.job_title[0].id = ''
const invalidIssues: any[] = []
validatePlanPayloads(invalid, invalidIssues)
assert.ok(invalidIssues.some(issue => issue.level === 'fatal' && issue.path.endsWith('.unknown')))
assert.ok(invalidIssues.some(issue => issue.level === 'fatal' && issue.path.endsWith('.id')))
assert.equal(JSON.stringify(invalidIssues).includes('not-allowed'), false)

console.log('profile payload contract tests passed')
