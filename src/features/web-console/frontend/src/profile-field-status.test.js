import assert from 'node:assert/strict'
import { profileFieldStatuses } from './profile-field-status.js'
import { editableFields } from '../../../linkedin-automation/profile-filler/editable-fields.ts'
import { comparisonGroups } from './profile-comparison-view.js'
import { previewSummary } from './profile-preview-view.js'
import { issueMessage, issueResolution } from './profile-issue-view.js'
import { canApplyProfile, canStopProfileGeneration, profileStatus } from './profile-workflow-view.js'
const date = { level: 'fatal', path: 'profile.education[0].data.end_date',
  message: 'Unipile requires a month to write end_date; the CV does not supply it.',
  resolution: 'Confirm the missing date in the source CV; no month will be invented.' }
const preview = { canApply: true, skippedChanges: ['profile.education[0]'], issues: [date],
  document: { profile: { headline: 'Engineer', education: [{ data: {
    school: 'University', degree: 'BSc', end_date: '2021' } }] } },
  steps: [{ id: 'headline', section: 'headline', action: 'update' }] }
const fields = profileFieldStatuses(preview, 'education')
assert.equal(fields.length, editableFields.education.length, 'missing optional fields remain editable')
assert.equal(fields.find(field => field.key === 'end_date').status, 'blocker')
assert.equal(fields.find(field => field.key === 'school').status, 'warning')
assert.match(fields.find(field => field.key === 'end_date').comments.join(' '), /месяц окончания/)
assert(!fields.some(field => /Unipile requires/.test(field.comments.join(' '))))
assert.match(issueResolution(date), /карандаш/)
assert.match(issueMessage(date), /месяц/)
assert.equal(profileFieldStatuses(preview, 'headline')[0].labelStatus, 'Готово')
assert.deepEqual(profileFieldStatuses(preview, 'headline')[0].comments, [], 'do not repeat the ready label')
assert.deepEqual(profileFieldStatuses(preview, 'headline', { steps: [{ section: 'headline',
  stepId: 'headline', status: 'verified' }] })[0].comments, [])
assert.equal(profileFieldStatuses(preview, 'headline', { steps: [{ section: 'headline',
  stepId: 'headline', status: 'verifying' }] })[0].labelStatus, 'Есть замечания')
assert.deepEqual(profileFieldStatuses({}, 'education'), [])
assert.equal(canApplyProfile({ preview }), true)
assert.equal(canApplyProfile({ preview: { issues: [date] } }), false, 'legacy Preview stays blocked')
assert.equal(canStopProfileGeneration({ status: 'verifying' }), false)
assert.equal(canStopProfileGeneration({ status: 'generating_profile' }), true)
assert.equal(profileStatus({ phase: 'generation_stopped' }), 'Подготовка остановлена')
assert.equal(previewSummary(preview).education.blocked, 1)
assert.equal(previewSummary({ ...preview, issues: [] }).education.blocked, 1, 'dependency skips count too')
assert.equal(comparisonGroups(preview).find(group => group.section === 'education').status, 'blocker')
const legacy = { issues: [{ level: 'warning', path: 'profile.experience.unmatched', message: 'Keep unmatched records' }],
  steps: [1, 2, 3].map(i => ({ id: `experience-${i}`, section: 'experience', action: 'update',
    before: { company: `Before ${i}`, description: 'Full old description' }, after: { company: `After ${i}`, skills: ['Go'] } })) }
const fallback = comparisonGroups(legacy)[0]
assert.equal(fallback.entries.length, 3)
assert.deepEqual(fallback.entries.map(entry => entry.before), legacy.steps.map(step => step.before))
assert.deepEqual(fallback.entries.map(entry => entry.after), legacy.steps.map(step => step.after))
assert.deepEqual(fallback.issues, legacy.issues)
assert.equal(fallback.status, 'warning')
assert.equal(comparisonGroups({ document: { profile: {} }, steps: [{ id: 'headline', section: 'headline', after: 'Preserved' }] })[0].entries[0].after, 'Preserved')
assert.equal(comparisonGroups({ document: { profile: { headline: 'Same' } }, currentValues: { headline: 'Same' } })[0].entries[0].before, 'Same')
assert.deepEqual(comparisonGroups({ issues: [{ level: 'fatal', path: 'profile.education', message: 'Unavailable' }] })[0].status, 'blocker')
console.log('profile per-field readiness tests passed')
