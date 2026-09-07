export function desktopProfileJob() {
  const experience = ['Aiven', 'Acme Bank', 'Example Systems'].map((company, index) => ({
    data: { company, job_title: 'Platform Engineer', start_date: `${2020 + index}-04`,
      end_date: index === 2 ? 'present' : `${2021 + index}-04`, location: 'Berlin',
      workplace_type: 'HYBRID', description: 'Built reliable delivery pipelines and observability tools.', skills: ['Go', 'Linux'] }
  }))
  const education = ['Bachelor', 'Master'].map((degree, index) => ({ data: {
    school: 'Example University', degree, field_of_study: 'Computer Science',
    start_date: `${2015 + index * 4}`, end_date: `${2019 + index * 2}` }
  }))
  const steps = [
    { id: 'headline', section: 'headline', action: 'update', before: 'Engineer', after: 'Platform Engineer | Go | Linux' },
    ...experience.map((entry, index) => ({ id: `experience-${index}`, section: 'experience',
      action: index === 2 ? 'create' : 'update', before: index === 2 ? null : { ...entry.data, description: 'Previous description.' }, after: entry.data })),
    ...education.map((entry, index) => ({ id: `education-${index}`, section: 'education', action: 'update',
      before: entry.data, after: entry.data })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `skills-${index}`, section: 'skills', action: 'add',
      before: { count: 42 + index * 10 }, after: { count: Math.min(100, 52 + index * 10),
        added: Array.from({ length: index === 5 ? 8 : 10 }, (_, n) => `Skill ${index * 10 + n}`) } })),
    { id: 'skills-final-check', section: 'skills', action: 'add', before: { count: 42 }, after: { count: 100 } }
  ]
  return { jobId: 'desktop-ui', platformAccountId: 203, clientName: 'Connected Client',
    status: 'preview_ready', phase: 'preview_ready', planHash: 'desktop-approved-plan',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    preview: { generation: { model: 'mock', cvRevision: 'fixture' },
      identity: { displayName: 'Connected Client', profileUrl: 'https://www.linkedin.com/in/mock/' },
      issues: [] as Array<{ level: string; path: string; message: string; suggestions?: string[] }>,
      document: { profile: { experience, education, skills: { add: [], target_count: 100 } } }, steps },
    result: undefined as undefined | { status: string; startedAt: string; steps: Array<{
      stepId: string; section: string; status: string; nextActionAt?: string; message: string }> }
  }
}
export const profileJobsRoute = '**/api/admin/linkedin/profile-jobs'
