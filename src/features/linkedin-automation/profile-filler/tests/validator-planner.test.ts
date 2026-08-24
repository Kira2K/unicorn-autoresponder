const assert = require('node:assert/strict')
const { analyzeProfileFile, validateProfileFile } = require('../validator.ts') as any
const { buildProfilePlan } = require('../planner.ts') as any
async function run() {
  const input = { schema_version: 1, profile: {
    headline: 'QA Engineer', about: 'About QA', skills: { add: ['Playwright'], target_count: 100 },
    experience: [{ action: 'upsert', data: { company: 'Acme', job_title: 'QA',
      start_date: '2024-01', source_of_hire: 'linkedin',
      skills: Array.from({ length: 6 }, (_, index) => `Testing ${index}`) } }],
    education: [{ action: 'upsert', data: { school: 'University', start_date: '2020-09',
      skills: Array.from({ length: 6 }, (_, index) => `Education ${index}`) } }],
    open_to_work: { job_titles: [{ name: 'QA', id: 'title-1' }], workplace_types: ['REMOTE'],
      locations: [{ name: 'Europe', id: 'loc-1' }], employment_types: ['FULL_TIME'],
      visibility: 'RECRUITERS_ONLY' }
  } }
  const validation = validateProfileFile(input)
  assert.ok(validation.value)
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
  const incomplete = analyzeProfileFile({ experience: [{ title: 'Developer' }] })
  assert.equal(incomplete.valid, false)
  assert.ok(incomplete.issues.some((issue: any) => issue.level === 'fatal' && issue.suggestion))
  const current = { display_name: 'Student', profile_url: 'https://www.linkedin.com/in/student/',
    description: 'Old', bio: '', specifics: { experience: [], education: [], skills: [] } }
  const client = { async searchParameters(_accountId: string, type: string, value: string) {
    return [{ id: `${type.toLowerCase()}-1`, name: value }]
  } }
  const account = { platformAccountId: 1, clientName: 'Student', accountId: 'acc_1',
    providerId: 'provider-1', profileUrl: current.profile_url }
  const plan = await buildProfilePlan(client, account, validation.value, current, validation.issues)
  assert.deepEqual(plan.steps.map((step: any) => step.section),
    ['headline', 'about', 'skills', 'experience', 'education', 'open_to_work'])
  const experience = plan.steps.find((step: any) => step.section === 'experience').payload
    .specifics.linkedin.experience
  assert.equal(experience.job_title.name, 'QA')
  assert.equal(experience.job_title.id, undefined)
  assert.equal(experience.company.name, 'Acme')
  assert.equal(experience.company.id, undefined)
  assert.equal(experience.skills.length, 6)
  assert.equal(experience.skills[0].name, 'Testing 0')
  assert.equal(experience.skills[0].id, undefined)
  assert.equal(experience.source_of_hire, 'LINKEDIN')
  const education = plan.steps.find((step: any) => step.section === 'education').payload
    .specifics.linkedin.education
  assert.equal(education.skills.length, 6)
  assert.equal(education.skills[0].id, undefined)
  assert.equal(JSON.stringify(plan).includes('access_token'), false)
  const invalid = validateProfileFile({ profile: { experience: [{ data: { company: 'Acme' } }] } })
  assert.equal(invalid.value.experience.length, 0)
  assert.ok(invalid.issues.length)
  const invalidSource = validateProfileFile({ profile: { experience: [{ data: {
    company: 'Acme', job_title: 'QA', start_date: '2024-01', source_of_hire: 'unknown' } }] } })
  assert.equal(invalidSource.value.experience[0].data.sourceOfHire, undefined)
  assert.ok(invalidSource.issues.some((issue: any) => issue.path.endsWith('source_of_hire')))
  const noDates = validateProfileFile({ schema_version: 1, profile: {
    experience: [{ data: { company: 'No Date Co', job_title: 'Engineer' } }],
    education: [{ data: { school: 'No Date School' } }]
  } })
  assert.deepEqual([noDates.value.experience.length, noDates.value.education.length], [1, 1])
  const noDatePlan = await buildProfilePlan(client, account, noDates.value, current, noDates.issues)
  assert.deepEqual(noDatePlan.steps, [])
  assert.ok(noDatePlan.issues.some((issue: any) =>
    issue.path === 'profile.experience[0].data.start_date'))
  assert.ok(noDatePlan.issues.some((issue: any) =>
    issue.path === 'profile.education[0].data.start_date'))
  const fullSkills = { ...current, specifics: { experience: [], education: [],
    skills: Array.from({ length: 100 }, (_, index) => ({ name: `Existing ${index}` })) } }
  const skillsInput = validateProfileFile({ profile: {
    skills: { add: ['Missing skill'], target_count: 100 }
  } })
  const skillsPlan = await buildProfilePlan(client, account, skillsInput.value, fullSkills, skillsInput.issues)
  assert.equal(skillsPlan.steps.length, 0)
  assert.ok(skillsPlan.issues.some((issue: any) => issue.path === 'profile.skills.add'))
  const ambiguous = { ...current, specifics: { skills: [],
    experience: [{ id: 'exp-1', company: 'Acme', job_title: 'QA' },
      { id: 'exp-2', company: 'Acme', job_title: 'QA' }],
    education: [{ id: 'edu-1', school: 'University' }, { id: 'edu-2', school: 'University' }] } }
  const ambiguousInput = validateProfileFile({ profile: {
    experience: [{ data: { company: 'Acme', job_title: 'QA' } }],
    education: [{ data: { school: 'University' } }]
  } })
  const ambiguousPlan = await buildProfilePlan(
    client, account, ambiguousInput.value, ambiguous, ambiguousInput.issues)
  assert.equal(ambiguousPlan.steps.length, 0)
  assert.equal(ambiguousPlan.issues.filter((issue: any) =>
    issue.message.includes('несколько')).length, 2)
}

run().then(() => console.log('profile validator/planner tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
