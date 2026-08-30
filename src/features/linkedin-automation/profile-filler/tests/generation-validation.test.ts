import assert from 'node:assert/strict'
import { factIssues } from '../generation/fact-check.ts'
import { guideIssues } from '../generation/guide-validation.ts'
import { validateGeneratedProfile } from '../generation/validate-generated.ts'
import type { CvFacts } from '../generation/types.ts'

const facts: CvFacts = { target_roles: ['Backend Engineer'], years_experience: 8,
  contact_email: null, contact_phone: null, industries: [], skills: [],
  experience: [], education: [] }

function document() {
  return { schema_version: 1, profile: {
    headline: 'Backend Engineer | Go, PostgreSQL, AWS',
    about: 'Backend engineer building reliable services.\n\nI improve delivery with measurable results.\n\nMy stack includes Go, PostgreSQL and AWS.\n\nOpen to relevant engineering roles.',
    skills: { add: Array.from({ length: 100 }, (_, index) => `Skill ${index + 1}`),
      target_count: 100 },
    experience: [], education: [], open_to_work: {
      job_titles: ['Backend Engineer', 'Go Engineer', 'Software Engineer',
        'Platform Engineer', 'API Engineer'].map(name => ({ name })),
      workplace_types: ['REMOTE', 'HYBRID', 'ON_SITE'], locations: [{ name: 'Poland' }],
      start_date: 'IMMEDIATELY', employment_types: ['FULL_TIME', 'CONTRACT', 'PART_TIME'],
      visibility: 'ALL'
    }
  } }
}

const valid = validateGeneratedProfile(document(), facts, 'Poland')
assert.equal(valid.value.skills.add.length, 100)
const duplicate = document()
duplicate.profile.skills.add[99] = duplicate.profile.skills.add[0]
assert(guideIssues(duplicate, 'Poland').some(issue => issue.path === 'profile.skills'))
const editable = validateGeneratedProfile(duplicate, facts, 'Poland')
assert(editable.issues.some(issue => issue.level === 'fatal' && issue.path === 'profile.skills'))
const cyrillic = document(); cyrillic.profile.headline = 'Разработчик'
assert(guideIssues(cyrillic, 'Poland').some(issue => issue.path === 'profile.headline'))
assert.throws(() => validateGeneratedProfile(null, facts, 'Poland'),
  (error: any) => error.code === 'profile_generation_validation_failed')

const experienceFacts: CvFacts = { ...facts, experience: [{ company: 'Acme',
  job_title: 'Engineer', start_date: '2022-01', end_date: null, location: null,
  workplace_type: null, achievements: ['Reduced latency by 20%'], responsibilities: [],
  technologies: ['Go'], evidence: 'Acme Engineer' }] }
const changed: any = document()
changed.profile.experience = [{ data: { company: 'Other', job_title: 'Engineer',
  start_date: '2022-01', description: 'Reduced latency by 30%' } }]
const issues = factIssues(changed, experienceFacts)
assert(issues.some(issue => issue.path.endsWith('.company')))
assert(issues.some(issue => issue.path.endsWith('.description')))
assert(issues.some(issue => issue.message.includes('"30%"')))
const formatted: any = document()
formatted.profile.experience = [{ data: { company: 'Acme', job_title: 'Engineer',
  start_date: '2022-01', description: 'Handled 6,000 requests.' } }]
const formattedFacts: CvFacts = { ...experienceFacts, experience: [{ ...experienceFacts.experience[0],
  achievements: ['Handled 6000 requests'] }] }
assert.equal(factIssues(formatted, formattedFacts).some(issue => issue.path.endsWith('.description')), false)
const wrongPositionFacts: CvFacts = { ...formattedFacts, experience: [
  { ...formattedFacts.experience[0], achievements: [] },
  { ...formattedFacts.experience[0], company: 'Second', achievements: ['Handled 6000 requests'] }
] }
assert(factIssues(formatted, wrongPositionFacts).some(issue => issue.path.endsWith('.description')))
const detached: any = document()
detached.profile.experience = [{ data: { company: 'Acme', job_title: 'Engineer',
  start_date: { year: 2024, month: 1 }, description: 'Valid description',
  skills: ['Missing 1', 'Missing 2', 'Missing 3', 'Missing 4', 'Missing 5'] } }]
assert(guideIssues(detached, 'Poland').some(issue =>
  issue.message.includes('profile.skills.add')))
console.log('profile generation validation tests passed')
