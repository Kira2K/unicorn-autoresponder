const assert = require('node:assert/strict')
const { prepareStep } = require('../prepare-step.ts') as any
const { experiencePayload, linkedInPayload } = require('../payloads.ts') as any

const logger = { event() {} }
const expected = { company: 'Acme', jobTitle: 'Engineer', startDate: { year: 2024, month: 9 },
  description: 'New', skills: [] }
const experience = {
  id: 'experience-1', section: 'experience', action: 'create', before: null, after: {},
  summary: 'Experience', payload: experiencePayload(expected),
  verification: { kind: 'experience', expected }
}
const existing = { id: 'exp-1', company: { name: 'Acme' }, job_title: 'Engineer',
  started_on: '09/01/2024', description: 'Old', skills: [] }

async function prepare(profile: any, step: any = experience) {
  return prepareStep({ async getOwnProfile() { return profile } }, 'acc-1', step, logger)
}

async function run() {
  const created = await prepare({ specifics: { experience: [] } })
  assert.equal(created.mode, 'write')
  assert.equal(created.step.action, 'create')

  const edited = await prepare({ specifics: { experience: [existing] } })
  assert.equal(edited.mode, 'write')
  assert.equal(edited.step.action, 'update')
  assert.equal(edited.step.payload.specifics.linkedin.experience.operation, 'edit')
  assert.equal(edited.step.payload.specifics.linkedin.experience.id, 'exp-1')

  const same = await prepare({ specifics: { experience: [{ ...existing, description: 'New' }] } })
  assert.equal(same.mode, 'skip')

  await assert.rejects(() => prepare({ specifics: { experience: [existing, { ...existing,
    id: 'exp-2' }] } }), { code: 'profile_entry_ambiguous' })

  const skillStep = { id: 'skills-1', section: 'skills', action: 'add', before: {}, after: {},
    summary: 'Skills', payload: linkedInPayload('skills', [{ name: 'Go' }, { name: 'SQL' }]),
    verification: { kind: 'skills', expected: ['Go', 'SQL'] } }
  const skills = await prepare({ specifics: { skills: [{ name: 'Go' }] } }, skillStep)
  assert.equal(skills.mode, 'write')
  assert.deepEqual(skills.step.payload.specifics.linkedin.skills, [{ name: 'SQL' }])

  const headline = { id: 'headline', section: 'headline', action: 'update', before: 'Old',
    after: 'New', summary: 'Headline', payload: linkedInPayload('headline', 'New'),
    verification: { kind: 'headline', expected: 'New' } }
  assert.equal((await prepare({ description: 'New' }, headline)).mode, 'skip')

  const educationExpected = { school: 'University', startDate: { year: 2020, month: 9 },
    degree: 'Master', skills: [] }
  const education = { id: 'education-1', section: 'education', action: 'create', before: null,
    after: {}, summary: 'Education', payload: {},
    verification: { kind: 'education', expected: educationExpected } }
  const preparedEducation = await prepare({ specifics: { education: [{ id: 'edu-1',
    school: { name: 'University' }, started_on: '09/01/2020', degree: 'Bachelor', skills: []
  }] } }, education)
  assert.equal(preparedEducation.step.action, 'update')
  assert.equal(preparedEducation.step.payload.specifics.linkedin.education.operation, 'edit')
  assert.equal(preparedEducation.step.payload.specifics.linkedin.education.id, 'edu-1')
}

run().then(() => console.log('profile pre-write preparation tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
