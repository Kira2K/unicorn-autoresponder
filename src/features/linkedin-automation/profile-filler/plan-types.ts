import type {
  EducationData, ExperienceData, JsonObject, ProfileInput, ValidationIssue
} from './input-types.ts'
import type { CatalogType } from './mcp-contract.ts'
import type { GenerationMetadata } from './generation/types.ts'

export type ProfileAccount = {
  platformAccountId: number
  clientName: string
  accountId: string
  providerId: string
  profileUrl: string
}

export type PlanSection =
  'headline' | 'about' | 'experience' | 'education' | 'skills' | 'open_to_work'

export type VerificationSpec =
  | { kind: 'headline'; expected: string }
  | { kind: 'about'; expected: string }
  | { kind: 'skills'; expected: string[]; exact?: boolean }
  | { kind: 'experience'; id?: string; expected: ExperienceData }
  | { kind: 'education'; id?: string; expected: EducationData }
  | { kind: 'open_to_work'; expected: JsonObject }

export type PlanStep = {
  readOnly?: boolean
  id: string
  section: PlanSection
  action: 'update' | 'create' | 'add'
  summary: string
  before: unknown
  after: unknown
  payload: JsonObject
  verification: VerificationSpec
}

export type ProfilePlan = {
  entryPolicy?: import('./approved-state.ts').ApprovedEntries
  skillPolicy?: { baseline: string[]; target: string[] }
  kind: 'apply' | 'rollback'
  rollbackOf?: string
  account: ProfileAccount
  input?: ProfileInput
  identity: { displayName: string; profileUrl: string }
  snapshot: { capturedAt: string; values: Record<string, unknown> }
  steps: PlanStep[]
  issues: ValidationIssue[]
  generation?: GenerationMetadata
}

export type ProfilePreview = Omit<ProfilePlan, 'input' | 'steps' | 'skillPolicy' | 'entryPolicy'> & {
  jobId: string
  planHash: string
  document?: JsonObject
  steps: Array<Omit<PlanStep, 'payload' | 'verification' | 'readOnly'>>
}

export type FillStepResult = {
  writeIntent?: { step: PlanStep; savedAt: string }
  stepId: string
  section: PlanSection
  status: 'pending' | 'waiting' | 'writing' | 'write_accepted' | 'verifying' |
    'verification_delayed' | 'pending_retry' | 'verified' | 'failed'
  message: string
  attempt?: number
  maxAttempts?: number
  failureKind?: 'write_rejected' | 'write_uncertain' | 'write_accepted_not_visible' |
    'value_mismatch' | 'prewrite_blocked'
  errorCode?: string
  updatedAt?: string
  startedAt?: string
  completedAt?: string
  nextActionAt?: string
  durationMs?: number
}

export type FillResult = {
  status: 'running' | 'verifying' | 'pending_verification' | 'verified' | 'failed' | 'no_changes'
  steps: FillStepResult[]
  verification?: { attempt: number; maxAttempts: number; nextReadBackAt?: string; startedAt?: string; notBefore?: string }
  startedAt?: string
  updatedAt?: string
  finishedAt?: string
}

export type ProfileClient = {
  getAccount(accountId: string): Promise<JsonObject>
  getOwnProfile(accountId: string, sections?: string[], options?: { fresh?: boolean }): Promise<JsonObject>
  updateOwnProfile(accountId: string, payload: JsonObject): Promise<unknown>
  searchParameters(accountId: string, type: CatalogType, keywords: string):
    Promise<Array<{ id: string; name: string }>>
}
