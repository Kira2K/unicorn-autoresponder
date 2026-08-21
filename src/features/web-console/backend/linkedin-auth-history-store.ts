const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { findTable } = require('../../../integrations/noco/linkedin-auth-runs-schema/logic.ts') as {
  findTable(value: unknown): any
}

function createdId(value: any): number | undefined {
  const item = Array.isArray(value) ? value[0] : value?.list?.[0] ?? value?.data?.[0] ?? value
  const id = Number(item?.Id ?? item?.id)
  return Number.isFinite(id) && id > 0 ? id : undefined
}

function fromRow(row: any) {
  const status = String(row.status ?? '') === 'running' ? 'interrupted' : String(row.status ?? '')
  return {
    runId: String(row.run_id ?? ''), platformAccountId: Number(row.platform_account_id),
    clientName: String(row.client_name ?? ''), action: String(row.action ?? ''), status,
    stage: String(row.stage ?? ''), errorCode: String(row.error_code ?? '') || undefined,
    startedAt: String(row.started_at ?? ''), finishedAt: String(row.finished_at ?? '') || undefined
  }
}

function createLinkedInAuthHistoryStore(client = createNocoClient({ pageDelayMs: 300 })) {
  let tableId = ''
  const recordIds = new Map<string, number>()
  async function resolveTableId() {
    if (tableId) return tableId
    const table = findTable(await client.request('get', `/api/v2/meta/bases/${client.config.baseId}/tables`))
    if (!table?.id) throw Object.assign(new Error('History table is missing.'), {
      code: 'noco_linkedin_auth_runs_table_missing'
    })
    return tableId = String(table.id)
  }
  async function start(run: any) {
    const created = await client.createRecord(await resolveTableId(), {
      run_id: run.runId, platform_account_id: run.platformAccountId, client_name: run.clientName,
      action: run.action, status: 'running', stage: run.stage, started_at: run.startedAt
    })
    const id = createdId(created)
    if (id) recordIds.set(run.runId, id)
  }
  async function finish(run: any) {
    let id = recordIds.get(run.runId)
    if (!id) {
      const rows = await client.fetchRecords(await resolveTableId(), 1, { where: `(run_id,eq,${run.runId})` })
      id = Number(rows[0]?.Id)
    }
    if (!id) return
    await client.patchRecord(await resolveTableId(), id, {
      status: run.status, stage: run.stage, error_code: run.error?.code ?? '',
      finished_at: run.finishedAt ?? new Date().toISOString()
    })
  }
  async function list() {
    const rows = await client.fetchRecords(await resolveTableId(), 100, { sort: '-started_at' })
    return rows.map(fromRow)
  }
  return { finish, list, start }
}

module.exports = { createLinkedInAuthHistoryStore, createdId, fromRow }
