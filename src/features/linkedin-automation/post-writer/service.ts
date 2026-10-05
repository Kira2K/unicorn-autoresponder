import { PostError, errorCode } from './errors.ts'
import { createServiceState } from './service-state.ts'
import { processRun } from './process-run.ts'
import { schedulePosts, scheduledRun } from './scheduler.ts'
import { newRun, applyAction, accountActive } from './run-actions.ts'
import { nextSlot, validateSettings, scheduledId } from './schedule.ts'
import { digest } from './content-identity.ts'
import { active, type Dependencies, type ManualMode } from './types.ts'
import { createSerialQueue } from './serial.ts'
import { cancelRemainingLikes } from './cancel-likes.ts'
import { createWorkTracker } from './work-tracker.ts'
import { prepareManualInput, type ManualInput } from './manual-input.ts'
import { unlock } from './execution-types.ts'
import { runImage } from './run-content.ts'
import { assertPreparedEdits } from './prepared-posts.ts'
import { startPreparedPost } from './prepared-start.ts'
import { retryMeme } from './meme-recovery.ts'
import { canStartManualLikes, canResumeManualLikes, startManualLikes } from './manual-likes.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
const { withRequestContext } = (requestControl as any).default ?? requestControl
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
        if (run.automationId && run.status !== 'published') continue
        busy.add(run.id)
        const process = () => withRequestContext({ runId: run.id, account: run.target?.unipileAccountId,
          feature: run.status === 'published' ? 'likes' : 'posts',
          initiator: run.automationId || run.trigger === 'scheduled' ? 'schedule' : 'manual' }, () => processRun(run, e))
        void work.run(() => run.automationId && !run.engagement.requestedManually
          ? withRequestContext({ taskId: `${run.automationId}:likes`, feature: 'likes',
            assertWrite: () => e.assertAutomaticLikes?.(run.account) }, process) : process()).catch(error => {
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
    async resumeManaged(id: string) {
      await writable(); const run = runs.get(id)
      if (!run?.automationId || busy.has(id)) throw new PostError('post_resume_invalid')
      if (run.status === 'published') return
      const hasAttempt = run.attemptedAt || (!run.publicationNotSent &&
        (await e.store.list('history', run.account)).some(h => h.runId === id))
      run.stop = false
      if (hasAttempt) run.status = 'uncertain'
      else if (['blocked', 'stopped'].includes(run.status)) run.status = run.draft ? 'ready' : 'queued'
      run.errorCode = undefined
      await e.save(run)
    },
    async stopAutomaticLikes(account: number) {
      if (!e.writable) return
      await writable()
      for (const run of runs.values()) if (run.account === account && run.automationId &&
        !run.engagement.requestedManually && run.status === 'published') {
        run.stop = true; await e.save(run)
      }
    },
    async transferAutomation(account: number) {
      return serial(account, async () => { await writable()
        await e.saveSettings({ ...e.settings(account), scheduled: false, automationManaged: true }) })
    },
    async prepareManaged(account: number, date: string, automationId: string,
      policy?: { contentMode: 'generated' | 'prepared'; generateIfMissing: boolean }) {
      return serial(account, async () => {
        await writable()
        const id = scheduledId(account, date), existing = runs.get(id)
        if (busy.has(id)) throw new PostError('linkedin_operation_active')
        if (existing) {
          if (!existing.automationId) { existing.automationId = automationId; await e.save(existing) }
          return structuredClone(existing)
        }
        const blocking = [...runs.values()].some(run => {
          if (!accountActive([run], account)) return false
          const priorAttempt = run.attemptedAt && new Date(run.attemptedAt + 3 * 3600_000).toISOString().slice(0, 10) < date
          return busy.has(run.id) || !priorAttempt || !['publishing', 'verifying', 'uncertain'].includes(run.status)
        })
        if (blocking) throw new PostError('linkedin_operation_active')
        const settings = policy ? { ...e.settings(account), contentMode: policy.contentMode } : e.settings(account)
        let run = scheduledRun(settings, date, e)
        if (!run && policy?.generateIfMissing) {
          run = scheduledRun({ ...settings, contentMode: 'generated' }, date, e)
          e.log('prepared_post_missing_generate', { account, date })
        }
        if (!run) throw new PostError('post_prepared_missing')
        run.automationId = automationId
        await e.save(run); return structuredClone(run)
      })
    },
    async stepManaged(id: string, stop = false, cooperate?: <T>(action: () => Promise<T>) => Promise<T>) {
      await writable()
      const run = runs.get(id)
      if (!run?.automationId) throw new PostError('post_run_not_found')
      if (busy.has(id)) throw new PostError('linkedin_operation_active')
      busy.add(id)
      try {
        if (stop && !run.stop) {
          run.stop = true; e.generationControllers.get(id)?.abort()
          if (run.attemptedAt && ['publishing', 'verifying', 'uncertain'].includes(run.status))
            run.nextActionAt = Math.max(run.nextActionAt ?? 0, e.now() + 60_000)
          await e.save(run)
        }
        const unconfirmed = !!run.attemptedAt && ['publishing', 'verifying', 'uncertain'].includes(run.status)
        if (run.stop && !unconfirmed) return { status: 'stopped' as const }
        // Engagement runs against its actors in the existing worker, outside the author's task.
        if (run.status === 'published') return { status: 'completed' as const, publishedAt: run.publishedAt,
          summary: { completed: 1, skipped: 0, unconfirmed: 0 } }
        const process = () => withRequestContext({ runId: id, account: run.target?.unipileAccountId,
          feature: 'posts', initiator: run.stop ? 'recovery' : 'schedule' }, () => processRun(run, e, true))
        const result = cooperate && ['queued', 'generating'].includes(run.status)
          ? await cooperate(process) : await process()
        return { ...result, publishedAt: run.publishedAt, warning: run.context?.warning }
      } finally {
        // The request has returned and its outcome is durable; the shared policy protects uncertainty.
        for (const [account, held] of e.release) if (held.id === id) unlock(e, account)
        busy.delete(id)
      }
    },
    tick: trackedTick,
    async get(account: number) { await state.hydrate(); return state.snapshot(account) },
    async likeAccounts(account: number) {
      const rows = await e.source.accounts(), author = rows.find(row => row.platformAccountId === account)
      const seen = new Set<string>()
      return rows.filter(row => {
        if (row.platformAccountId === account || !row.verifiedProviderId || !row.unipileAccountId ||
          row.verifiedProviderId === author?.verifiedProviderId || seen.has(row.verifiedProviderId)) return false
        seen.add(row.verifiedProviderId); return true
      }).map(row => ({ id: row.platformAccountId, name: row.clientName }))
    },
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
      if (value.likeAccountIds?.length) {
        const accounts = await e.source.accounts(), author = accounts.find(row => row.platformAccountId === account)
        const identities = new Set<string>()
        for (const id of value.likeAccountIds) {
          const row = accounts.find(row => row.platformAccountId === id)
          if (!row?.verifiedProviderId || !row.unipileAccountId || row.verifiedProviderId === author?.verifiedProviderId ||
            identities.has(row.verifiedProviderId)) throw new PostError('post_like_accounts_invalid')
          identities.add(row.verifiedProviderId)
        }
      }
      assertPreparedEdits(e.settings(account), value, runs.values())
      if ((value.memes || (value.contentMode === 'prepared' && value.scheduled)) && !e.memes?.enabled) {
        throw new PostError('meme_generation_disabled')
      }
      value.slot = nextSlot(value, e.now(), e.random) ?? value.slot
      await e.saveSettings(value)
      if (!value.likes) await cancelRemainingLikes(account, runs.values(), e)
      return state.snapshot(account)
    })) },
    startPrepared(account: number, input: unknown) { return work.run(() => serial(account, async () => {
      await writable()
      return startPreparedPost(e.settings(account), input, runs, e)
    })) },
    start(account: number, mode: ManualMode, key: string, input?: ManualInput) { return work.run(() => serial(account, async () => {
      await writable()
      if (e.settings(account).contentMode === 'prepared') throw new PostError('post_prepared_manual_unavailable')
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
      if (action === 'start-likes') return serial(run.account, async () => {
        await writable()
        if (canStartManualLikes(run) && e.settings(run.account).likeAccountIds?.length === 0) throw new PostError('post_like_accounts_invalid')
        if ((canStartManualLikes(run) || canResumeManualLikes(run)) &&
          (busy.has(id) || accountActive(runs.values(), run.account))) {
          throw new PostError('post_account_busy')
        }
        if (!startManualLikes(run)) return structuredClone(run)
        if (run.engagement.status === 'pending' && e.settings(run.account).likeAccountIds !== undefined) {
          run.engagement.accountIds = [...e.settings(run.account).likeAccountIds!]
        }
        busy.add(id)
        try { await e.save(run); return structuredClone(run) }
        finally { busy.delete(id) }
      })
      if (action === 'retry-meme') return serial(run.account, async () => {
        if (busy.has(id) || accountActive(runs.values(), run.account)) throw new PostError('post_account_busy')
        busy.add(id)
        try {
          if ((await e.store.list('history', run.account)).some(item => item.runId === id)) {
            throw new PostError('post_meme_retry_invalid')
          }
          retryMeme(run)
          await e.save(run)
          return structuredClone(run)
        } finally { busy.delete(id) }
      })
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
