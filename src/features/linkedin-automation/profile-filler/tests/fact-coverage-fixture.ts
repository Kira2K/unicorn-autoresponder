import { assignFactIds } from '../generation/fact-ids.ts'
import type { CvFacts } from '../generation/types.ts'

export const skillNames = Array.from({ length: 100 }, (_, index) => `Skill ${index + 1}`)
export const facts = assignFactIds({
  target_roles: ['Backend Engineer'], years_experience: 6, contact_email: null,
  contact_phone: null, industries: ['Software'], skills: ['Go'],
  experience: Array.from({ length: 3 }, (_, index) => ({
    company: `Company ${index + 1}`, job_title: `Engineer ${index + 1}`,
    start_date: `202${index}-01`, end_date: index === 0 ? null : `202${index}-12`,
    location: index === 0 ? 'London' : null,
    workplace_type: index === 0 ? 'REMOTE' as const : null,
    achievements: [`Delivered result ${index + 1}`], responsibilities: ['Built systems'],
    technologies: ['Go'], evidence: `CV experience ${index + 1}`
  })),
  education: [{ school: 'University', degree: 'MSc', field_of_study: 'Computer Science',
    start_date: '2018-09', end_date: '2020-06', grade: 'A', activities: 'Engineering Club',
    evidence: 'CV education', is_higher_education: true }]
} satisfies CvFacts)

export function raw(ids = ['exp_1', 'exp_2', 'exp_3']) {
  return { schema_version: 1, profile: {
    headline: 'Backend Engineer | Go, PostgreSQL, AWS',
    about_blocks: ['Backend engineer building reliable services.',
      'I deliver measurable engineering outcomes.', 'My approach favors maintainable systems.',
      'Open to relevant engineering roles.'],
    skills: { add: skillNames, target_count: 100 },
    experience: ids.map(id => ({ fact_id: id, description: `Description for ${id}.`,
      skills: skillNames.slice(0, 5) })),
    education: [{ fact_id: 'edu_1', description: 'Advanced engineering studies.',
      skills: skillNames.slice(0, 5) }],
    open_to_work: {
      job_titles: ['Backend Engineer', 'Go Engineer', 'Software Engineer',
        'Platform Engineer', 'API Engineer'].map(name => ({ name })),
      workplace_types: ['REMOTE', 'HYBRID', 'ON_SITE'], locations: [{ name: 'Poland' }],
      start_date: 'IMMEDIATELY', employment_types: ['FULL_TIME', 'CONTRACT', 'PART_TIME'],
      visibility: 'ALL'
    }
  } }
}
