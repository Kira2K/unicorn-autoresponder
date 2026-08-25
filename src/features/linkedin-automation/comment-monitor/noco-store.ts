import type { MonitorJob } from './types.ts'

const { monitorJobFromRow, monitorJobRow } = require('./job-row.ts') as typeof import('./job-row.ts')

const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { findTable } = require('../../../integrations/noco/linkedin-comment-monitor-schema/logic.ts') as
  typeof import('../../../integrations/noco/linkedin-comment-monitor-schema/logic.ts')

function createCommentMonitorStore(client = createNocoClient({
  pageDelayMs: 300, retryDelaysMs: [0, 30_000, 30_000]
})) {
  let tableId = ''
  const ids = new Map<string, number>()
  async function table() {
    if (tableId) return tableId
    const meta = await client.request('get', `/api/v2/meta/bases/${client.config.baseId}/tables`)
    const found = findTable(meta)
    if (!found?.id) throw Object.assign(new Error('Comment monitor table is missing.'), {
      code: 'comment_monitor_table_missing'
    })
    return tableId = String(found.id)
  }
  async function list() {
    const rows = await client.fetchRecords(await table(), 200, { sort: '-created_at' })
    return rows.map((row: any) => {
      const job = monitorJobFromRow(row); if (job.recordId) ids.set(job.jobId, job.recordId); return job
    })
  }
  async function get(jobId: string) {
    const rows = await client.fetchRecords(await table(), 1, { where: `(job_id,eq,${jobId})` })
    const job = rows[0] && monitorJobFromRow(rows[0])
    if (job?.recordId) ids.set(jobId, job.recordId)
    return job as MonitorJob | undefined
  }
  async function create(job: MonitorJob) {
    const value = await client.createRecord(await table(), monitorJobRow(job))
    const item = Array.isArray(value) ? value[0] : value?.list?.[0] ?? value
    const id = Number(item?.Id ?? item?.id); if (id) ids.set(job.jobId, id)
  }
  async function update(job: MonitorJob) {
    const id = ids.get(job.jobId) ?? (await get(job.jobId))?.recordId
    if (!id) throw Object.assign(new Error('Comment monitor job not found.'), {
      code: 'comment_monitor_job_not_found'
    })
    await client.patchRecord(await table(), id, monitorJobRow(job))
  }
  async function purge(beforeIso: string) {
    for (const job of await list()) if (job.createdAt && job.createdAt < beforeIso && job.recordId) {
      await client.deleteRecord(await table(), job.recordId); ids.delete(job.jobId)
    }
  }
  return { create, get, list, purge, update }
}

module.exports = { createCommentMonitorStore }
