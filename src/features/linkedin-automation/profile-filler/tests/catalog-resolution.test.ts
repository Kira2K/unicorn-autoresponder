import assert from 'node:assert/strict'
import { buildProfilePlan } from '../planner.ts'
import type { ProfileInput } from '../input-types.ts'

const skills = Array.from({ length: 100 }, (_, index) => `Candidate ${index + 1}`)
const desired: ProfileInput = {
  schemaVersion: 1,
  skills: { add: skills, targetCount: 100 },
  experience: [{
    match: { company: 'Acme', jobTitle: 'Engineer', startDate: { year: 2023, month: 1 } },
    data: { company: 'Acme', jobTitle: 'Engineer', location: 'London',
      startDate: { year: 2023, month: 1 }, skills: skills.slice(0, 5) }
  }],
  education: [{
    match: { school: 'University', startDate: { year: 2019, month: 9 } },
    data: { school: 'University', startDate: { year: 2019, month: 9 },
      skills: skills.slice(5, 10) }
  }]
}
const account = { platformAccountId: 1, clientName: 'Student', accountId: 'acc-1',
  providerId: 'provider-1', profileUrl: 'https://www.linkedin.com/in/student/' }
const current = { name: 'Student', profile_url: account.profileUrl, specifics: {
  skills: Array.from({ length: 42 }, (_, index) => ({ name: `Existing ${index + 1}` })),
  experience: [], education: []
} }

async function run() {
  const searches: string[] = []
  const client = { async searchParameters(_accountId: string, type: string, value: string) {
    searches.push(`${type}:${value}`)
    return [{ id: `${type.toLowerCase()}-${value.toLowerCase()}`, name: value }]
  } }
  const persisted = {}
  const plan = await buildProfilePlan(client as any, account, desired, current, [], undefined,
    persisted)
  const skillSteps = plan.steps.filter(step => step.section === 'skills' && !step.readOnly)
  const plannedSkills = skillSteps.flatMap(step => (step.verification as any).expected)
  assert.equal(skillSteps.length, 6)
  assert.equal(plannedSkills.length, 58)
  assert(skills.slice(0, 10).every(value => plannedSkills.includes(value)))
  assert.equal(searches.some(value => value.startsWith('SKILL:')), false)
  assert.deepEqual(searches, [
    'COMPANY:Acme', 'JOB_TITLE:Engineer', 'LOCATION:London', 'SCHOOL:University'
  ])
  const first = ((skillSteps[0].payload.specifics as any).linkedin.skills[0])
  assert.deepEqual(first, { name: 'Candidate 1' })
  assert.equal(plan.issues.some(issue => issue.level === 'fatal'), false)

  await buildProfilePlan(client as any, account, desired, current, [], undefined, persisted)
  assert.equal(searches.length, 4, 'resolved entity lookups must survive a new plan attempt')

  const fallback = await buildProfilePlan({ async searchParameters() { return [] } } as any,
    account, desired, current, [])
  assert.equal(fallback.issues.some(issue => issue.level === 'fatal'), false)
  const experience = fallback.steps.find(step => step.section === 'experience')!
  const payload = (experience.payload.specifics as any).linkedin.experience
  assert.deepEqual(payload.company, { name: 'Acme' })
  assert.deepEqual(payload.job_title, { name: 'Engineer' })
  assert.deepEqual(payload.location, { name: 'London' })
}

run().then(() => console.log('profile catalog resolution tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
