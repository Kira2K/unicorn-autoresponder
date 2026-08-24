const assert = require('node:assert/strict')
const { logValidationFields } = require('../validation-logging.ts') as any
const { createProfileLogger } = require('../profile-logger.ts') as any

const lines: string[] = []
const logger = createProfileLogger({ jobId: 'validation-test',
  writeLine: (line: string) => lines.push(line) })
logValidationFields(logger, { profile: {
  headline: 'must-not-leak',
  experience: [{ data: { company: 'secret-company', job_title: 'secret-title' } }],
  skills: { add: ['secret-skill'] }
} }, [
  { level: 'fatal', path: 'profile.experience[0].data.start_date',
    message: 'must-not-leak' },
  { level: 'warning', path: 'profile.experience[0].data.job_title',
    message: 'must-not-leak', autoFixed: true }
])

const events = lines.map(line => JSON.parse(line))
const byPath = (path: string) => events.find(event => event.fieldPath === path)
assert.equal(byPath('profile.headline').status, 'succeeded')
assert.equal(byPath('profile.experience[0].data.company').status, 'succeeded')
assert.equal(byPath('profile.experience[0].data.job_title').status, 'succeeded')
assert.equal(byPath('profile.experience[0].data.start_date').status, 'failed')
assert.equal(byPath('profile.skills.add').status, 'succeeded')
assert.equal(lines.some(line => line.includes('must-not-leak')), false)
assert.equal(lines.some(line => line.includes('secret-company')), false)
console.log('profile validation logging tests passed')
