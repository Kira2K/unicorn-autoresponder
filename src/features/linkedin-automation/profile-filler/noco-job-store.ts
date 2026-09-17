const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { findTable } = require('../../../integrations/noco/linkedin-profile-jobs-schema/logic.ts') as {
  findTable(value: unknown): any
}

type ProfileJob = import('./job-types.ts').ProfileJob

const { fromRow, profileJobRow, profileJobPatch } = require('./job-row.ts') as typeof import('./job-row.ts')

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
    const value = await client.createRecord(await table(), profileJobRow(job))
    const item = Array.isArray(value) ? value[0] : value?.list?.[0] ?? value
    const id = Number(item?.Id ?? item?.id)
    if (id) ids.set(job.jobId, id)
  }
  async function update(jobId: string, patch: Partial<ProfileJob>) {
    const id = ids.get(jobId) ?? (await get(jobId))?.recordId
    if (!id) throw Object.assign(new Error('Profile job not found.'), { code: 'profile_job_not_found' })
    await client.patchRecord(await table(), id, profileJobPatch(patch))
  }
  async function list(platformAccountId?: number, activeOnly = false): Promise<ProfileJob[]> {
    if (platformAccountId !== undefined && (!Number.isSafeInteger(platformAccountId) || platformAccountId <= 0)) {
      throw new RangeError('Invalid account ID')
    }
    const filters = platformAccountId === undefined ? [] : [`(platform_account_id,eq,${platformAccountId})`]
    if (activeOnly) filters.push('(' + ['waiting_retry', 'running', 'verifying', 'validating', 'previewing', 'retrying']
      .map(status => `(status,eq,${status})`).join('~or') + ')')
    const rows = await client.fetchRecords(await table(), 50, {
      sort: '-created_at', ...(filters.length ? { where: filters.join('~and') } : {})
    }, { fresh: activeOnly })
    return rows.map((row: Record<string, unknown>) => {
      const job = fromRow(row)
      if (job.recordId) ids.set(job.jobId, job.recordId)
      return job
    })
  }
  async function listPendingVerification(): Promise<ProfileJob[]> {
    return (await client.fetchRecords(await table(), 50, {
      where: '(status,eq,running)~or(status,eq,verifying)', sort: 'created_at'
    })).map(fromRow)
  }
  return { create, get, list, listActive: (id: number) => list(id, true), listPendingVerification, update }
}

module.exports = { createProfileJobStore, fromRow }
