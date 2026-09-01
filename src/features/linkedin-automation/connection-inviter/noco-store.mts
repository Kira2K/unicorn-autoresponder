import { createRequire } from 'node:module'
import { createdItem, historyFromRow, historyRow, runFromRow, runRow } from './store-rows.ts'
import { createConnectionTableResolver } from './noco-tables.mts'
import { createConnectionNocoBudgetController,
  type ConnectionNocoBudgetController } from './noco-budget.ts'
import { sharedNocoRequestCoordinator } from '../../../integrations/noco/core/request-coordinator.ts'
import type { ConnectionHistoryItem, ConnectionNocoRequestStats } from './types.ts'

const load = createRequire(import.meta.url)
const { createNocoClient } = load('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const axios = load('axios') as { request(options: any): Promise<{ data: unknown }> }
const { sharedNocoRequestLimiter } = load(
  '../../../integrations/noco/core/request-limiter.ts') as { sharedNocoRequestLimiter: any }

const PAGE_SIZE = 100
const HISTORY_BATCH_SIZE = 20
const CATALOG_TTL_MS = 15 * 60_000

function nocoValue(value: unknown) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/([(),])/g, '\\$1')
}

function pageCount(rows: unknown[], limit: number) {
  return Math.max(1, Math.ceil(Math.min(rows.length, limit) / PAGE_SIZE))
}

export function createConnectionInviterStore(providedClient?: any, options: {
  budgetController?: ConnectionNocoBudgetController
  requester?: (request: any) => Promise<{ data: unknown }>
  useSharedScheduling?: boolean
  retryDelaysMs?: number[]
} = {}) {
  const budget = options.budgetController ?? createConnectionNocoBudgetController()
  const useSharedScheduling = options.useSharedScheduling ?? !options.requester
  const client = providedClient ?? createNocoClient({
    requester: options.requester ?? ((request: any) => axios.request(request)),
    pageDelayMs: 300,
    retryDelaysMs: options.retryDelaysMs ?? [0, 30_000, 30_000],
    readCacheTtlMs: useSharedScheduling ? 15_000 : 0,
    ...(useSharedScheduling ? {
      limiter: sharedNocoRequestLimiter,
      coordinator: sharedNocoRequestCoordinator
    } : {}),
    onPhysicalAttempt: budget.onPhysicalAttempt
  })
  const stats: ConnectionNocoRequestStats = { reads: 0, pages: 0, creates: 0,
    patches: 0, conflicts: 0, retries: 0 }
  const recordRead = (pages = 1) => { stats.reads += 1; stats.pages += Math.max(1, pages) }
  const tables = createConnectionTableResolver(client, () => recordRead())
  let catalogCache: { expiresAt: number; value: any[] } | undefined
  let catalogRequest: Promise<any[]> | undefined
  const ambiguousHistoryClaims = new Map<string, 'post_2xx' | 'post_ambiguous'>()
  const scoped = <T,>(run: any, action: () => Promise<T>) => {
    budget.initialize(run)
    return budget.currentRunId() === run.runId ? action() : budget.run(run, action)
  }
  const scopedId = <T,>(runId: string, action: () => Promise<T>) =>
    budget.currentRunId() === runId ? action() : budget.mode(runId, 'mandatory', action)

  async function fetchRows(table: string, limit: number, query: Record<string, string | number>,
    options: { fresh?: boolean } = {}) {
    const rows = await client.fetchRecords(table, limit, query, options)
    recordRead(pageCount(rows, limit)); return rows
  }

  async function findRun(field: string, value: string, fresh = false) {
    const rows = await fetchRows((await tables()).runs, 1,
      { where: `(${field},eq,${nocoValue(value)})` }, { fresh })
    return rows[0] ? runFromRow(rows[0]) : undefined
  }

  async function findHistory(accountId: string, personId: string, fresh = false) {
    const rows = await fetchRows((await tables()).history, 1,
      { where: `(history_key,eq,${nocoValue(`${accountId}:${personId}`)})` }, { fresh })
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
      const load = async () => (await fetchRows((await tables()).runs, limit,
        { sort: '-created_at' }, { fresh: true })).map(runFromRow)
      if (budget.currentRunId()) return load()
      const result = await budget.capture(load)
      budget.addCapturedToRuns(result.value.filter((run: any) => run.status === 'running' ||
        ['waiting_retry', 'recovering', 'resolving_uncertain', 'stop_requested']
          .includes(run.stage)), result.scope)
      return result.value
    },
    async listRunsForAccount(platformAccountId: number, limit = 1000) {
      const action = async () => (await fetchRows((await tables()).runs, limit, {
        where: `(platform_account_id,eq,${platformAccountId})`, sort: '-created_at'
      }, { fresh: true })).map(runFromRow)
      return budget.currentRunId() ? action() : budget.captureAccount(platformAccountId, action)
    },
    getRun: (runId: string) => findRun('run_id', runId, true),
    getRunByKey: (runKey: string) => budget.captureRunKey(runKey,
      () => findRun('run_key', runKey, true), value => value),
    async createRun(run: any) {
      budget.attachLifecycle(run)
      return scoped(run, async () => {
        const existing = await findRun('run_key', run.runKey, true)
        if (existing) { stats.conflicts += 1; return { run: existing, created: false } }
        try {
          stats.creates += 1; budget.syncRun(run, 2)
          const value = createdItem(await client.createRecord((await tables()).runs, runRow(run)))
          budget.syncRun(run)
          run.recordId = Number(value?.Id ?? value?.id) || undefined; return { run, created: true }
        } catch (error) {
          budget.syncRun(run)
          const concurrent = await findRun('run_key', run.runKey, true).catch(() => undefined)
          if (concurrent) { stats.conflicts += 1; return { run: concurrent, created: false } }
          throw error
        }
      })
    },
    async updateRun(run: any) {
      return scoped(run, async () => {
        const existing = run.recordId ? run : await findRun('run_id', run.runId, true)
        if (!existing?.recordId) throw Object.assign(new Error('Connection run not found.'),
          { code: 'connection_run_not_found' })
        run.recordId = existing.recordId; stats.patches += 1; budget.syncRun(run, 9)
        try { await client.patchRecord((await tables()).runs, run.recordId, runRow(run)) }
        finally { budget.syncRun(run) }
      })
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
    async claimHistory(row: any): Promise<boolean> {
      if (!budget.currentRunId()) {
        return scopedId(row.runId, () => this.claimHistory(row))
      }
      const confirmsClaim = (existing: ConnectionHistoryItem | undefined) => Boolean(
        existing?.recordId && existing.historyKey === row.historyKey &&
        existing.runId === row.runId && existing.accountId === row.accountId &&
        existing.personId === row.personId && existing.status === 'sending' &&
        !existing.sentAt && !existing.requestId)
      const previousAttempt = ambiguousHistoryClaims.get(row.historyKey)
      if (previousAttempt) {
        const existing = await findHistory(row.accountId, row.personId, true)
        if (confirmsClaim(existing)) {
          ambiguousHistoryClaims.delete(row.historyKey); row.recordId = existing!.recordId
          return previousAttempt === 'post_2xx'
        }
        if (existing) {
          ambiguousHistoryClaims.delete(row.historyKey); stats.conflicts += 1
          return false
        }
        // A successful fresh empty read-back is the only proof that a new create is safe.
        ambiguousHistoryClaims.delete(row.historyKey)
        if (previousAttempt === 'post_2xx') return false
      }
      let postError: unknown
      let postSucceeded = false
      try {
        stats.creates += 1
        const table = (await tables()).history
        const value = createdItem(await client.request('post',
          `/api/v2/tables/${table}/records`, historyRow(row)))
        row.recordId = Number(value?.Id ?? value?.id) || undefined
        postSucceeded = true
      } catch (error) { postError = error }
      ambiguousHistoryClaims.set(row.historyKey,
        postSucceeded ? 'post_2xx' : 'post_ambiguous')
      let existing: ConnectionHistoryItem | undefined
      try { existing = await findHistory(row.accountId, row.personId, true) }
      catch (readError) { throw readError }
      ambiguousHistoryClaims.delete(row.historyKey)
      if (confirmsClaim(existing)) {
        row.recordId = existing!.recordId
        return postSucceeded
      }
      if (existing) { stats.conflicts += 1; return false }
      if (postError) throw postError
      return false
    },
    async updateHistory(row: any): Promise<void> {
      if (!budget.currentRunId()) {
        return scopedId(row.runId, () => this.updateHistory(row))
      }
      const existing = row.recordId ? row : await findHistory(row.accountId, row.personId, true)
      if (!existing?.recordId) throw Object.assign(new Error('Connection history item not found.'),
        { code: 'connection_history_not_found' })
      row.recordId = existing.recordId; stats.patches += 1
      await client.patchRecord((await tables()).history, row.recordId, historyRow(row))
    },
    async listHistory(platformAccountId: number, limit = 100) {
      return (await fetchRows((await tables()).history, limit,
        { where: `(platform_account_id,eq,${platformAccountId})`,
          sort: '-discovered_at' }, { fresh: true })).map(historyFromRow)
    },
    async listRunHistory(runId: string, limit = 1000) {
      const action = async () => (await fetchRows((await tables()).history, limit,
        { where: `(run_id,eq,${nocoValue(runId)})`, sort: '-discovered_at' },
        { fresh: true })).map(historyFromRow)
      return budget.currentRunId() ? action() : scopedId(runId, action)
    },
    async listOpenHistory(platformAccountId: number, limit = 1000) {
      const states = ['sending', 'deferred', 'sent', 'uncertain']
        .map(status => `(status,eq,${status})`).join('~or')
      const action = async () => (await fetchRows((await tables()).history, limit, {
        where: `(platform_account_id,eq,${platformAccountId})~and(${states})`,
        sort: '-discovered_at'
      }, { fresh: true })).map(historyFromRow)
      return budget.currentRunId() ? action() : budget.captureAccount(platformAccountId, action)
    },
    requestStats() { return structuredClone(stats) },
    recordRetry() { stats.retries += 1 },
    runWithNocoBudget<T>(run: any, action: () => Promise<T>) {
      budget.attachLifecycle(run); return budget.run(run, action)
    },
    withNocoBudgetMode<T>(runId: string, mode: 'mandatory' | 'optional',
      action: () => Promise<T>) { return budget.mode(runId, mode, action) },
    nocoBudgetCanStart(runId: string, requiredPhysicalAttempts: number) {
      return budget.canStart(runId, requiredPhysicalAttempts)
    },
    nocoBudgetSnapshot(runId: string) { return budget.snapshot(runId) }
  }
}
