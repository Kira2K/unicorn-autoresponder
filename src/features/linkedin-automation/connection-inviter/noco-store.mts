import { createRequire } from 'node:module'
import { createdItem, historyFromRow, historyRow, runFromRow, runRow } from './store-rows.ts'
import { createConnectionTableResolver } from './noco-tables.mts'

const load = createRequire(import.meta.url)
const { createNocoClient } = load('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}

export function createConnectionInviterStore(client = createNocoClient({
  pageDelayMs: 300, retryDelaysMs: [0, 30_000, 30_000]
})) {
  const tables = createConnectionTableResolver(client)
  async function findRun(field: string, value: string) {
    const rows = await client.fetchRecords((await tables()).runs, 1, { where: `(${field},eq,${value})` })
    return rows[0] ? runFromRow(rows[0]) : undefined
  }
  async function findHistory(accountId: string, personId: string) {
    const rows = await client.fetchRecords((await tables()).history, 1,
      { where: `(history_key,eq,${accountId}:${personId})` })
    return rows[0] ? historyFromRow(rows[0]) : undefined
  }
  return {
    async listCatalog() {
      const rows = await client.fetchRecords((await tables()).catalog, 1000, { sort: 'priority' })
      return rows.filter((row: any) => Boolean(row.enabled)).map((row: any) => ({
        sourceKey: String(row.source_key), audience: row.audience, city: String(row.city),
        keywordTemplate: String(row.keyword_template), priority: Number(row.priority), enabled: true }))
    },
    async listRuns(limit = 100) {
      return (await client.fetchRecords((await tables()).runs, limit, { sort: '-created_at' })).map(runFromRow)
    },
    getRun: (runId: string) => findRun('run_id', runId),
    getRunByKey: (runKey: string) => findRun('run_key', runKey),
    async createRun(run: any) {
      const existing = await findRun('run_key', run.runKey)
      if (existing) return { run: existing, created: false }
      try {
        const value = createdItem(await client.createRecord((await tables()).runs, runRow(run)))
        run.recordId = Number(value?.Id ?? value?.id) || undefined; return { run, created: true }
      } catch (error) {
        const concurrent = await findRun('run_key', run.runKey).catch(() => undefined)
        if (concurrent) return { run: concurrent, created: false }; throw error
      }
    },
    async updateRun(run: any) {
      const existing = run.recordId ? run : await findRun('run_id', run.runId)
      if (!existing?.recordId) throw Object.assign(new Error('Connection run not found.'),
        { code: 'connection_run_not_found' })
      run.recordId = existing.recordId
      await client.patchRecord((await tables()).runs, run.recordId, runRow(run))
    },
    findHistory,
    async claimHistory(row: any) {
      if (await findHistory(row.accountId, row.personId)) return false
      try {
        const value = createdItem(await client.createRecord((await tables()).history, historyRow(row)))
        row.recordId = Number(value?.Id ?? value?.id) || undefined; return true
      } catch (error) {
        if (await findHistory(row.accountId, row.personId).catch(() => undefined)) return false; throw error
      }
    },
    async updateHistory(row: any) {
      const existing = row.recordId ? row : await findHistory(row.accountId, row.personId)
      if (!existing?.recordId) throw Object.assign(new Error('Connection history item not found.'),
        { code: 'connection_history_not_found' })
      row.recordId = existing.recordId
      await client.patchRecord((await tables()).history, row.recordId, historyRow(row))
    },
    async listHistory(platformAccountId: number, limit = 100) {
      return (await client.fetchRecords((await tables()).history, limit,
        { where: `(platform_account_id,eq,${platformAccountId})`, sort: '-discovered_at' })).map(historyFromRow)
    },
    async weekSent(platformAccountId: number, weekKey: string) {
      const rows = await client.fetchRecords((await tables()).history, 1000,
        { where: `(platform_account_id,eq,${platformAccountId})~and(` +
          `(sent_at,ge,exactDate,${weekKey} 00:00:00))` })
      return rows.map(historyFromRow).filter((row: any) => ['sent', 'accepted', 'uncertain'].includes(row.status))
    }
  }
}
