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
  const incomplete = analyzeProfileFile({ experience: [{ title: 'Developer' }] })
  assert.equal(incomplete.valid, false)
  assert.ok(incomplete.issues.some((issue: any) => issue.level === 'fatal' && issue.suggestion))
  const current = { display_name: 'Student', profile_url: 'https://www.linkedin.com/in/student/',
    description: 'Old', bio: '', specifics: { experience: [], education: [], skills: [] } }
  const searches: string[] = []
  const client = { async searchParameters(_accountId: string, type: string, value: string) {
    searches.push(`${type}:${value}`)
    return [{ id: `${type.toLowerCase()}-${value.toLowerCase().replace(/\s+/g, '-')}`, name: value }]
  } }
  const account = { platformAccountId: 1, clientName: 'Student', accountId: 'acc_1',
    providerId: 'provider-1', profileUrl: current.profile_url }
  const plan = await buildProfilePlan(client, account, validation.value, current, validation.issues)
  assert.deepEqual(plan.steps.map((step: any) => step.section),
    ['headline', 'about', 'experience', 'education', 'skills', 'skills', 'skills', 'open_to_work'])
  const experience = plan.steps.find((step: any) => step.section === 'experience').payload
    .specifics.linkedin.experience
  assert.equal(experience.job_title.name, 'QA')
  assert.equal(experience.job_title.id, 'job_title-qa')
  assert.equal(experience.company.name, 'Acme')
  assert.equal(experience.company.id, 'company-acme')
  assert.equal(Object.hasOwn(experience, 'employment_type'), false)
  assert.equal(experience.skills.length, 6)
  assert.equal(experience.skills[0].name, 'Testing 0')
  assert.equal(Object.hasOwn(experience.skills[0], 'id'), false)
  assert.equal(experience.source_of_hire, 'LINKEDIN')
  const education = plan.steps.find((step: any) => step.section === 'education').payload
    .specifics.linkedin.education
  assert.equal(education.skills.length, 6)
  assert.equal(Object.hasOwn(education.skills[0], 'id'), false)
  const openToWork = plan.steps.find((step: any) => step.section === 'open_to_work').payload
    .specifics.linkedin.open_to_work
  assert.equal(openToWork.job_title[0].id, 'job_title-qa')
  assert.deepEqual(openToWork.workplace[0].location, ['location-europe'])
  assert(searches.includes('COMPANY:Acme'))
  assert(searches.includes('SCHOOL:University'))
  assert.equal(searches.some((value: string) => value.startsWith('SKILL:')), false)
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
    issue.path === 'profile.education[0].data.start_date' && issue.level === 'fatal'))
  assert.equal(noDatePlan.issues.some((issue: any) => issue.level === 'fatal'), true)
  const existingEducation = { ...current, specifics: { experience: [], skills: [], education: [{
    id: 'existing-education', school: 'No Date School',
    started_on: { year: 2017, month: 9 }, ended_on: { year: 2021, month: 6 },
    description: 'Old description', skills: []
  }] } }
  const existingEducationInput = validateProfileFile({ schema_version: 1, profile: {
    education: [{ data: { school: 'No Date School', description: 'Updated description' } }]
  } })
  const existingEducationPlan = await buildProfilePlan(client, account,
    existingEducationInput.value, existingEducation, existingEducationInput.issues)
  const existingEducationStep = existingEducationPlan.steps.find((step: any) =>
    step.section === 'education')
  assert.equal(existingEducationStep.action, 'update')
  assert.equal(existingEducationStep.payload.specifics.linkedin.education.id, 'existing-education')
  assert.equal(Object.hasOwn(existingEducationStep.payload.specifics.linkedin.education,
    'start_date'), false)
  assert.equal(existingEducationPlan.issues.some((issue: any) => issue.level === 'fatal'), false)
  const unreadCurrent = { display_name: 'Student', profile_url: current.profile_url,
    specifics: { experience: [], education: [], skills: [] } }
  const unreadPlan = await buildProfilePlan(client, account, validation.value, unreadCurrent, [])
  assert.ok(unreadPlan.steps.some((step: any) => step.section === 'headline'))
  assert.ok(unreadPlan.steps.some((step: any) => step.section === 'about'))
  assert.ok(unreadPlan.issues.some((issue: any) => issue.message.includes('was not returned')))
  const fullSkills = { ...current, specifics: { experience: [], education: [],
    skills: Array.from({ length: 100 }, (_, index) => ({ name: `Existing ${index}` })) } }
  const skillsInput = validateProfileFile({ profile: {
    skills: { add: ['Missing skill'], target_count: 100 }
  } })
  const skillsPlan = await buildProfilePlan(client, account, skillsInput.value, fullSkills, skillsInput.issues)
  assert.equal(skillsPlan.steps.length, 1)
  assert.equal(skillsPlan.steps[0].readOnly, true)
  assert.equal(skillsPlan.issues.some((issue: any) => issue.level === 'fatal'), false)
  const cappedInput = validateProfileFile({ profile: { experience: [{ data: {
    company: 'Limit Co', job_title: 'Engineer', start_date: '2024-01', skills: ['New Skill']
  } }] } })
  const cappedPlan = await buildProfilePlan(client, account, cappedInput.value, fullSkills,
    cappedInput.issues)
  const cappedExperience = cappedPlan.steps[0].payload.specifics.linkedin.experience
  assert.equal(Object.hasOwn(cappedExperience, 'skills'), false)
  assert.ok(cappedPlan.issues.some((issue: any) =>
    issue.path === 'profile.skills.omitted'))
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
    issue.message.includes('Multiple existing')).length, 2)

  const sameSchool = { ...current, specifics: { experience: [], skills: [], education: [
    { id: 'edu-bachelor', school: 'University', degree: 'Bachelor',
      field_of_study: 'Computer Science', description: 'Old bachelor', skills: [] },
    { id: 'edu-master', school: 'University', degree: 'Master',
      field_of_study: 'Computer Science', description: 'Old master', skills: [] }
  ] } }
  const sameSchoolInput = validateProfileFile({ profile: { education: [
    { data: { school: 'University', degree: 'Bachelor', field_of_study: 'Computer Science',
      description: 'Updated bachelor' } },
    { data: { school: 'University', degree: 'Master', field_of_study: 'Computer Science',
      description: 'Updated master' } }
  ] } })
  const sameSchoolPlan = await buildProfilePlan(client, account, sameSchoolInput.value,
    sameSchool, sameSchoolInput.issues)
  const sameSchoolSteps = sameSchoolPlan.steps.filter((step: any) => step.section === 'education')
  assert.deepEqual(sameSchoolSteps.map((step: any) =>
    step.payload.specifics.linkedin.education.id), ['edu-bachelor', 'edu-master'])
  assert.equal(sameSchoolPlan.issues.some((issue: any) =>
    issue.message.includes('Multiple existing Education')), false)
}

run().then(() => console.log('profile validator/planner tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
