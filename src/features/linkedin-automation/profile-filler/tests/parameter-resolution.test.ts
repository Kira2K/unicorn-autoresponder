const assert = require('node:assert/strict')
const { resolvePlanParameters } = require('../parameter-resolution.ts') as any

const step = (section: string, id: string, value: any) => ({
  id, section, action: 'create', summary: id, before: null, after: {},
  payload: { specifics: { linkedin: { [section]: value } } },
  verification: section === 'skills' ? { kind: 'skills', expected: ['Unknown skill'] } :
    { kind: section, expected: { skills: ['Unknown skill'] } }
})

async function run() {
  const searches: string[] = []
  const client = { async searchParameters(_id: string, type: string, value: string) {
    searches.push(`${type}:${value}`)
    return value === 'INTERNSHIP' ? [{ id: 'employment-internship', name: 'Internship' }] : []
  } }
  const experience = step('experience', 'experience-1', {
    operation: 'create', job_title: { name: 'Unknown title' }, company: { name: 'Acme' },
    employment_type: 'INTERNSHIP', skills: [{ name: 'Unknown skill' }]
  })
  experience.after = { employment_type: 'INTERNSHIP' }
  ;(experience.verification.expected as any).employmentType = 'INTERNSHIP'
  const profileSkills = step('skills', 'skills-1', [{ name: 'Unknown skill' }])
  const issues: any[] = []
  const resolved = await resolvePlanParameters(
    client, 'acc-1', [experience, profileSkills], issues)

  assert.deepEqual(searches, ['EMPLOYMENT_TYPE:INTERNSHIP'])
  assert.equal(resolved.length, 2)
  assert.equal(resolved[0].payload.specifics.linkedin.experience.employment_type,
    'employment-internship')
  assert.deepEqual(resolved[0].payload.specifics.linkedin.experience.skills,
    [{ name: 'Unknown skill' }])
  assert.deepEqual(resolved[1].payload.specifics.linkedin.skills,
    [{ name: 'Unknown skill' }])
  assert.deepEqual(issues, [])

  const unknown = step('experience', 'experience-2', {
    operation: 'create', company: { name: 'Acme' }, job_title: { name: 'QA' },
    employment_type: 'UNKNOWN'
  })
  unknown.after = { employment_type: 'UNKNOWN' }
  ;(unknown.verification.expected as any).employmentType = 'UNKNOWN'
  const unknownIssues: any[] = []
  await resolvePlanParameters(client, 'acc-1', [unknown], unknownIssues)
  assert.equal(Object.hasOwn(unknown.payload.specifics.linkedin.experience, 'employment_type'), false)
  assert.equal(Object.hasOwn(unknown.verification.expected, 'employmentType'), false)
  assert.equal(unknownIssues[0].path, 'profile.experience[1].data.employment_type')
}

run().then(() => console.log('profile parameter resolution tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
