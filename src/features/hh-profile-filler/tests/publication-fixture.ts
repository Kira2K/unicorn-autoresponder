import type { ResumeSnapshot } from '../hh-resume-ui.ts'
import type { PublicationSnapshot } from '../hh-activation.ts'

// Publication port for service tests; real UI/state behavior has its own DOM contract tests.
export function mockPublication() {
  const active = async (_page: unknown, resume: ResumeSnapshot): Promise<PublicationSnapshot> => ({
    ...resume, isDraft: false, isActive: true, searchable: true, publicationStatus: 'new', resumeLanguage: 'EN'
  })
  return { read: active, activate: active, verify: active }
}

export function mockSkills() {
  const complete = async (_page: unknown, _resume: ResumeSnapshot, expected: string[]) =>
    expected.map(name => ({ name, level: 'advanced' }))
  return { ensure: complete, verify: complete }
}

export function mockResumeLanguage() {
  const english = async () => 'EN' as const
  return { ensure: english, verify: english }
}

export function mockJobSearchStatus() {
  const active = async () => 'active_search' as const
  return { ensure: active, verify: active }
}
