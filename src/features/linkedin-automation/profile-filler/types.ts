import type { ConnectedAccount } from '../core/account/connected-account'
import type { StepResult as CoreStepResult } from '../core/reporting/step-result'

export type ValidationIssue = {
  level: 'warning' | 'fatal'
  path: string
  message: string
  resolution?: string
}

export type ValidationResult<T> = {
  value?: T
  issues: ValidationIssue[]
}

export type LinkedInSessionInput = {
  schemaVersion: 1
  capturedAt?: string
  accessToken: string
  userAgent: string
  accountId?: string
}

export type YearMonth = {
  year: number
  month: number
}

export type NamedParameter = {
  name: string
  id?: string
}

export type ExperienceData = {
  company: string
  jobTitle: string
  employmentType?: string
  location?: string
  workplaceType?: 'ON_SITE' | 'HYBRID' | 'REMOTE'
  startDate: YearMonth
  endDate?: YearMonth
  description?: string
  sourceOfHire?: string
  skills: string[]
}

export type ExperienceUpsert = {
  match: {
    company: string
    jobTitle: string
    startDate?: YearMonth
  }
  data: ExperienceData
}

export type EducationData = {
  school: string
  degree?: string
  fieldOfStudy?: string
  startDate: YearMonth
  endDate?: YearMonth
  grade?: string
  activities?: string
  description?: string
  skills: string[]
}

export type EducationUpsert = {
  match: {
    school: string
    startDate?: YearMonth
  }
  data: EducationData
}

export type OpenToWorkInput = {
  jobTitles: NamedParameter[]
  workplaceTypes: Array<'ON_SITE' | 'HYBRID' | 'REMOTE'>
  locations: NamedParameter[]
  startDate?: 'IMMEDIATELY' | 'FLEXIBLE'
  employmentTypes: Array<'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY'>
  visibility: 'ALL' | 'RECRUITERS_ONLY'
}

export type ProfileInput = {
  schemaVersion: 1
  headline?: string
  about?: string
  skills: {
    add: string[]
    targetCount: number
  }
  experience: ExperienceUpsert[]
  education: EducationUpsert[]
  openToWork?: OpenToWorkInput
}

export type PlanSection =
  | 'headline'
  | 'about'
  | 'experience'
  | 'education'
  | 'skills'
  | 'open_to_work'

export type VerificationSpec =
  | { kind: 'headline'; expected: string }
  | { kind: 'about'; expected: string }
  | { kind: 'skills'; expected: string[] }
  | { kind: 'experience'; id?: string; expected: ExperienceData }
  | { kind: 'education'; id?: string; expected: EducationData }
  | { kind: 'open_to_work' }

export type PlanStep = {
  id: string
  section: PlanSection
  action: 'update' | 'create' | 'add'
  summary: string
  before: unknown
  after: unknown
  payload: Record<string, unknown>
  verification: VerificationSpec
}

export type PreviewStep = Pick<
  PlanStep,
  'id' | 'section' | 'action' | 'summary' | 'before' | 'after'
>

export type ProfileIdentity = {
  displayName: string
  profileUrl?: string
  headline?: string
}

export type ProfilePlan = {
  account: ConnectedAccount
  identity: ProfileIdentity
  steps: PlanStep[]
  issues: ValidationIssue[]
}

export type ProfilePreview = {
  planId: string
  planHash: string
  expiresAt: string
  account: ConnectedAccount
  identity: ProfileIdentity
  steps: PreviewStep[]
  issues: ValidationIssue[]
}

export type StepResult = CoreStepResult<PlanSection>

export type FillResult = {
  accountId: string
  identity: ProfileIdentity
  startedAt: string
  finishedAt: string
  status: 'verified' | 'failed' | 'no_changes'
  steps: StepResult[]
}
