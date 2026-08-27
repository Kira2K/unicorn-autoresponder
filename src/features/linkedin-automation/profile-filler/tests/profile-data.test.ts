const assert = require('node:assert/strict')
const { readDate, sectionReadable } = require('../profile-data.ts') as any
const { experienceMatches, educationMatches } = require('../profile-match.ts') as any

assert.deepEqual(readDate('2024-09'), { year: 2024, month: 9 })
assert.deepEqual(readDate('09/01/2024'), { year: 2024, month: 9 })
assert.deepEqual(readDate('13/01/2024'), undefined)
assert.equal(sectionReadable({ specifics: { skills: [], throttled_sections: [] } }, 'skills'), true)
assert.equal(sectionReadable({ specifics: { skills: [],
  throttled_sections: ['linkedin_skills'] } }, 'skills'), false)

assert.equal(experienceMatches({ company: { name: 'Acme' }, job_title: 'Engineer',
  started_on: '09/01/2024' }, {
  company: 'Acme', jobTitle: 'Engineer', startDate: { year: 2024, month: 9 }
}), true)
assert.equal(educationMatches({ school: { name: 'University' }, started_on: '09/01/2020' }, {
  school: 'University', startDate: { year: 2020, month: 9 }
}), true)

console.log('profile data normalization tests passed')
