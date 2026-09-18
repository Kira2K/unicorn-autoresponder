import type { ProfileJob } from './job-types.ts'
const parseJson = (value: unknown) => {
  try { return value ? JSON.parse(String(value)) : undefined } catch { return undefined }
}
export function fromRow(row: Record<string, unknown>): ProfileJob {
  return {
    recordId: Number(row.Id), jobId: String(row.job_id ?? ''),
    platformAccountId: Number(row.platform_account_id), accountId: String(row.unipile_account_id ?? '') || undefined,
    clientName: String(row.client_name ?? ''), status: String(row.status ?? 'failed') as ProfileJob['status'],
    phase: String(row.phase ?? ''), planHash: String(row.plan_hash ?? '') || undefined,
    plan: parseJson(row.plan_json), result: parseJson(row.result_json), checkpoint: parseJson(row.checkpoint_json),
    errorCode: String(row.error_code ?? '') || undefined, createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''), finishedAt: String(row.finished_at ?? '') || undefined
  }
}
export function profileJobRow(job: ProfileJob) {
  return { job_id: job.jobId, platform_account_id: job.platformAccountId,
    unipile_account_id: job.accountId ?? '', client_name: job.clientName, status: job.status, phase: job.phase,
    ...(job.planHash ? { plan_hash: job.planHash } : {}),
    ...(job.plan ? { plan_json: JSON.stringify(job.plan) } : {}),
    ...(job.result ? { result_json: JSON.stringify(job.result) } : {}),
    ...(job.checkpoint ? { checkpoint_json: JSON.stringify(job.checkpoint) } : {}),
    created_at: job.createdAt, updated_at: job.updatedAt }
}
export function profileJobPatch(patch: Partial<ProfileJob>) {
  return {
    ...(patch.accountId !== undefined ? { unipile_account_id: patch.accountId } : {}),
    ...(patch.status ? { status: patch.status } : {}), ...(patch.phase ? { phase: patch.phase } : {}),
    ...(patch.planHash !== undefined ? { plan_hash: patch.planHash } : {}),
    ...(patch.plan !== undefined ? { plan_json: JSON.stringify(patch.plan) } : {}),
    ...(patch.result !== undefined ? { result_json: JSON.stringify(patch.result) } : {}),
    ...(patch.checkpoint !== undefined ? { checkpoint_json: patch.checkpoint ? JSON.stringify(patch.checkpoint) : '' } : {}),
    ...(patch.errorCode !== undefined ? { error_code: patch.errorCode } : {}),
    ...(patch.updatedAt ? { updated_at: patch.updatedAt } : {}), ...(patch.finishedAt ? { finished_at: patch.finishedAt } : {})
  }
}
