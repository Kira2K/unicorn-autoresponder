const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { findTable } = require('../../../integrations/noco/linkedin-profile-jobs-schema/logic.ts') as {
  findTable(value: unknown): any
}

type ProfileJob = import('./job-types.ts').ProfileJob

function parseJson(value: unknown) {
  try { return value ? JSON.parse(String(value)) : undefined } catch { return undefined }
}

function fromRow(row: any): ProfileJob {
  return {
    recordId: Number(row.Id), jobId: String(row.job_id ?? ''),
    platformAccountId: Number(row.platform_account_id), accountId: String(row.unipile_account_id ?? '') || undefined,
    clientName: String(row.client_name ?? ''), status: String(row.status ?? 'failed') as ProfileJob['status'],
    phase: String(row.phase ?? ''), planHash: String(row.plan_hash ?? '') || undefined,
    plan: parseJson(row.plan_json), result: parseJson(row.result_json),
    checkpoint: parseJson(row.checkpoint_json),
    errorCode: String(row.error_code ?? '') || undefined,
    createdAt: String(row.created_at ?? ''), updatedAt: String(row.updated_at ?? ''),
    finishedAt: String(row.finished_at ?? '') || undefined
  }
}

function createProfileJobStore(client = createNocoClient({ pageDelayMs: 300 })) {
  let tableId = ''
  let tableRequest: Promise<string> | undefined
  const ids = new Map<string, number>()
  async function table() {
    if (tableId) return tableId
    if (!tableRequest) tableRequest = (async () => {
      const meta = await client.request('get', `/api/v2/meta/bases/${client.config.baseId}/tables`)
      const found = findTable(meta)
      if (!found?.id) throw Object.assign(new Error('Profile jobs table is missing.'), {
        code: 'linkedin_profile_jobs_table_missing'
      })
      return tableId = String(found.id)
    })()
    try { return await tableRequest } finally { tableRequest = undefined }
  }
  async function get(jobId: string): Promise<ProfileJob | undefined> {
    const rows = await client.fetchRecords(await table(), 1, { where: `(job_id,eq,${jobId})` })
    const job = rows[0] && fromRow(rows[0])
    if (job?.recordId) ids.set(jobId, job.recordId)
    return job
  }
  async function create(job: ProfileJob) {
    const value = await client.createRecord(await table(), {
      job_id: job.jobId, platform_account_id: job.platformAccountId,
      unipile_account_id: job.accountId ?? '', client_name: job.clientName,
      status: job.status, phase: job.phase,
      ...(job.planHash ? { plan_hash: job.planHash } : {}),
      ...(job.plan ? { plan_json: JSON.stringify(job.plan) } : {}),
      ...(job.result ? { result_json: JSON.stringify(job.result) } : {}),
      ...(job.checkpoint ? { checkpoint_json: JSON.stringify(job.checkpoint) } : {}),
      created_at: job.createdAt, updated_at: job.updatedAt
    })
    const item = Array.isArray(value) ? value[0] : value?.list?.[0] ?? value
    const id = Number(item?.Id ?? item?.id)
    if (id) ids.set(job.jobId, id)
  }
  async function update(jobId: string, patch: Partial<ProfileJob>) {
    const id = ids.get(jobId) ?? (await get(jobId))?.recordId
    if (!id) throw Object.assign(new Error('Profile job not found.'), { code: 'profile_job_not_found' })
    await client.patchRecord(await table(), id, {
      ...(patch.accountId !== undefined ? { unipile_account_id: patch.accountId } : {}),
      ...(patch.status ? { status: patch.status } : {}), ...(patch.phase ? { phase: patch.phase } : {}),
      ...(patch.planHash !== undefined ? { plan_hash: patch.planHash } : {}),
      ...(patch.plan !== undefined ? { plan_json: JSON.stringify(patch.plan) } : {}),
      ...(patch.result !== undefined ? { result_json: JSON.stringify(patch.result) } : {}),
      ...(patch.checkpoint !== undefined ? {
        checkpoint_json: patch.checkpoint ? JSON.stringify(patch.checkpoint) : ''
      } : {}),
      ...(patch.errorCode !== undefined ? { error_code: patch.errorCode } : {}),
      ...(patch.updatedAt ? { updated_at: patch.updatedAt } : {}),
      ...(patch.finishedAt ? { finished_at: patch.finishedAt } : {})
    })
  }
  async function list() {
    return (await client.fetchRecords(await table(), 50, { sort: '-created_at' })).map(fromRow)
  }
  return { create, get, list, update }
}

module.exports = { createProfileJobStore, fromRow }
