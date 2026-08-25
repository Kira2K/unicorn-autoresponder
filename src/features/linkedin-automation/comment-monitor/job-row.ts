import type { MonitorJob, MonitorState } from './types.ts'

export const emptyState = (): MonitorState => ({ posts: [], items: [], knownIds: [], checks: 0,
  discovered: 0, published: 0, failed: 0, threadReplies: {} })

const parseState = (value: unknown): MonitorState => {
  try { return { ...emptyState(), ...JSON.parse(String(value ?? '')) } }
  catch { return emptyState() }
}

export function monitorJobFromRow(row: any): MonitorJob {
  return {
    recordId: Number(row.Id), jobId: String(row.job_id ?? ''),
    platformAccountId: Number(row.platform_account_id),
    accountId: String(row.unipile_account_id ?? ''), clientName: String(row.client_name ?? ''),
    status: String(row.status ?? 'error') as MonitorJob['status'], stage: String(row.stage ?? ''),
    state: parseState(row.state_json), nextCheckAt: String(row.next_check_at ?? '') || undefined,
    lastCheckAt: String(row.last_check_at ?? '') || undefined,
    expiresAt: String(row.expires_at ?? ''), errorCode: String(row.error_code ?? '') || undefined,
    createdAt: String(row.created_at ?? ''), updatedAt: String(row.updated_at ?? ''),
    finishedAt: String(row.finished_at ?? '') || undefined
  }
}

export function monitorJobRow(job: MonitorJob) {
  return {
    job_id: job.jobId, platform_account_id: job.platformAccountId,
    unipile_account_id: job.accountId, client_name: job.clientName,
    status: job.status, stage: job.stage, state_json: JSON.stringify(job.state),
    next_check_at: job.nextCheckAt ?? '', last_check_at: job.lastCheckAt ?? '',
    expires_at: job.expiresAt, error_code: job.errorCode ?? '', created_at: job.createdAt,
    updated_at: job.updatedAt, finished_at: job.finishedAt ?? ''
  }
}
