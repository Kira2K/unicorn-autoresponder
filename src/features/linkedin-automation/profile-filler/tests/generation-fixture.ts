import type { CvFacts } from '../generation/types.ts'

export const emptyFacts: CvFacts = { target_roles: ['Backend Engineer'], years_experience: 8,
  contact_email: null, contact_phone: null, industries: [], skills: [],
  experience: [], education: [] }

export function generatedDocument() {
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
