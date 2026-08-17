const assert = require('node:assert/strict')
const test = require('node:test')
const { validateProfileFile } = require('../validator.ts') as typeof import('../validator.ts')
const { buildProfilePlan } = require('../planner.ts') as typeof import('../planner.ts')

const account = {
  provider: 'linkedin' as const,
  accountId: 'account-1',
  displayName: 'Test Student',
  profileUrl: 'https://www.linkedin.com/in/test-student',
  verifiedAt: '2026-08-17T00:00:00.000Z',
}

function currentProfile(): Record<string, unknown> {
  return {
    display_name: 'Test Student',
    profile_url: 'https://www.linkedin.com/in/test-student',
    description: 'Old headline',
    bio: 'Old about',
    specifics: {
      experience: [{
        id: 'exp-1',
        company: { name: 'Existing Co' },
        job_title: { name: 'QA Engineer' },
        start_date: '2023-01',
        description: 'Old',
        skills: [],
      }],
      education: [{
        id: 'edu-1',
        school: { name: 'Existing School' },
        start_date: '2018-09',
        description: 'Old',
        skills: [],
      }],
      skills: [{ name: 'Manual Testing' }],
    },
  }
}

test('validator accepts documented YearMonth objects and warns instead of rejecting optional fields', () => {
  const validation = validateProfileFile({
    profile: {
      unsupported: 'ignored',
      skills: { add: ['Python', 'python'], target_count: 200 },
      experience: [{
        action: 'upsert',
        data: {
          company: 'Example',
          job_title: 'QA',
          start_date: { year: 2024, month: 2 },
          skills: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'],
        },
      }],
    },
  })
  assert.ok(validation.value)
  assert.deepEqual(validation.value.experience[0].data.startDate, { year: 2024, month: 2 })
  assert.equal(validation.value.skills.targetCount, 100)
  assert.deepEqual(validation.value.skills.add, ['Python'])
  assert.equal(validation.value.experience[0].data.skills.length, 5)
  assert.equal(validation.issues.some(issue => issue.level === 'fatal'), false)
  assert.equal(validation.issues.length >= 3, true)
})

test('planner builds the documented deterministic queue order and skill batches', async () => {
  const validation = validateProfileFile({
    profile: {
      headline: 'New headline',
      about: 'New about',
      skills: {
        add: Array.from({ length: 12 }, (_, index) => `Skill ${index + 1}`),
        target_count: 95,
      },
      experience: [
        {
          action: 'upsert',
          match: { company: 'New Co', job_title: 'Automation QA', start_date: { year: 2025, month: 1 } },
          data: { company: 'New Co', job_title: 'Automation QA', start_date: { year: 2025, month: 1 }, skills: [] },
        },
        {
          action: 'upsert',
          match: { company: 'Existing Co', job_title: 'QA Engineer', start_date: { year: 2023, month: 1 } },
          data: { company: 'Existing Co', job_title: 'QA Engineer', start_date: { year: 2023, month: 1 }, description: 'Updated', skills: [] },
        },
      ],
      education: [
        {
          action: 'upsert',
          match: { school: 'New School', start_date: { year: 2024, month: 9 } },
          data: { school: 'New School', start_date: { year: 2024, month: 9 }, skills: [] },
        },
        {
          action: 'upsert',
          match: { school: 'Existing School', start_date: { year: 2018, month: 9 } },
          data: { school: 'Existing School', start_date: { year: 2018, month: 9 }, description: 'Updated', skills: [] },
        },
      ],
      open_to_work: {
        job_titles: [{ name: 'QA Engineer', id: 'title-1' }],
        workplace_types: ['REMOTE'],
        locations: [{ name: 'Europe', id: 'location-1' }],
        employment_types: ['FULL_TIME'],
        visibility: 'RECRUITERS_ONLY',
      },
    },
  })
  assert.ok(validation.value)
  const plan = await buildProfilePlan(account, validation.value, currentProfile(), validation.issues, {
    skillBatchSize: 10,
    resolveParameter: async (_type: string, value: { id?: string; name: string }) =>
      value.id ? { id: value.id, name: value.name } : undefined,
  })
  assert.deepEqual(
    plan.steps.map(step => `${step.section}:${step.action}`),
    [
      'headline:update',
      'about:update',
      'experience:update',
      'education:update',
      'skills:add',
      'skills:add',
      'experience:create',
      'education:create',
      'open_to_work:update',
    ],
  )
  assert.deepEqual(plan.steps.filter(step => step.section === 'skills').map(step => step.verification.kind === 'skills' ? step.verification.expected.length : 0), [10, 2])
})
