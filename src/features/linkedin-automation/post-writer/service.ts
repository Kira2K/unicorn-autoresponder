import { PostError, errorCode } from './errors.ts'
import { createServiceState } from './service-state.ts'
import { processRun } from './process-run.ts'
import { schedulePosts } from './scheduler.ts'
import { newRun, applyAction, accountActive } from './run-actions.ts'
import { nextSlot, validateSettings } from './schedule.ts'
import { digest } from './content-identity.ts'
import { active, type Dependencies, type ManualMode } from './types.ts'
import { createSerialQueue } from './serial.ts'
import { cancelRemainingLikes } from './cancel-likes.ts'
import { createWorkTracker } from './work-tracker.ts'
import { prepareManualInput, type ManualInput } from './manual-input.ts'
import { unlock } from './execution-types.ts'
import { runImage } from './run-content.ts'
export function createPostWriterService(deps: Dependencies, autoStart = true) {
  const state = createServiceState(deps)
  const { e, runs, settings } = state
  const work = createWorkTracker()
  e.isClosing = work.isClosing
  const busy = new Set<string>()
  let scheduling = false
  let suspendedUntil = 0
  const serialize = createSerialQueue()
  const serial = <T>(account: number, fn: () => Promise<T>) => serialize(String(account), fn)
  async function writable() {
    if (!e.writable) throw new PostError('post_writer_read_only')
    if (work.isClosing()) throw new PostError('post_writer_closing')
    await state.hydrate()
    if (state.storageBlocked() || work.isClosing()) throw new PostError('post_persistence_unavailable')
  }
  async function tick() {
    if (!e.writable || work.isClosing() || scheduling || suspendedUntil > e.now()) return
    scheduling = true
    try {
      await state.hydrate()
      if (state.storageBlocked()) await state.flush()
      if (state.storageBlocked() || work.isClosing()) return
      for (const value of settings.values()) await serial(value.account,
        () => schedulePosts(e.settings(value.account), runs, e))
      for (const run of runs.values()) if (!work.isClosing() && active(run) && !busy.has(run.id)) {
        busy.add(run.id)
        void work.run(() => processRun(run, e)).catch(error => {
          suspendedUntil = e.now() + 30_000
          e.log('execution_suspended', { code: errorCode(error) })
        }).finally(() => busy.delete(run.id))
      }
    } catch (error) { suspendedUntil = e.now() + 30_000; e.log('scheduler_error', { code: errorCode(error) }) }
    finally { scheduling = false }
  }
  const trackedTick = () => work.isClosing() ? Promise.resolve() : work.run(tick)
  const timer = autoStart ? setInterval(() => void trackedTick().catch(() => undefined), 1000) : undefined
  timer?.unref()
  return {
    tick: trackedTick,
    async get(account: number) { await state.hydrate(); return state.snapshot(account) },
    async image(id: string) {
      await state.hydrate()
      const run = runs.get(id)
      if (!run) throw new PostError('post_run_not_found')
      const image = await runImage(run, e.memes?.assets)
      if (!image) throw new PostError('post_run_not_found')
      return image
    },
    update(account: number, input: unknown) { return work.run(() => serial(account, async () => {
      await writable()
      const value = validateSettings(input, e.settings(account))
      if (value.memes && !e.memes?.enabled) throw new PostError('meme_generation_disabled')
      value.slot = nextSlot(value, e.now(), e.random) ?? value.slot
      await e.saveSettings(value)
      if (!value.likes) await cancelRemainingLikes(account, runs.values(), e)
      return state.snapshot(account)
    })) },
    start(account: number, mode: ManualMode, key: string, input?: ManualInput) { return work.run(() => serial(account, async () => {
      await writable()
      if (!['automatic', 'approval_required'].includes(mode) || !/^[a-z0-9_-]{8,100}$/i.test(key)) {
        throw new PostError('post_start_invalid')
      }
      const id = `manual-${account}-${digest(key)}`
      const existing = runs.get(id) ?? accountActive(runs.values(), account)
      if (existing) return structuredClone(existing)
      const run = newRun(id, account, 'manual', mode, e.settings(account).likes, e)
      run.memeEnabled = e.settings(account).memes === true
      if (run.memeEnabled && !e.memes?.enabled) throw new PostError('meme_generation_disabled')
      await prepareManualInput(run, e.source, input)
      await e.save(run)
      return structuredClone(run)
    })) },
    action(id: string, action: string, hash?: string, memeReviewedHash?: string) { return work.run(async () => {
      if (action === 'stop') {
        if (!e.writable) throw new PostError('post_writer_read_only')
        await state.hydrate()
      } else await writable()
      const run = runs.get(id)
      if (!run) throw new PostError('post_run_not_found')
      applyAction(run, action, hash, memeReviewedHash)
      if (action === 'stop') e.generationControllers.get(id)?.abort()
      try { await e.save(run) }
      catch (error) { if (action !== 'stop' || errorCode(error) !== 'post_persistence_unavailable') throw error }
      return structuredClone(run)
    }) },
    subscribe(account: number, listener: () => void) {
      state.events.on(String(account), listener)
      return () => { state.events.off(String(account), listener) }
    },
    async close() {
      if (timer) clearInterval(timer)
      const drained = work.drain()
      for (const controller of e.generationControllers.values()) controller.abort()
      await drained
      for (const account of e.release.keys()) unlock(e, account)
    }
  }
}
export type PostWriterService = ReturnType<typeof createPostWriterService>
