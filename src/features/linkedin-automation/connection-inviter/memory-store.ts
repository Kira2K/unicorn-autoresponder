import { CONNECTION_SEARCH_CATALOG } from './catalog.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'

export function createMemoryConnectionInviterStore() {
  const runs = new Map<string, ConnectionRun>()
  const runKeys = new Map<string, string>()
  const history = new Map<string, ConnectionHistoryItem>()
  let recordId = 0
  const copy = <T>(value: T): T => structuredClone(value)
  return {
    async listCatalog() { return copy(CONNECTION_SEARCH_CATALOG) },
    async listRuns(limit = 100) {
      return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit).map(copy)
    },
    async getRun(runId: string) { const run = runs.get(runId); return run && copy(run) },
    async getRunByKey(runKey: string) {
      const id = runKeys.get(runKey); const run = id && runs.get(id); return run && copy(run)
    },
    async createRun(run: ConnectionRun) {
      const existingId = runKeys.get(run.runKey)
      if (existingId) return { run: copy(runs.get(existingId)!), created: false }
      const stored = copy({ ...run, recordId: ++recordId }); runs.set(run.runId, stored)
      runKeys.set(run.runKey, run.runId); return { run: copy(stored), created: true }
    },
    async updateRun(run: ConnectionRun) { runs.set(run.runId, copy(run)) },
    async findHistory(accountId: string, personId: string) {
      const row = history.get(`${accountId}:${personId}`); return row && copy(row)
    },
    async claimHistory(row: ConnectionHistoryItem) {
      if (history.has(row.historyKey)) return false
      row.recordId = ++recordId; history.set(row.historyKey, copy(row)); return true
    },
    async updateHistory(row: ConnectionHistoryItem) { history.set(row.historyKey, copy(row)) },
    async listHistory(platformAccountId: number, limit = 100) {
      return [...history.values()].filter(row => row.platformAccountId === platformAccountId)
        .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)).slice(0, limit).map(copy)
    },
    async weekSent(platformAccountId: number, weekKey: string) {
      return [...history.values()].filter(row => row.platformAccountId === platformAccountId &&
        Boolean(row.sentAt && row.sentAt >= weekKey) && ['sent', 'accepted', 'uncertain'].includes(row.status))
        .map(copy)
    }
  }
}
