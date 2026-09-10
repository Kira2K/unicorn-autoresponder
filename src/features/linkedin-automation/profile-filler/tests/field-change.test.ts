import assert from 'node:assert/strict'
import { changeProfileField } from '../field-change.ts'
import { validateProfileFile } from '../validator.ts'

export function testFieldChange() {
  const input = validateProfileFile({ profile: { headline: 'Engineer', experience: [1, 2, 3].map(i => ({
    data: { company: `Company ${i}`, job_title: 'Engineer', start_date: '2020', end_date: '2021' }
  })), education: [{ data: { school: 'University', degree: 'BSc', start_date: '2016', end_date: '2020' } }] } }).value!
  input.experience.forEach((entry, index) => { entry.factId = `exp_${index + 1}` })
  input.education[0].factId = 'edu_1'
  const baseline = structuredClone(input)
  const path = 'profile.education[0].data.end_date'
  const changed = changeProfileField(input, { path, value: '2020-06' }).input
  assert.deepEqual(input, baseline, 'editing never mutates the saved input')
  assert.deepEqual(changed.experience, input.experience, 'all three facts remain unchanged')
  assert.equal(changed.education[0].factId, 'edu_1')
  assert.deepEqual(changed.education[0].match, input.education[0].match)
  assert.deepEqual(changed.education[0].data.endDate, { year: 2020, month: 6 })
  for (const field of ['accountId', 'profile.__proto__', 'profile.headline.headline',
    'profile.education[0].factId', 'profile.education[0].match.school', 'profile.education[999].data.school']) {
    assert.throws(() => changeProfileField(input, { path: field, value: 'bad' }), { code: 'profile_field_invalid' })
  }
  for (const value of ['2020-13', 'June', '2015-01']) {
    assert.throws(() => changeProfileField(input, { path, value }), { code: 'profile_field_invalid' })
  }
  assert.throws(() => changeProfileField(input, { path: 'profile.experience[0].data.company', value: '' }),
    { code: 'profile_field_invalid' })
  assert.throws(() => changeProfileField(input, { path: 'profile.headline', value: ['not a string'] }),
    { code: 'profile_field_invalid' })
}
