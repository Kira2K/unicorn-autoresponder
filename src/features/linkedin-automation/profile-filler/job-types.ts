import type { FillResult, ProfilePlan } from './plan-types.ts'
import { profileDocument } from './profile-document.ts'

export type ProfileJobStatus =
  'generating_cv' | 'generating_profile' | 'validating' |
  'previewing' | 'waiting_retry' | 'retrying' | 'preview_ready' |
  'running' | 'verifying' | 'pending_verification' |
  'succeeded' | 'failed' | 'needs_expert_review'

export type ProfileJob = {
  recordId?: number
  jobId: string
  platformAccountId: number
  accountId?: string
  clientName: string
  status: ProfileJobStatus
  phase: string
  planHash?: string
  plan?: ProfilePlan
  result?: FillResult
  checkpoint?: import('./generation/types.ts').GenerationCheckpoint | null
  errorCode?: string
  createdAt: string
  updatedAt: string
  finishedAt?: string
}

export function publicProfileJob(job: ProfileJob) {
  const rollbackAvailable = job.status === 'succeeded' && job.plan?.kind === 'apply' &&
    Boolean(job.plan.steps.length) && job.plan.steps.every(step =>
      ['headline', 'about'].includes(step.section))
  return {
    jobId: job.jobId, platformAccountId: job.platformAccountId, clientName: job.clientName,
    status: job.status, phase: job.phase, planHash: job.planHash,
    kind: job.plan?.kind ?? 'apply', rollbackOf: job.plan?.rollbackOf, rollbackAvailable,
    preview: job.plan && job.planHash ? {
      jobId: job.jobId, planHash: job.planHash, account: job.plan.account,
      identity: job.plan.identity, issues: job.plan.issues,
      generation: job.plan.generation,
      document: job.plan.input ? profileDocument(job.plan.input) : undefined,
      steps: job.plan.steps.map(({ payload: _payload, verification: _verification, readOnly: _readOnly, ...step }) => step)
    } : undefined,
    result: job.result && { ...job.result,
      steps: job.result.steps.map(({ writeIntent: _intent, ...step }) => step) }, errorCode: job.errorCode,
    retry: job.checkpoint?.retry,
    createdAt: job.createdAt, updatedAt: job.updatedAt, finishedAt: job.finishedAt
  }
}
