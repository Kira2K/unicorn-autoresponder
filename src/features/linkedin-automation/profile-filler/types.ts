import type { ConnectedAccount } from '../core/account/connected-account'
import type { StepResult as CoreStepResult } from '../core/reporting/step-result'

export type JsonObject = Record<string, unknown>

/** Auth-neutral facade. Production and fake adapters implement the same contract. */
export type ProfileClient = {
  getOwnProfile(accountId: string, sections?: string[]): Promise<JsonObject>
  updateOwnProfile(accountId: string, payload: JsonObject): Promise<unknown>
  searchLinkedInParameters?(
    accountId: string,
    type: 'JOB_TITLE' | 'LOCATION',
    keywords: string,
  ): Promise<Array<{ id: string; name: string }>>
}

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

export type SectionReadStatus =
  | 'not_requested'
  | 'complete'
  | 'empty'
  | 'throttled'
  | 'missing'

export type SectionReadState = {
  section: PlanSection
  requested: boolean
  status: SectionReadStatus
  itemCount?: number
}

export type ProfileSnapshotReference = {
  snapshotId: string
  snapshotHash: string
  capturedAt: string
  expiresAt: string
  sections: Record<PlanSection, SectionReadState>
}

export type ProfileReadSnapshot = ProfileSnapshotReference & {
  accountId: string
  profile: JsonObject
}

export type VerificationSpec =
  | { kind: 'headline'; expected: string }
  | { kind: 'about'; expected: string }
  | { kind: 'skills'; expected: string[] }
  | { kind: 'experience'; id?: string; expected: ExperienceData }
  | { kind: 'education'; id?: string; expected: EducationData }
  | { kind: 'open_to_work'; expected: JsonObject }

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
  sourceSnapshot?: ProfileSnapshotReference
  steps: PlanStep[]
  issues: ValidationIssue[]
}

export type ProfilePreview = {
  planId: string
  planHash: string
  expiresAt: string
  account: ConnectedAccount
  identity: ProfileIdentity
  sourceSnapshot?: ProfileSnapshotReference
  steps: PreviewStep[]
  issues: ValidationIssue[]
}

export type StepResult = CoreStepResult<PlanSection>

export type FillResult = {
  accountId: string
  identity: ProfileIdentity
  startedAt: string
  finishedAt: string
  status: 'verified' | 'failed' | 'cancelled' | 'no_changes'
  steps: StepResult[]
}
