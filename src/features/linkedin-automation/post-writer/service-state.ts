import { EventEmitter } from 'node:events'
import { PostError, retryDelay } from './errors.ts'
import { defaults, type Dependencies, type PostRun, type Settings } from './types.ts'
import { lock, type Execution } from './execution-types.ts'
import { createSerialQueue } from './serial.ts'
export function createServiceState(deps: Dependencies) {
  const runs = new Map<string, PostRun>()
  const settings = new Map<number, Settings>()
  const events = new EventEmitter()
  const dirty = new Map<string, PostRun>()
  let ready: Promise<void> | undefined
  let storageError = false
  let storageRetryAt = 0
  const emit = (account: number) => events.emit(String(account))
  const serial = createSerialQueue()
  async function persistSettings(value: Settings) {
    await deps.store.put('settings', String(value.account), value)
    settings.set(value.account, value)
    emit(value.account)
  }
  const e: Execution = { ...deps, release: new Map(), generationControllers: new Map(),
    settings: account => settings.get(account) ?? defaults(account),
    async save(run) {
      run.updatedAt = deps.now()
      runs.set(run.id, run)
      const snapshot = structuredClone(run)
      dirty.set(run.id, snapshot)
      if (storageError && storageRetryAt > deps.now()) {
        emit(run.account)
        throw new PostError('post_persistence_unavailable')
      }
      try {
        await serial(run.id, () => deps.store.put('runs', run.id, snapshot))
        if (dirty.get(run.id) === snapshot) dirty.delete(run.id)
      }
      catch (error) {
        storageError = true
        storageRetryAt = Math.max(storageRetryAt, deps.now() + (retryDelay(error) ?? 30_000))
        emit(run.account)
        throw new PostError('post_persistence_unavailable')
      }
      deps.log('run_checkpoint', { runId: run.id, status: run.status,
        likesConfirmed: run.engagement.items.filter(item => item.status === 'sent').length })
      emit(run.account)
    },
    async saveSettings(value) {
      await serial(`settings-${value.account}`, () => persistSettings({ ...value,
        context: settings.get(value.account)?.context ?? value.context }))
    },
    async saveContext(account, context) {
      await serial(`settings-${account}`, () => persistSettings({ ...e.settings(account), context }))
    }
  }
  async function hydrate() {
    ready ??= (async () => {
      // Audit all buckets before enabling work, including orphaned history claims.
      await deps.store.list('history')
      for (const value of await deps.store.list('settings')) settings.set(value.account, value)
      for (const value of await deps.store.list('runs')) {
        runs.set(value.id, value)
        if (!e.writable) continue
        if (['publishing', 'verifying', 'uncertain'].includes(value.status)) lock(e, value.account, value.id)
        for (const item of value.engagement.items) if (['sending', 'uncertain'].includes(item.status)) {
          lock(e, item.account.platformAccountId, value.id)
        }
      }
    })().catch(error => { ready = undefined; throw error })
    await ready
  }
  async function flush() {
    if (storageRetryAt > deps.now()) return
    for (const [id, run] of dirty) {
      try {
        await serial(id, () => deps.store.put('runs', id, run))
        if (dirty.get(id) === run) dirty.delete(id)
      }
      catch (error) {
        storageRetryAt = deps.now() + (retryDelay(error) ?? 30_000)
        throw error
      }
    }
    storageError = false
    storageRetryAt = 0
  }
  function snapshot(account: number) {
    return structuredClone({ settings: e.settings(account), writable: e.writable && !storageError,
      mock: deps.mock === true, writerEnabled: e.writable, storageRetryAt, storageError,
      memesAvailable: e.memes?.enabled === true,
      runs: [...runs.values()].reverse().filter(run => run.account === account)
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 30) })
  }
  return { e, runs, settings, events, hydrate, flush, snapshot,
    storageBlocked: () => storageError }
}
