import assert from 'node:assert/strict'
import { buildProfilePlan } from '../planner.ts'
import { prepareExperience, prepareEducation } from '../prepare-entry.ts'
import { validateProfileFile } from '../validator.ts'
import { editableFields } from '../editable-fields.ts'
import { selectedEntriesInput } from '../field-selection.ts'
import type { ProfileClient } from '../plan-types.ts'

export async function testFieldSelection() {
  const input = validateProfileFile({ profile: { headline: 'New headline', skills: { add: ['Go', 'Kafka',
    ...Array.from({ length: 98 }, (_, index) => `Skill ${index}`)] },
    experience: [{ data: { company: 'Company', job_title: 'Engineer', start_date: '2020-01',
      description: 'New description', skills: ['Kafka'] } }], education: [{ data: { school: 'University',
      degree: 'MSc', start_date: '2017-09', end_date: '2021', description: 'New education' } }] } }).value!
  const current = { provider_id: 'mock', description: 'Old headline', specifics: {
    experience: [{ id: 'exp-id', company: { name: 'Company' }, job_title: { name: 'Engineer' },
      start_date: { year: 2020, month: 1 }, description: 'Old description', skills: [] }],
    education: [{ id: 'bsc', school: { name: 'University' }, degree: { name: 'BSc' },
      start_date: { year: 2017, month: 9 } }, { id: 'msc', school: { name: 'University' }, degree: { name: 'MSc' },
      start_date: { year: 2017, month: 9 }, description: 'Old education' }], skills: [{ name: 'Go' }] } }
  const client: ProfileClient = { async getOwnProfile() { return current }, async getAccount() { return {} },
    async updateOwnProfile() { throw new Error('no writes') }, async searchParameters(_id, type) {
      assert.notEqual(type, 'SKILL'); return []
    } }
  const account = { accountId: 'mock', providerId: 'mock', platformAccountId: 1, clientName: 'Mock', profileUrl: '' }
  const build = (disabled: string[], profile = current) => buildProfilePlan(client, account, input, profile, [], undefined, {}, disabled)
  assert.deepEqual((await build([])).disabledFields, [], 'default: all fields enabled')
  const disabled = ['profile.headline', 'profile.experience[0].data.company', 'profile.education[0].data.degree',
    'profile.education[0].data.end_date']
  const plan = await build(disabled)
  assert.equal(plan.input?.headline, 'New headline', 'excluded values stay in source document')
  assert.equal(plan.input?.education[0].data.endDate?.year, 2021)
  assert(!plan.steps.some(step => step.section === 'headline'))
  const exp = plan.steps.find(step => step.id === 'experience-1')!
  assert.equal(exp.verification.kind, 'experience')
  const payload = prepareExperience(current, exp).step.payload as any
  assert(!Object.hasOwn(payload.specifics.linkedin.experience, 'company'), 'preflight cannot reintroduce unchecked field')
  const edu = plan.steps.find(step => step.id === 'education-1')!
  assert.equal((edu.verification as any).id, 'msc', 'matching uses full identity before filtering fields')
  const education = (prepareEducation(current, edu).step.payload as any).specifics.linkedin.education
  assert(!Object.hasOwn(education, 'degree')); assert(!Object.hasOwn(education, 'end_date'))
  assert(!plan.issues.some(issue => issue.level === 'fatal'))
  assert((await build([])).issues.some(issue => issue.path.endsWith('end_date')), 'reenable restores date validation')
  const noSkills = await build([...disabled, 'profile.skills.add'])
  assert(!noSkills.steps.some(step => step.section === 'skills'))
  assert.equal((noSkills.steps.find(step => step.id === 'experience-1')!.verification as any).expected.skills.length, 0)
  assert(noSkills.issues.some(issue => issue.path === 'profile.skills.omitted'))
  const noEntrySkills = await build([...disabled, 'profile.experience[0].data.skills'])
  assert.equal((noEntrySkills.steps.find(step => step.id === 'experience-1')!.verification as any).expected.skills.length, 0)
  const noEntry = await build([...disabled, ...editableFields.experience.map(key => `profile.experience[0].data.${key}`)])
  assert(!noEntry.steps.some(step => step.section === 'experience'))
  assert(!noEntry.entryPolicy?.experience, 'excluded sections do not block preflight of selected sections')
  const three = { ...input, experience: Array.from({ length: 3 }, () => structuredClone(input.experience[0])) }
  assert.equal(selectedEntriesInput(three, editableFields.experience.map(key => `profile.experience[0].data.${key}`),
    ['profile.experience[1]']).experience[0], three.experience[2], 'exclusions retain original entry indexes')
  const create = await build(disabled, { ...current, specifics: { ...current.specifics, experience: [] } })
  assert(!create.steps.some(step => step.section === 'experience'))
  assert(create.issues.some(issue => issue.path === 'profile.experience[0].data.company' && issue.level === 'fatal'))
  input.openToWork = { jobTitles: [{ id: 'dev', name: 'Engineer' }], locations: [{ name: 'London' }],
    workplaceTypes: ['REMOTE'], employmentTypes: ['FULL_TIME'], visibility: 'ALL' }
  const blocked = await build(['profile.open_to_work.locations'])
  assert(blocked.issues.some(issue => issue.path === 'profile.open_to_work' && issue.level === 'fatal'))
  const off = await build(editableFields.open_to_work.map(key => `profile.open_to_work.${key}`))
  assert(!off.steps.some(step => step.section === 'open_to_work'))
  assert(!off.issues.some(issue => issue.path === 'profile.open_to_work'))
}
