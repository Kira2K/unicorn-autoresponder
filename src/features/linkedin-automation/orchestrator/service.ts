import { randomUUID } from 'node:crypto'
import { plan, dateMsk, windowFor, reserve, canRunBesideUnknown, validateSchedule } from './planner.ts'
import { fail, terminal, type Store, type Task, type Schedule, type Adapters, type Event, type StepContext } from './contracts.ts'
import type { ExecutionStep } from '../execution-step.ts'
import { describeFailure } from './failure.ts'
import { listReadDiagnostic } from '../../../integrations/unipile/read-retry.ts'
import { recordFailure, recoveryExpired, recoveryWakeAt, skipRecovery, ACTION_SKIPPED, summaryMessage } from '../action-recovery.ts'

const priorities = { posts: 1, invitations: 2, comments: 3, withdrawals: 4 }
export function createOrchestrator(options: { store: Store; adapters: Adapters; now?: () => number;
  random?: () => number; owner?: string; version?: string; autoStart?: boolean;
  sleep?(ms: number): Promise<void>;
  transfer?(schedule: Schedule): Promise<void>; changed?(schedule: Schedule): Promise<void>; report?(entry: Event): void }) {
  const { store, adapters } = options, now = options.now ?? Date.now, random = options.random ?? Math.random
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const actionPauses = new Map<string, number>()
  const owner = options.owner ?? randomUUID(), running = new Map<string, { task: Task; signal: AbortController; work: Promise<void>; released?: boolean }>()
  let epoch: number | undefined, scanning = false, closing = false, available = false, lastError: ReturnType<typeof describeFailure> | undefined
  let pruneAt = 0
  let dueAccounts = new Set<string>()
  const unsavedIncidents = new Map<string, Event>()
  const entry = (task: Task, code: string, message: string): Event => ({ at: now(), taskId: task.id,
    runId: task.runId, initiator: task.stopped ? 'recovery' : 'schedule',
    studentId: task.account.studentId, accountId: task.account.id, feature: task.feature,
    source: 'наш код', code, message, stage: task.stageMessage ?? task.stage, operation: task.stage, nextAt: task.nextAt, version: options.version })
  function rememberIncident(event: Event) {
    const key = `${event.taskId ?? ''}:${event.runId ?? ''}:${event.accountId ?? ''}:${event.actionId ?? ''}:${event.operation ?? ''}:${event.code}`
    if (unsavedIncidents.has(key)) return
    unsavedIncidents.set(key, event)
    // Only sanitized Event fields reach the fallback, never raw errors/SQL/response bodies.
    try {
      if (options.report) options.report(event)
      else console.error('[linkedin-automation]', JSON.stringify(event))
    } catch {
      try { console.error('[linkedin-automation]', JSON.stringify(event)) } catch { /* Keep the SQL backlog. */ }
    }
  }
  async function flushIncidents() {
    for (const [key, event] of unsavedIncidents) {
      await store.event(event)
      if (unsavedIncidents.get(key) === event) unsavedIncidents.delete(key)
    }
  }
  async function persist(task: Task, event: Event) {
    if (epoch === undefined) throw fail('automation_owner_lost')
    const next = await store.save(task, event, owner, epoch); Object.assign(task, next)
  }
  async function assertOwner() {
    if (closing || epoch === undefined) throw fail('automation_owner_lost')
    await store.owned(owner, epoch, now())
  }
  async function actionFinished(task: Task) {
    const at = now(), sample = random()
    const until = at + 10_000 + Math.floor((Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 1) * 10_000)
    actionPauses.set(task.account.key, Math.max(actionPauses.get(task.account.key) ?? 0, until))
    // A business step releases the account once. HTTP pacing inside it never does.
    try {
      await store.cooldown({ account: task.account.key, method: 'action', observedAt: at, until, code: 'action_pause' })
      await store.event({ ...entry(task, 'action_pause', 'Пауза между сохранёнными действиями фич.'), nextAt: until })
    }
    catch (error) {
      epoch = undefined
      for (const item of running.values()) item.signal.abort('lease_lost')
      throw error
    }
  }
  async function finishCommentDay(task: Task, schedule?: Schedule) {
    const started = Boolean(task.startedAt && task.runId)
    const waitingForPost = !started && schedule?.slots.some(s => s.features.includes('posts'))
    task.state = started ? 'completed' : 'needs_attention'
    task.reason = started ? 'active_day_finished' : waitingForPost ? 'comments_post_not_published' : 'comments_not_started'
    task.updatedAt = now()
    await persist(task, entry(task, task.reason, started ? 'День мониторинга завершён. Сессия сохранена.' :
      waitingForPost ? 'Комментарии не запущены: пост не опубликован до конца дня.' : 'Монитор комментариев в этот день не запускался.'))
  }
  async function assertWrite(task: Task, signal: AbortSignal) {
    await assertOwner()
    if (signal.aborted || task.stopped || (task.deadlineAt && now() >= task.deadlineAt)) throw fail('automation_stop_requested')
    const current = (await store.snapshot()).schedules.find(s => s.account.id === task.account.id)
    if (!current?.enabled || !current.slots.some(s => s.features.includes(task.feature))) throw fail('automation_disabled')
    if (current.account.key !== task.account.key || current.account.unipileId !== task.account.unipileId)
      throw fail('automation_account_changed')
    const window = windowFor(current, task.feature, now(), Boolean(task.startedAt || task.runId))
    if (task.feature === 'comments' && (!window || window.start > now())) throw fail('automation_disabled')
  }
  type Waiting = { ms: number; since?: number; depth: number; arm(): void }
  async function waitWithoutActiveTime<T>(waiting: Waiting, action: () => Promise<T>): Promise<T> {
    if (waiting.depth++ === 0) { waiting.since = now(); waiting.arm() }
    try { return await action() }
    finally { if (--waiting.depth === 0) {
      waiting.ms += Math.max(0, now() - waiting.since!); waiting.since = undefined; waiting.arm()
    } }
  }
  const context = (task: Task, controller: AbortController, waiting: Waiting): StepContext => ({ task, now,
    signal: controller.signal, assertWrite: () => assertWrite(task, controller.signal),
    waitForRequest: action => waitWithoutActiveTime(waiting, action),
    async stage(code, message) {
      await assertOwner(); task.stage = code; task.stageMessage = message
      await persist(task, entry(task, `stage_${code}`, message))
    },
    async cooperate(action, until, verifying = false) {
      const current = running.get(task.id)
      task.state = verifying ? 'verifying' : 'waiting'; task.nextAt = until ?? now()
      if (verifying) task.uncertainSince ??= now()
      const generating = until === undefined && ['posts', 'comments'].includes(task.feature)
      await persist(task, entry(task, generating ? 'stage_generating_text' : 'account_yielded', generating
        ? 'Генерируем текст. Аккаунт освобождён для других фич.' : 'Аккаунт освобождён на время ожидания.'))
      await actionFinished(task)
      if (current) current.released = true
      try { return await waitWithoutActiveTime(waiting, async () => {
        const result = await action()
        // Resume the saved iterator only after the current business action finishes.
        // Pauses overlap with the feature's own timer; they are not added to it.
        while (!closing && !controller.signal.aborted) {
          await assertOwner()
          const until = await store.blockedUntil(task.account.key, 'action', now())
          const busy = [...running.values()].some(r => r !== current && !r.released && r.task.account.key === task.account.key)
          if (!busy && until <= now()) break
          await sleep(Math.min(1000, Math.max(1, until - now(), busy ? 250 : 0)))
        }
        return result
      }) }
      finally { if (current) current.released = false }
    },
    async bind(id) { if (task.runId && task.runId !== id && task.feature !== 'comments') throw fail('automation_run_changed')
      task.runId = id; task.preparationRecovery = undefined
      await persist(task, entry(task, 'run_bound', 'Задание связано с прогоном фичи.')) } })
  async function advance(task: Task, schedule?: Schedule) {
    const controller = new AbortController(), started = now()
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let accounted = false
    const work = (async () => {
      const waiting = { ms: 0, depth: 0, since: undefined as number | undefined, arm() {
        if (watchdog) clearTimeout(watchdog)
        const activeRemaining = task.activeLimitMs - task.activeMs - Math.max(0, now() - started - waiting.ms)
        const delay = Math.min(task.deadlineAt! - now(), waiting.since === undefined ? activeRemaining : Infinity)
        watchdog = setTimeout(() => controller.abort('deadline'), Math.max(1, delay)); watchdog.unref?.()
      } }, ctx = context(task, controller, waiting)
      const wasVerifying = task.state === 'verifying'
      try {
        if (!task.runId) task.postPolicy = schedule?.postPolicy
        const removed = !schedule?.enabled || !schedule.slots.some(s => s.features.includes(task.feature))
        const timedOut = Boolean(task.deadlineAt && now() >= task.deadlineAt) || task.activeMs >= task.activeLimitMs
        if (removed || timedOut) { task.stopped = true; controller.abort(removed ? 'disabled' : 'deadline') }
        if (!task.startedAt) {
          const estimate = await adapters[task.feature].estimate(task)
          const history = await store.durations(task.feature, task.account.key)
          task.activeLimitMs = Math.min(12 * 60 * 60_000, Math.max(15 * 60_000, 2 * reserve(task.feature, estimate, history)))
          task.startedAt = now(); task.deadlineAt = now() + task.elapsedLimitMs
        }
        const checking = task.state === 'verifying'
        task.state = 'running'; task.updatedAt = now()
        await persist(task, entry(task, 'step_started', checking ? 'Проверяем результат отправленного.' : 'Начинаем следующий шаг.'))
        waiting.arm()
        if (task.retryRequested && !task.stopped) {
          await adapters[task.feature].resume?.(ctx); task.retryRequested = false
          await persist(task, entry(task, 'retry_prepared', 'Продолжение того же прогона подготовлено.'))
        }
        if (task.stopped) task.stopApplied = true
        const result: ExecutionStep & { runId?: string; publishedAt?: number } = task.stopped
          ? await adapters[task.feature].stop(ctx) : await adapters[task.feature].step(ctx)
        if (result.runId && !task.runId) await ctx.bind(result.runId)
        for (const skipped of result.skippedActions ?? []) {
          if (task.reportedSkips?.includes(skipped.actionId)) continue
          (task.reportedSkips ??= []).push(skipped.actionId)
          await persist(task, { ...entry(task, ACTION_SKIPPED,
            `Действие ${skipped.actionId} пропущено после 20 минут восстановления. Этап: ${skipped.stage ?? task.stage ?? task.feature}. ` +
            `Ошибка: HTTP ${skipped.httpStatus ?? '5xx'}, ${skipped.errorCode ?? 'ошибка сервиса'}. Неизвестный результат не разрешает повторную отправку.`),
            source: skipped.source ?? 'Unipile', actionId: skipped.actionId, httpStatus: skipped.httpStatus,
            stage: skipped.stage ?? task.stageMessage ?? task.stage,
            operation: skipped.stage ?? task.stage, requestId: skipped.requestId })
        }
        task.activeMs += Math.max(0, now() - started - waiting.ms); accounted = true
        task.updatedAt = now(); task.reason = result.reason
        if (result.summary) task.summary = result.summary
        task.recoveryDeadlineAt = result.recoveryDeadlineAt
        if (result.publishedAt) task.publishedAt = result.publishedAt
        const waitingResult = ['waiting', 'verifying'].includes(result.status)
        task.nextAt = task.stopped ? task.nextAt : result.nextActionAt ? Date.parse(result.nextActionAt) : now() + (waitingResult ? 60_000 : 0)
        if (!Number.isFinite(task.nextAt) || (waitingResult && task.nextAt <= now())) task.nextAt = now() + 60_000
        if (task.recoveryDeadlineAt !== undefined) task.nextAt = Math.min(task.nextAt, task.recoveryDeadlineAt)
        task.state = task.stopped ? 'stopped' : result.status === 'ready' ? 'waiting' : result.status
        if (task.state === 'verifying') task.uncertainSince ??= now()
        else task.uncertainSince = undefined
        if (['disabled', 'deadline'].includes(controller.signal.reason) && !task.stopped) { task.stopped = true
          if (!['completed', 'stopped', 'verifying'].includes(task.state)) { task.state = 'waiting'; task.nextAt = now() } }
        const detail = task.state === 'needs_attention' ? describeFailure({ code: result.reason ?? 'automation_feature_blocked' }) : undefined
        await persist(task, { ...entry(task, result.reason ?? task.state, result.summary ? summaryMessage(result.summary) :
          result.reason === ACTION_SKIPPED ? describeFailure({ code: ACTION_SKIPPED }).message : task.state === 'completed' ? 'Задание завершено.' :
          task.state === 'verifying' ? 'Результат неизвестен. Повторной отправки нет; продолжаем сверку.' :
          task.state === 'stopped' ? 'Прогон остановлен. Фоновых запросов больше нет; история отправок сохранена.' : 'Шаг сохранён. Аккаунт освобождён.'), ...detail })
        if (!task.stopped) await actionFinished(task)
      } catch (error: any) {
        const detail = describeFailure(error)
        task.updatedAt = now(); task.reason = detail.code; task.attempts++
        // No feature run means preparation has not dispatched a business write.
        if (!task.runId && detail.source === 'Unipile')
          task.preparationRecovery = recordFailure(task.preparationRecovery, error, now())
        const rawUntil = error?.nextAt ?? error?.details?.retryAt
        const providerUntil = typeof rawUntil === 'string' ? Date.parse(rawUntil) : Number(rawUntil)
        const temporary = Boolean(listReadDiagnostic(error)) || Number.isFinite(providerUntil) || detail.httpStatus === 429 ||
          (detail.httpStatus !== undefined && detail.httpStatus >= 500 && detail.httpStatus <= 599) ||
          /timeout|unreachable|unavailable|http_5|operation_active|step_yield|shared_cooldown/.test(detail.code)
        if (!accounted) task.activeMs += Math.max(0, now() - started - waiting.ms)
        task.state = wasVerifying || task.state === 'verifying' ? 'verifying' : controller.signal.aborted ? 'waiting' : temporary ? 'waiting' : 'needs_attention'
        if (['disabled', 'deadline'].includes(controller.signal.reason)) task.stopped = true
        task.nextAt = Math.max(now() + Math.min(60 * 60_000, 60_000 * 2 ** Math.min(6, task.attempts - 1)), providerUntil || 0)
        task.nextAt = recoveryWakeAt(task.preparationRecovery, task.nextAt)
        try { await persist(task, { ...entry(task, detail.code, detail.message), ...detail }) }
        catch (saveError) { lastError = describeFailure(saveError); epoch = undefined
          rememberIncident({ ...entry(task, detail.code, detail.message), ...detail })
          rememberIncident({ ...entry(task, lastError.code, lastError.message), ...lastError })
          for (const item of running.values()) item.signal.abort('lease_lost') }
      } finally { if (watchdog) clearTimeout(watchdog) }
    })().finally(() => running.delete(task.id))
    running.set(task.id, { task, signal: controller, work }); return work
  }
  async function tick() {
    if (closing || scanning) return
    scanning = true
    try {
      available = await store.ready(); if (!available) {
        epoch = undefined; for (const item of running.values()) item.signal.abort('lease_lost'); return
      }
      const claim = await store.claim(owner, now())
      if (claim === undefined) { epoch = undefined; for (const item of running.values()) item.signal.abort('lease_lost'); return }
      epoch = claim
      await flushIncidents()
      lastError = undefined
      let snapshot = await store.snapshot()
      for (const schedule of snapshot.schedules) {
        const planned = plan(schedule, snapshot.tasks, now(), random)
        if (planned.length) await store.create(planned)
      }
      snapshot = await store.snapshot()
      // Older versions marked a day successful even when no monitor session existed.
      // Correct that result once, preserving the original plan and audit history.
      for (const task of snapshot.tasks) if (task.feature === 'comments' && task.state === 'completed' &&
        !task.startedAt && !task.runId && task.day < dateMsk(now()))
        await finishCommentDay(task, snapshot.schedules.find(s => s.account.id === task.account.id))
      for (const task of snapshot.tasks) if (task.state === 'running' && !running.has(task.id)) {
        task.state = 'verifying'; task.uncertainSince ??= task.updatedAt; task.nextAt = now()
        await persist(task, entry(task, 'recovery_check', 'После перезапуска сначала проверяем сохранённый результат.'))
      }
      // Apply local feature cleanup for legacy records once, without resurrecting read-back.
      for (const task of snapshot.tasks) if (task.state === 'stopped' && task.runId && !task.stopApplied) {
        task.stopped = true; task.state = 'waiting'; task.updatedAt = now()
        await persist(task, entry(task, 'stop_cleanup', 'Останавливаем локальный исполнитель. История отправок сохранена.'))
      }
      for (const task of snapshot.tasks) if (task.feature === 'comments' && !terminal(task) && task.runId &&
        !running.has(task.id) && snapshot.tasks.some(next => next.feature === 'comments' && next.day > task.day &&
          next.account.key === task.account.key && next.runId === task.runId)) {
        task.state = 'completed'; task.reason = 'session_continued'; task.updatedAt = now()
        await persist(task, entry(task, task.reason, 'Сохранённую сессию продолжает задача нового дня.'))
      }
      const busy = new Set([...running.values()].filter(r => !r.released).map(r => r.task.account.key))
      const candidates = snapshot.tasks.filter(t => !terminal(t) && !running.has(t.id))
        .sort((a, b) => Number(b.state === 'verifying') - Number(a.state === 'verifying') ||
          (a.startedAt ? a.updatedAt : 0) - (b.startedAt ? b.updatedAt : 0) ||
          priorities[a.feature] - priorities[b.feature] || a.plannedAt - b.plannedAt)
      dueAccounts = new Set()
      for (const task of candidates) {
        const schedule = snapshot.schedules.find(s => s.account.id === task.account.id)
        if (!task.startedAt && !task.runId && (task.day < dateMsk(now()) || task.windowEnd <= now())) {
          if (task.feature === 'comments') { await finishCommentDay(task, schedule); continue }
          task.state = 'stopped'; task.stopped = true
          task.reason = 'automation_window_missed'; task.updatedAt = now()
          await persist(task, entry(task, task.reason, 'Запуск пропущен: разрешённое время закончилось.')); continue
        }
        const disabled = !schedule?.enabled || !schedule.slots.some(s => s.features.includes(task.feature)) ||
          (task.feature === 'withdrawals' && !task.startedAt && !schedule.slots.some(s => s.id === task.slotId && s.features.includes('withdrawals')))
        if (disabled && !task.runId) { task.state = 'stopped'; task.stopped = true
          await persist(task, entry(task, 'cancelled', 'Запланированный запуск отменён.')); continue }
        if (!disabled && task.feature === 'comments' && task.day < dateMsk(now()) && task.state !== 'verifying') {
          await finishCommentDay(task, schedule); continue
        }
        const expired = Boolean(task.deadlineAt && task.deadlineAt <= now()) || task.activeMs >= task.activeLimitMs
        if (!disabled && !expired && !task.stopped && task.state === 'verifying' && task.nextAt > now()) continue
        if (!disabled && !expired && !task.stopped && task.nextAt > now()) continue
        if (!task.runId && recoveryExpired(task.preparationRecovery, now())) {
          skipRecovery(task.preparationRecovery!, now()); task.state = 'completed'; task.reason = ACTION_SKIPPED
          task.summary = { completed: 0, skipped: 1, unconfirmed: 0 }; task.updatedAt = now()
          const failure = task.preparationRecovery!
          await persist(task, { ...entry(task, ACTION_SKIPPED,
            `Подготовка фичи пропущена после 20 минут ошибок. HTTP ${failure.httpStatus ?? '5xx'}, ${failure.errorCode ?? 'ошибка сервиса'}. ${summaryMessage(task.summary)}`),
            source: failure.source ?? 'Unipile', stage: failure.stage ?? task.stageMessage ?? 'Подготовка фичи',
            httpStatus: failure.httpStatus, requestId: failure.requestId, actionId: `prepare:${task.id}` })
          continue
        }
        if (busy.has(task.account.key)) continue
        const actionUntil = Math.max(actionPauses.get(task.account.key) ?? 0,
          await store.blockedUntil(task.account.key, 'action', now()))
        actionPauses.set(task.account.key, actionUntil)
        // Wake for a local expiry decision; request policy still forbids provider calls during cooldown.
        const recoveryDue = task.recoveryDeadlineAt !== undefined && task.recoveryDeadlineAt <= now()
        if (!recoveryDue && !disabled && !expired && !task.stopped &&
          Math.max(actionUntil, await store.blockedUntil(task.account.key, '*', now())) > now()) continue
        if (!disabled && !expired && !task.stopped && task.state !== 'verifying' && !snapshot.tasks.every(p => canRunBesideUnknown(task, p, now()))) continue
        if (!disabled && !expired && task.state !== 'verifying' && !task.stopped) {
          if (task.feature === 'comments' && schedule!.slots.some(s => s.features.includes('posts')) &&
            !schedule!.commentsActivatedAt && !snapshot.tasks.some(t => t.account.key === task.account.key && t.publishedAt)) {
            const posts = snapshot.tasks.filter(t => t.account.key === task.account.key && t.feature === 'posts' && t.day === task.day)
            if (posts.length && posts.every(t => terminal(t)) && posts.some(t => t.reason === ACTION_SKIPPED)) {
              task.state = 'completed'; task.reason = 'comments_post_skipped'; task.updatedAt = now()
              task.summary = { completed: 0, skipped: 1, unconfirmed: 0 }
              await persist(task, entry(task, task.reason, 'Комментарии пропущены: публикацию не удалось подтвердить, пост пропущен после ошибки сервиса.'))
              continue
            }
            if (task.reason !== 'waiting_for_post') {
              task.reason = 'waiting_for_post'; task.updatedAt = now()
              await persist(task, entry(task, task.reason, 'Комментарии ждут подтверждённый пост.'))
            }
            continue
          }
          const window = windowFor(schedule!, task.feature, now(), Boolean(task.startedAt || task.runId))
          // The slot restricts new starts. A saved continuation keeps its original
          // deadline and provider wait; ending the slot must not park it for a week.
          if ((!task.startedAt || task.feature === 'comments') && (!window || window.start > now())) {
            if (task.day !== dateMsk(now()) && !task.runId) { task.state = 'stopped'; task.stopped = true }
            else { task.nextAt = window?.start ?? now() + 86_400_000; task.state = 'waiting' }
            await persist(task, entry(task, 'outside_slot', 'Ожидаем разрешённое время.')); continue
          }
        }
        if ([...running.values()].some(r => !r.released && r.task.account.key === task.account.key)) continue
        dueAccounts.add(task.account.key); busy.add(task.account.key); void advance(task, schedule)
      }
      if (now() >= pruneAt) { await store.pruneLogs(now() - 30 * 86_400_000); pruneAt = now() + 86_400_000 }
    } catch (error) { lastError = describeFailure(error); epoch = undefined; available = false
      for (const item of running.values()) item.signal.abort('lease_lost')
      rememberIncident({ at: now(), ...lastError })
    } finally { scanning = false }
  }
  const timer = options.autoStart === false ? undefined : setInterval(() => void tick(), 5000)
  timer?.unref()
  return {
    tick, assertOwner, recordEvent: rememberIncident,
    backgroundAllowed(key: string) {
      if ((actionPauses.get(key) ?? 0) > now()) return false
      if ([...running.values()].some(r => r.task.account.key === key && !r.released)) return false
      return !dueAccounts.has(key) || [...running.values()].some(r => r.task.account.key === key && r.released)
    },
    suspend(error: unknown, stage = 'Внешний цикл оркестратора') {
      lastError = describeFailure(error); epoch = undefined; available = false
      rememberIncident({ at: now(), ...lastError, operation: 'orchestrator_suspend', stage, version: options.version })
      for (const item of running.values()) item.signal.abort('lease_lost') },
    async idle() { await Promise.all([...running.values()].map(r => r.work)) },
    async status() {
      const snapshot = available ? await store.snapshot() : { schedules: [], tasks: [] }
      const waits = new Map<string, { provider: number; action: number }>(), cooldowns = await (available ? store.cooldowns?.() : undefined)
      await Promise.all([...new Set(snapshot.tasks.filter(t => !terminal(t)).map(t => t.account.key))].map(async key => {
        const until = (method: string) => Math.max(0, ...(cooldowns ?? []).filter(c =>
          [key, '*'].includes(c.account) && (c.method === method || (method !== 'action' && c.method === '*'))).map(c => c.until))
        waits.set(key, { provider: cooldowns ? until('*') : await store.blockedUntil(key, '*', now()),
          action: cooldowns ? until('action') : await store.blockedUntil(key, 'action', now()) })
      }))
      const tasks = snapshot.tasks.map(task => {
        if (terminal(task)) return task
        const wait = waits.get(task.account.key)!, active = running.get(task.id)
        const other = [...running.values()].find(r => r.task.account.key === task.account.key && r.task.id !== task.id && !r.released)
        const unknown = snapshot.tasks.find(p => !canRunBesideUnknown(task, p, now()))
        const waitReason = wait.provider > now() ? 'unipile_shared_cooldown' : other ? 'linkedin_operation_active' :
          wait.action > now() ? 'action_pause' : unknown ? 'pending_verification' :
          active?.released ? 'generating_or_waiting' : task.nextAt > now() ? (task.reason ?? 'saved_pause') : task.reason
        return { ...task, waitReason, blockingTaskId: other?.task.id ?? unknown?.id,
          effectiveNextAt: Math.max(task.nextAt, wait.provider, wait.action), stage: active?.task.stage ?? task.stage,
          stageMessage: active?.task.stageMessage ?? task.stageMessage }
      })
      return { available, isOwner: epoch !== undefined, ownerId: owner, error: lastError, ...snapshot, tasks }
    },
    history: store.history.bind(store),
    async saveSchedule(value: Schedule, expectedVersion: number) {
      validateSchedule(value)
      const previous = (await store.snapshot()).schedules.find(s => s.account.id === value.account.id)
      if ((previous?.version ?? 0) !== expectedVersion) throw fail('automation_version_conflict')
      // Transfer old scheduler ownership before making new automatic work runnable.
      // A failed transfer may pause old scheduling, but must never enable two schedulers.
      if (value.enabled) await options.transfer?.(value)
      const saved = await store.schedule({ ...value, updatedAt: now() }, expectedVersion)
      if (saved.enabled && epoch !== undefined) {
        const tasks = (await store.snapshot()).tasks
        const movable = tasks.filter(t => t.account.id === saved.account.id && t.day === dateMsk(now()) &&
          !t.runId && ['planned', 'waiting', 'stopped'].includes(t.state))
        const fresh = plan(saved, tasks.filter(t => !movable.some(m => m.id === t.id)), now(), random)
        for (const old of movable) {
          const next = fresh.find(t => t.id === old.id)
          if (next && previous && JSON.stringify(previous.slots) === JSON.stringify(saved.slots) && old.plannedAt >= now()) {
            next.plannedAt = old.plannedAt; next.nextAt = Math.max(old.plannedAt, old.nextAt)
          }
          if (next) await persist({ ...next, version: old.version }, entry(next, 'rescheduled', 'Время обновлено после изменения расписания.'))
        }
      }
      for (const current of running.values()) if (current.task.account.id === value.account.id &&
        (!value.enabled || !value.slots.some(s => s.features.includes(current.task.feature)))) current.signal.abort('disabled')
      await options.changed?.(saved); return saved
    },
    async resume(id: string) {
      await assertOwner(); const snapshot = await store.snapshot(), task = snapshot.tasks.find(t => t.id === id)
      if (!task || (!['stopped', 'needs_attention'].includes(task.state) && !(task.stopped && task.state === 'verifying')))
        throw fail('automation_resume_invalid')
      const schedule = snapshot.schedules.find(s => s.account.id === task.account.id)
      if (running.has(id) || !schedule?.enabled ||
        !schedule.slots.some(s => s.features.includes(task.feature)) || task.day !== dateMsk(now()) ||
        (task.deadlineAt && task.deadlineAt <= now()) || task.activeMs >= task.activeLimitMs) throw fail('automation_resume_invalid')
      task.stopped = false
      task.stopApplied = false
      task.state = 'waiting'; task.nextAt = Math.max(now(), Number.isFinite(task.nextAt) ? task.nextAt : 0); task.reason = undefined
      task.retryRequested = true
      await persist(task, entry(task, 'resumed', 'Продолжение разрешено администратором.'))
    },
    async close() {
      closing = true; if (timer) clearInterval(timer)
      for (const value of running.values()) value.signal.abort('shutdown')
      await Promise.all([...running.values()].map(r => r.work))
      if (epoch !== undefined) await store.release(owner, epoch).catch(() => undefined)
      epoch = undefined
    }
  }
}
export type Orchestrator = ReturnType<typeof createOrchestrator>
