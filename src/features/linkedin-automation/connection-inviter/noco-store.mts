import { createRequire } from 'node:module'
import { createdItem, historyFromRow, historyRow, runFromRow, runRow } from './store-rows.ts'
import { createConnectionTableResolver } from './noco-tables.mts'
import type { ConnectionHistoryItem, ConnectionNocoRequestStats } from './types.ts'

const load = createRequire(import.meta.url)
const { createNocoClient } = load('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}

const PAGE_SIZE = 100
const HISTORY_BATCH_SIZE = 20
const CATALOG_TTL_MS = 15 * 60_000

function nocoValue(value: unknown) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/([(),])/g, '\\$1')
}

function pageCount(rows: unknown[], limit: number) {
  return Math.max(1, Math.ceil(Math.min(rows.length, limit) / PAGE_SIZE))
}

export function createConnectionInviterStore(client = createNocoClient({
  pageDelayMs: 300, retryDelaysMs: [0, 30_000, 30_000]
})) {
  const stats: ConnectionNocoRequestStats = { reads: 0, pages: 0, creates: 0,
    patches: 0, conflicts: 0, retries: 0 }
  const recordRead = (pages = 1) => { stats.reads += 1; stats.pages += Math.max(1, pages) }
  const tables = createConnectionTableResolver(client, () => recordRead())
  let catalogCache: { expiresAt: number; value: any[] } | undefined
  let catalogRequest: Promise<any[]> | undefined

  async function fetchRows(table: string, limit: number, query: Record<string, string | number>) {
    const rows = await client.fetchRecords(table, limit, query)
    recordRead(pageCount(rows, limit)); return rows
  }

  async function findRun(field: string, value: string) {
    const rows = await fetchRows((await tables()).runs, 1,
      { where: `(${field},eq,${nocoValue(value)})` })
    return rows[0] ? runFromRow(rows[0]) : undefined
  }

  async function findHistory(accountId: string, personId: string) {
    const rows = await fetchRows((await tables()).history, 1,
      { where: `(history_key,eq,${nocoValue(`${accountId}:${personId}`)})` })
    return rows[0] ? historyFromRow(rows[0]) : undefined
  }

  async function loadCatalog() {
    const rows = await fetchRows((await tables()).catalog, 1000, { sort: 'priority' })
    return rows.filter((row: any) => Boolean(row.enabled)).map((row: any) => ({
      sourceKey: String(row.source_key), audience: row.audience, city: String(row.city),
      keywordTemplate: String(row.keyword_template), priority: Number(row.priority), enabled: true }))
  }

  return {
    async listCatalog() {
      if (catalogCache && catalogCache.expiresAt > Date.now()) return structuredClone(catalogCache.value)
      if (!catalogRequest) catalogRequest = loadCatalog()
      try {
        const value = await catalogRequest
        catalogCache = { value, expiresAt: Date.now() + CATALOG_TTL_MS }
        return structuredClone(value)
      } finally { catalogRequest = undefined }
    },
    async listRuns(limit = 100) {
      return (await fetchRows((await tables()).runs, limit, { sort: '-created_at' })).map(runFromRow)
    },
    async listRunsForAccount(platformAccountId: number, limit = 1000) {
      return (await fetchRows((await tables()).runs, limit, {
        where: `(platform_account_id,eq,${platformAccountId})`, sort: '-created_at'
      })).map(runFromRow)
    },
    getRun: (runId: string) => findRun('run_id', runId),
    getRunByKey: (runKey: string) => findRun('run_key', runKey),
    async createRun(run: any) {
      const existing = await findRun('run_key', run.runKey)
      if (existing) { stats.conflicts += 1; return { run: existing, created: false } }
      try {
        stats.creates += 1
        const value = createdItem(await client.createRecord((await tables()).runs, runRow(run)))
        run.recordId = Number(value?.Id ?? value?.id) || undefined; return { run, created: true }
      } catch (error) {
        const concurrent = await findRun('run_key', run.runKey).catch(() => undefined)
        if (concurrent) { stats.conflicts += 1; return { run: concurrent, created: false } }
        throw error
      }
    },
    async updateRun(run: any) {
      const existing = run.recordId ? run : await findRun('run_id', run.runId)
      if (!existing?.recordId) throw Object.assign(new Error('Connection run not found.'),
        { code: 'connection_run_not_found' })
      run.recordId = existing.recordId; stats.patches += 1
      await client.patchRecord((await tables()).runs, run.recordId, runRow(run))
    },
    findHistory,
    async findHistoryBatch(accountId: string, personIds: string[]) {
      const unique = [...new Set(personIds.filter(Boolean))]
      const result: ConnectionHistoryItem[] = []
      for (let offset = 0; offset < unique.length; offset += HISTORY_BATCH_SIZE) {
        const keys = unique.slice(offset, offset + HISTORY_BATCH_SIZE)
          .map(personId => `(history_key,eq,${nocoValue(`${accountId}:${personId}`)})`)
        if (!keys.length) continue
        const rows = await fetchRows((await tables()).history, keys.length,
          { where: keys.length === 1 ? keys[0] : `(${keys.join('~or')})` })
        result.push(...rows.map(historyFromRow))
      }
      return result
    },
    async claimHistory(row: any) {
      try {
        stats.creates += 1
        const table = (await tables()).history
        const value = createdItem(await client.request('post',
          `/api/v2/tables/${table}/records`, historyRow(row)))
        row.recordId = Number(value?.Id ?? value?.id) || undefined
        return true
      } catch (error: any) {
        const existing = await findHistory(row.accountId, row.personId).catch(() => undefined)
        if (existing) { stats.conflicts += 1; return false }
        throw error
      }
    },
    async updateHistory(row: any) {
      const existing = row.recordId ? row : await findHistory(row.accountId, row.personId)
      if (!existing?.recordId) throw Object.assign(new Error('Connection history item not found.'),
        { code: 'connection_history_not_found' })
      row.recordId = existing.recordId; stats.patches += 1
      await client.patchRecord((await tables()).history, row.recordId, historyRow(row))
    },
    async listHistory(platformAccountId: number, limit = 100) {
      return (await fetchRows((await tables()).history, limit,
        { where: `(platform_account_id,eq,${platformAccountId})`,
          sort: '-discovered_at' })).map(historyFromRow)
    },
    async listRunHistory(runId: string, limit = 1000) {
      return (await fetchRows((await tables()).history, limit,
        { where: `(run_id,eq,${nocoValue(runId)})`, sort: '-discovered_at' })).map(historyFromRow)
    },
    async listOpenHistory(platformAccountId: number, limit = 1000) {
      const states = ['sending', 'deferred', 'sent', 'uncertain']
        .map(status => `(status,eq,${status})`).join('~or')
      return (await fetchRows((await tables()).history, limit, {
        where: `(platform_account_id,eq,${platformAccountId})~and(${states})`,
        sort: '-discovered_at'
      })).map(historyFromRow)
    },
    requestStats() { return structuredClone(stats) },
    recordRetry() { stats.retries += 1 }
  }
}
