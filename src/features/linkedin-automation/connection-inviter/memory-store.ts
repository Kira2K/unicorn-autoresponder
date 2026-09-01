import { CONNECTION_SEARCH_CATALOG } from './catalog.ts'
import type { ConnectionHistoryItem, ConnectionNocoRequestStats, ConnectionRun } from './types.ts'

export function createMemoryConnectionInviterStore() {
  const runs = new Map<string, ConnectionRun>()
  const runKeys = new Map<string, string>()
  const history = new Map<string, ConnectionHistoryItem>()
  const stats: ConnectionNocoRequestStats = { reads: 0, pages: 0, creates: 0,
    patches: 0, conflicts: 0, retries: 0 }
  let recordId = 0
  const copy = <T>(value: T): T => structuredClone(value)
  const read = (pages = 1) => { stats.reads += 1; stats.pages += Math.max(1, pages) }
  return {
    async listCatalog() { read(4); return copy(CONNECTION_SEARCH_CATALOG) },
    async listRuns(limit = 100) {
      read()
      return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit).map(copy)
    },
    async listRunsForAccount(platformAccountId: number, limit = 1000) {
      read()
      return [...runs.values()].filter(run => run.platformAccountId === platformAccountId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(copy)
    },
    async getRun(runId: string) { read(); const run = runs.get(runId); return run && copy(run) },
    async getRunByKey(runKey: string) {
      read()
      const id = runKeys.get(runKey)
      if (!id) return undefined
      const run = runs.get(id); return run ? copy(run) : undefined
    },
    async createRun(run: ConnectionRun) {
      const existingId = runKeys.get(run.runKey)
      if (existingId) { stats.conflicts += 1; return { run: copy(runs.get(existingId)!), created: false } }
      stats.creates += 1
      const stored = copy({ ...run, recordId: ++recordId }); runs.set(run.runId, stored)
      runKeys.set(run.runKey, run.runId); return { run: copy(stored), created: true }
    },
    async updateRun(run: ConnectionRun) { stats.patches += 1; runs.set(run.runId, copy(run)) },
    async findHistory(accountId: string, personId: string) {
      read()
      const row = history.get(`${accountId}:${personId}`); return row && copy(row)
    },
    async findHistoryBatch(accountId: string, personIds: string[]) {
      read(Math.ceil(personIds.length / 20))
      return personIds.map(personId => history.get(`${accountId}:${personId}`))
        .filter(Boolean).map(row => copy(row!))
    },
    async claimHistory(row: ConnectionHistoryItem) {
      stats.creates += 1
      if (history.has(row.historyKey)) { stats.conflicts += 1; return false }
      row.recordId = ++recordId; history.set(row.historyKey, copy(row)); return true
    },
    async updateHistory(row: ConnectionHistoryItem) {
      stats.patches += 1; history.set(row.historyKey, copy(row))
    },
    async listHistory(platformAccountId: number, limit = 100) {
      const rows = [...history.values()].filter(row => row.platformAccountId === platformAccountId)
        .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)).slice(0, limit)
      read(Math.ceil(rows.length / 100)); return rows.map(copy)
    },
    async listRunHistory(runId: string, limit = 1000) {
      const rows = [...history.values()].filter(row => row.runId === runId)
        .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)).slice(0, limit)
      read(Math.ceil(rows.length / 100)); return rows.map(copy)
    },
    async listOpenHistory(platformAccountId: number, limit = 1000) {
      const open = new Set(['sending', 'deferred', 'sent', 'uncertain'])
      const rows = [...history.values()].filter(row => row.platformAccountId === platformAccountId &&
        open.has(row.status)).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)).slice(0, limit)
      read(Math.ceil(rows.length / 100)); return rows.map(copy)
    },
    requestStats() { return copy(stats) },
    recordRetry() { stats.retries += 1 }
  }
}
