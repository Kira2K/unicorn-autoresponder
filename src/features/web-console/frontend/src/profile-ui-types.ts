import type { publicProfileJob } from '../../../linkedin-automation/profile-filler/job-types.ts'

export type ProfileUiJob = ReturnType<typeof publicProfileJob>
export type ProfileUiStage = 0 | 1 | 2 | 3
export type ProfileUiSource = 'drive' | 'upload' | 'json'
export type ProfileUiAccount = { platformAccountId: number; clientName?: string; linkedinUrl?: string }
export type ProfileUiConfirmation = {
  kind: 'apply' | 'rollback'
  jobId: string
  planHash?: string
  job: ProfileUiJob
}
