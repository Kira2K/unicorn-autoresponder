import assert from 'node:assert/strict'
import { previewSummary, skillSummary } from './profile-preview-view.js'
import { profileValue, profileRows } from './profile-value-view.js'
import { progressGroups } from './profile-progress-view.js'
import { profileLink, profileStage, profileStatus } from './profile-workflow-view.js'

const batches = Array.from({ length: 6 }, (_, index) => ({ id: `skills-${index}`, section: 'skills',
  before: { count: 42 + index * 10 }, after: { count: Math.min(100, 52 + index * 10),
    added: Array.from({ length: index === 5 ? 8 : 10 }, (_, skill) => `Skill ${index * 10 + skill}`) } }))
const steps = [...batches, { id: 'skills-final-check', section: 'skills', before: { count: 42 }, after: { count: 100 } }]
assert.deepEqual({ ...skillSummary(steps), added: skillSummary(steps).added.length }, { existing: 42, target: 100, added: 58 })
assert.equal(skillSummary([...steps, batches[0]]).added.length, 58)
assert.equal(skillSummary([]).existing, null)
assert.equal(previewSummary({}).experience.total, null)
assert.equal(previewSummary({ document: { profile: { experience: [{}, {}, {}] } } }).experience.total, 3)
assert.equal(profileValue({ year: 2019 }), '2019')
assert.equal(profileValue('present'), 'По настоящее время')
assert.equal(profileValue({ id: 'private-id' }), 'Нет данных')
assert.equal(profileRows({ job_title: 'Developer', start_date: { year: 2019 } })[0].value, 'Developer')
assert.equal(profileLink({ linkedinUrl: 'javascript:alert(1)' }), '')
assert.equal(profileLink({ linkedinUrl: 'https://linkedin.com.evil.test/in/a/' }), '')
assert.equal(profileLink({ linkedinUrl: 'https://www.linkedin.com/in/mock/' }), 'https://www.linkedin.com/in/mock/')
assert.equal(profileStage({ status: 'verifying' }), 2)
assert.equal(profileStage({ status: 'needs_expert_review', phase: 'partially_completed' }), 3)
assert.equal(profileStatus({ status: 'needs_expert_review', phase: 'partially_completed' }), 'Заполнен частично')
const result = { steps: steps.map(step => ({ stepId: step.id, section: 'skills', status: 'verified' })) }
result.steps.at(-1).status = 'write_accepted'
const group = progressGroups(result, steps)[0]
assert.equal(group.confirmed, false)
assert.equal(group.label, 'Принято, проверяем')
result.steps.at(-1).status = 'verified'
assert.equal(progressGroups(result, steps)[0].confirmed, true)
console.log('profile preview presentation tests passed')
