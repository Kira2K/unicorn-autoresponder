import * as gateModule from './linkedin-operation-gate.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
import { randomUUID, createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Express, RequestHandler } from 'express'
import { createOrchestrator } from '../../linkedin-automation/orchestrator/service.ts'
import { describeFailure } from '../../linkedin-automation/orchestrator/failure.ts'
import { createFeatureAdapters, type Services } from '../../linkedin-automation/orchestrator/adapters.ts'
import { createRequestPolicy } from '../../linkedin-automation/orchestrator/request-policy.ts'
import { accountKey, fail, type Schedule } from '../../linkedin-automation/orchestrator/contracts.ts'
import { plan, dateMsk, dayStart, validateSchedule, unknownLockGraceMs } from '../../linkedin-automation/orchestrator/planner.ts'
import { registerWriterShutdown } from '../../linkedin-automation/post-writer/shutdown-signals.ts'
import { createWithdrawalFileStore } from '../../linkedin-automation/invitation-withdrawal/file-store.ts'
import type { createLinkedInAutomationStore } from '../../../integrations/postgres/linkedin-automation.mts'
import type { LinkedInAuthAccountRow } from '../../linkedin-automation/account-connection/types.ts'
import type { LikeEvent } from '../../linkedin-automation/post-writer/types.ts'
const { createLinkedInOperationGate } = (gateModule as any).default ?? gateModule
const { installRequestPolicy, requestContext, drainWrites } = (requestControl as any).default ?? requestControl

export async function prepareLinkedInAutomation(store: ReturnType<typeof createLinkedInAutomationStore>,
  repository: { listAccounts(): Promise<LinkedInAuthAccountRow[]>;
    recordFailure?(id: number, input: { errorCode: string; accountStatus?: string }): Promise<void> },
  options: { now?: () => number; autoStart?: boolean; withdrawalDirectory?: string; version?: string } = {}) {
  if (!await store.ready()) return undefined
  const now = options.now ?? Date.now, owner = randomUUID()
  // Fingerprint the executed sources once, including uncommitted local changes.
  const version = options.version ?? (() => {
    try {
      const hash = createHash('sha256')
      for (const directory of ['src/features/linkedin-automation', 'src/integrations/unipile', 'src/features/web-console/backend'])
        for (const file of readdirSync(resolve(directory), { recursive: true }).map(String).sort())
          if (/\.[cm]?ts$/.test(file) && !/test|fixtures|mock|e2e/.test(file)) {
            hash.update(directory + '/' + file); hash.update(readFileSync(resolve(directory, file)))
          }
      return `source:${hash.digest('hex').slice(0, 16)}`
    } catch { return process.env.RENDER_GIT_COMMIT?.slice(0, 40) || 'source-unavailable' }
  })()
  let epoch = await store.claim(owner, now()), connected = epoch !== undefined, services: Services | undefined
  let leaseObservedAt = now(), runtime: ReturnType<typeof createOrchestrator> | undefined
  const aliases = new Map<string, string>(), providerKeys = new Map<string, string>()
  const accountInfo = new Map<string, { accountId: number; studentId: number }>()
  const pendingLikeEvents: LikeEvent[] = []
  const likeStages = { like_preflight: 'Проверка аккаунта перед лайком', like_readback: 'Проверка результата лайка',
    like_send: 'Отправка лайка', likes_stopped: 'Остановка автоматических лайков' }
  function reportLikeEvent(event: LikeEvent) {
    if (!runtime) { pendingLikeEvents.push(event); return }
    const author = [...accountInfo.values()].find(row => row.accountId === event.authorAccountId)
    const detail = describeFailure({ code: event.code, httpStatus: event.httpStatus })
    const stage = likeStages[event.stage]
    const reason = event.code === 'automation_likes_expired'
      ? 'Истекли 24 часа прогона. Проверки прекращены, неизвестные результаты сохранены.' : detail.message
    runtime.recordEvent({ at: now(), ...detail, version, taskId: event.taskId, runId: event.runId,
      accountId: event.authorAccountId, studentId: author?.studentId, feature: 'likes', operation: event.stage, stage,
      initiator: event.taskId ? 'schedule' : 'manual', actionId: `like:${event.runId}:${event.actorAccountId ?? 'all'}`,
      message: `${stage}. Автор: аккаунт ${event.authorAccountId}.${event.actorAccountId === undefined ? '' : ` Исполнитель: аккаунт ${event.actorAccountId}.`} ${reason}` })
  }
  async function refreshAccounts() {
    const rows = await repository.listAccounts()
    for (const row of rows.filter(a => a.unipileAccountId)) {
      const key = accountKey(row), previous = aliases.get(String(row.platformAccountId))
      if (previous && previous !== key && gate?.current(String(row.platformAccountId))) throw fail('automation_account_changed')
      aliases.set(String(row.platformAccountId), key); providerKeys.set(row.unipileAccountId!, key)
      accountInfo.set(row.unipileAccountId!, { accountId: row.platformAccountId, studentId: Number(row.clientId) })
    }
    return rows
  }
  const assertAvailable = () => {
    if (!connected || now() - leaseObservedAt >= 40_000) throw fail('automation_owner_lost')
  }
  async function assertOwner() {
    assertAvailable()
    if (epoch === undefined) throw fail('automation_owner_lost')
    await store.owned(owner, epoch, now())
  }
  const manualWaiting = new Map<string, { id: string; until: number }>()
  const manual = (kind: string) => !requestContext()?.taskId && !['post_writer_automatic', 'post_likes', 'post_likes_check'].includes(kind)
  const gate = createLinkedInOperationGate({ resolveKey: (key: string) => aliases.get(key) ?? key, assertAvailable,
    beforeAcquire(kind: string, id: string, key?: string) {
      if (!key) return
      const waiting = manualWaiting.get(key)
      if ((!manual(kind) && waiting && waiting.until > now()) ||
        (kind === 'post_likes' && runtime && !runtime.backgroundAllowed(key)))
        throw fail('linkedin_operation_active', 'Аккаунт уступает следующему действию.')
    }, blocked(kind: string, id: string, key?: string) {
      if (key && manual(kind)) manualWaiting.set(key, { id, until: now() + 120_000 })
    }, acquired(kind: string, id: string, key?: string) {
      if (key && manual(kind) && manualWaiting.get(key)?.id === id) manualWaiting.delete(key)
    } })
  await refreshAccounts()
  const uninstall = installRequestPolicy(createRequestPolicy({ store, assertOwner, now, version, resolveKey: id => providerKeys.get(id),
    accountInfo: id => accountInfo.get(id),
    async onAccountAuthFailure(unipileId, code) {
      const row = (await repository.listAccounts()).find(a => a.unipileAccountId === unipileId)
      if (row && row.authErrorCode !== code) {
        await assertOwner()
        await repository.recordFailure?.(row.platformAccountId, { errorCode: code })
      }
    },
    onFailure(error) { connected = false; runtime?.suspend(error, 'Контроль запроса и запись журнала') } }))
  const files = createWithdrawalFileStore(options.withdrawalDirectory ?? resolve('storage/linkedin-invitation-withdrawal'))
  const imports = new Map<number, Promise<void>>()
  const withdrawals = {
    async load(id: number) {
      if (!imports.has(id)) imports.set(id, (async () => {
        if (!await store.withdrawals.load(id)) {
          const old = await files.load(id)
          if (old) { await assertOwner(); await store.importWithdrawal(id, old) }
        }
      })().catch(error => { imports.delete(id); throw error }))
      await imports.get(id); return store.withdrawals.load(id)
    },
    async save(id: number, value: Parameters<typeof store.withdrawals.save>[1]) {
      await assertOwner(); await store.withdrawals.save(id, value)
    }
  }
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let ticking = false
  const tick = async () => {
    if (!runtime || ticking) return
    ticking = true
    try {
      try { await refreshAccounts() } catch (error) {
        connected = false; runtime.suspend(error, 'Обновление списка аккаунтов'); return
      }
      await runtime.tick()
      const status = await runtime.status()
      connected = status.isOwner; epoch = status.owner?.id === owner ? status.owner.epoch : undefined
      if (connected) leaseObservedAt = now()
    } finally { ticking = false }
  }
  function attach(value: Services) {
    services = value
    value.identity = async id => {
      const row = (await refreshAccounts()).find(a => a.platformAccountId === id)
      if (!row?.unipileAccountId) throw fail('automation_account_unverified')
      return { unipileId: row.unipileAccountId, key: accountKey(row) }
    }
    const leasedStore = { ...store, async claim(id: string, at: number) {
      const value = await store.claim(id, at)
      epoch = value; connected = value !== undefined; if (connected) leaseObservedAt = now()
      return value
    } }
    runtime = createOrchestrator({ store: { ...leasedStore, async release(id, token) { await drainWrites(); await store.release(id, token) } }, owner, now, version, autoStart: false,
      adapters: createFeatureAdapters(value),
      transfer: async schedule => {
        await assertOwner()
        if (schedule.slots.some(s => s.features.includes('posts'))) await value.posts.transferAutomation(schedule.account.id)
      }, changed: async schedule => {
        if (!schedule.enabled || !schedule.slots.some(s => s.features.includes('posts')))
          await value.posts.stopAutomaticLikes(schedule.account.id)
      }, report: event => console.error('[linkedin-automation]', JSON.stringify(event)) })
    for (const event of pendingLikeEvents.splice(0)) reportLikeEvent(event)
    const safeTick = () => tick().catch(error => { connected = false; runtime?.suspend(error) })
    if (options.autoStart !== false) { heartbeat = setInterval(() => void safeTick(), 5000); heartbeat.unref(); void safeTick() }
    return runtime
  }
  async function scheduleFor(id: number, input: any): Promise<Schedule> {
    const row = (await repository.listAccounts()).find(a => a.platformAccountId === id)
    if (!row?.unipileAccountId) throw fail('automation_account_unverified')
    const account = { id, studentId: Number(row.clientId), name: row.clientName,
      key: accountKey(row), unipileId: row.unipileAccountId }
    aliases.set(String(id), account.key)
    const existing = (await store.snapshot()).schedules.find(s => s.account.id === id)
    return validateSchedule({ account, enabled: input.enabled, slots: input.slots,
      version: existing?.version ?? 0, updatedAt: now(), commentsActivatedAt: existing?.commentsActivatedAt,
      postPolicy: input.postPolicy ?? existing?.postPolicy })
  }
  function routes(app: Express, requireAdmin: RequestHandler) {
    const api = '/api/admin/linkedin/automation'
    function route(method: 'get' | 'post' | 'put', path: string, action: (req: any) => Promise<unknown>) {
      app[method](api + path, requireAdmin, async (req, res) => {
        try { if (!runtime) throw fail('automation_unavailable'); res.json(await action(req)) }
        catch (error) { const detail = describeFailure(error)
          res.status(/invalid|overlap/.test(detail.code) ? 400 : /conflict/.test(detail.code) ? 409 : 503).json(detail) }
      })
    }
    route('get', '', async () => {
      const status = await runtime!.status(), postResults: Record<string, unknown> = {}
      const linked = status.tasks.filter(task => task.feature === 'posts' && task.runId)
      await Promise.all([...new Set(linked.map(task => task.account.id))].map(async account => {
        // Read the existing feature snapshot, never call Unipile for a status page.
        const snapshot = await services!.posts.get(account)
        for (const task of linked.filter(task => task.account.id === account)) {
          const run = snapshot.runs.find(run => run.id === task.runId)
          if (snapshot.storageError || !run) { postResults[task.runId!] = { unavailable: true }; continue }
          const counts = (state: string) => run.engagement.items.filter(item => item.status === state).length
          postResults[run.id] = { publishedAt: run.publishedAt, likes: { status: run.engagement.status,
            confirmed: counts('sent'), pending: counts('pending'), uncertain: counts('sending') + counts('uncertain'),
            failed: counts('failed'), target: run.engagement.target, nextAt: run.nextActionAt,
            errors: run.engagement.items.filter(item => item.errorCode).map(item => ({ accountId: item.account.platformAccountId,
              name: item.account.clientName, code: item.errorCode,
              stage: item.errorStage ? likeStages[item.errorStage] : item.attemptedAt !== undefined ? likeStages.like_readback : likeStages.like_preflight })) } }
        }
      }))
      return { ...status, postResults }
    })
    route('get', '/history', req => {
      const number = (key: string) => {
        if (req.query[key] === undefined || req.query[key] === '') return undefined
        const value = Number(req.query[key])
        if (!Number.isSafeInteger(value) || value < 0) throw fail('automation_history_invalid')
        return value
      }
      const source = req.query.source ? String(req.query.source) : undefined
      const feature = req.query.feature ? String(req.query.feature) : undefined
      if ((source && !['Unipile', 'SQL', 'Dolphin', 'OpenAI', 'наш код'].includes(source)) ||
        (feature && !['posts', 'comments', 'invitations', 'withdrawals', 'likes'].includes(feature))) throw fail('automation_history_invalid')
      return store.history(number('account'), number('after') ?? 0, 200, { latest: req.query.latest === 'true',
        before: number('before'), source, feature, errorsOnly: req.query.errorsOnly === 'true', from: number('from'), to: number('to') })
    })
    route('put', '/schedule/:id', async req => {
      const schedule = await scheduleFor(Number(req.params.id), req.body)
      return runtime!.saveSchedule(schedule, Number(req.body.version))
    })
    route('post', '/preview', async req => {
      const schedule = await scheduleFor(Number(req.body.accountId), req.body)
      const previous = (await store.snapshot()).tasks, at = now(), tasks = []
      for (let offset = 0; offset < 7; offset++) tasks.push(...plan(schedule, previous,
        offset === 0 ? at : dayStart(dateMsk(at + offset * 86_400_000)), () => .5))
      return { timezone: 'Europe/Moscow', tasks }
    })
    route('post', '/apply', async req => {
      if (!Array.isArray(req.body.accounts) || !req.body.accounts.length || req.body.accounts.length > 500)
        throw fail('automation_selection_invalid')
      const result = []
      for (const item of req.body.accounts) {
        try { const value = await scheduleFor(Number(item.id), req.body)
          result.push({ id: item.id, ok: true, schedule: await runtime!.saveSchedule(value, Number(item.version)) }) }
        catch (error) { result.push({ id: item.id, ok: false, ...describeFailure(error) }) }
      }
      return { results: result }
    })
    route('post', '/runs/:id/resume', async req => { await runtime!.resume(String(req.params.id)); return { ok: true } })
  }
  let removeSignals: (() => void) | undefined, closing: Promise<void> | undefined
  function close() {
    return closing ??= (async () => {
      if (heartbeat) clearInterval(heartbeat)
      connected = false
      services?.inviter.stop(); (services?.comments as any)?.stop?.()
      const postsClosed = services?.posts.close()
      await runtime?.close(); await postsClosed; uninstall()
      if (!runtime && epoch !== undefined) await store.release(owner, epoch)
      removeSignals?.()
    })()
  }
  if (options.autoStart !== false) removeSignals = registerWriterShutdown(close,
    (code, fields) => console.error('[linkedin-automation]', code, fields))
  return { gate, assertAvailable, withdrawals, attach, routes, tick, close, unknownLockGraceMs, reportLikeEvent,
    async assertAutomaticLikes(account: number) {
      await assertOwner()
      const schedule = (await store.snapshot()).schedules.find(s => s.account.id === account)
      if (!schedule?.enabled || !schedule.slots.some(s => s.features.includes('posts'))) throw fail('automation_disabled')
    } }
}
export function unavailableLinkedInAutomation(error: unknown): LinkedInAutomation {
  const detail = describeFailure(error)
  const blocked = () => { throw fail('automation_owner_lost', detail.message) }
  const uninstall = installRequestPolicy({ async before(info: { write: boolean }) { if (info.write) blocked() }, async failed() {} })
  let services: Services | undefined
  return { gate: createLinkedInOperationGate({ assertAvailable: blocked }), assertAvailable: blocked,
    withdrawals: { async load() { blocked(); return undefined }, async save() { blocked() } },
    attach(value) { services = value }, async tick() {},
    routes(app, requireAdmin) {
      app.use('/api/admin/linkedin/automation', requireAdmin, (_req, res) => res.status(503).json({
        available: false, isOwner: false, ...detail }))
    },
    async close() { services?.inviter.stop(); (services?.comments as any)?.stop?.(); await services?.posts.close(); uninstall() }
  }
}
export type LinkedInAutomation = {
  unknownLockGraceMs?: number;
  assertAutomaticLikes?(account: number): Promise<void>;
  reportLikeEvent?(event: LikeEvent): void;
  gate: any; assertAvailable(): void;
  withdrawals: import('../../linkedin-automation/invitation-withdrawal/contracts.ts').Store;
  attach(value: Services): unknown; routes(app: Express, auth: RequestHandler): void;
  tick(): Promise<void>; close(): Promise<void>
}
