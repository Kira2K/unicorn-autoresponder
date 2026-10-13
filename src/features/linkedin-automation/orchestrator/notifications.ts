import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Event, Snapshot, Task } from './contracts.ts'
import { terminal } from './contracts.ts'
import { dateMsk } from './planner.ts'
import { createTelegramBotApi } from '../../../integrations/telegram/bot-api.ts'

export type FeatureReport = { target?: number; postUrl?: string; checkedAt?: string;
  likes?: { confirmed: number; pending: number; unconfirmed: number; failed: number } }
export type NoticeReceipt = { status: 'sending' | 'sent' | 'retry' | 'failed' | 'unknown';
  at: number; nextAt?: number; messageId?: number; code?: string; text: string }
export interface NoticeStore {
  claimNotice(taskId: string, key: string, value: NoticeReceipt, owner: string, epoch: number): Promise<boolean>
  finishNotice(taskId: string, key: string, value: NoticeReceipt, owner: string, epoch: number): Promise<void>
  owned(owner: string, epoch: number, now: number): Promise<void>
}
/** Optional local config is ignored by Git; deployments can use environment variables instead. */
export function notificationConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.LINKEDIN_AUTOMATION_TELEGRAM_ENABLED === '0') return undefined
  let file: { chatId?: string; since?: string; token?: string } = {}
  if (!env.LINKEDIN_AUTOMATION_TELEGRAM_CHAT_ID) {
    try { file = JSON.parse(readFileSync(resolve('storage/linkedin-automation-notifications.json'), 'utf8')) }
    catch (error: any) { if (error?.code !== 'ENOENT') throw new Error('telegram_notifications_config_invalid') }
  }
  const chatId = env.LINKEDIN_AUTOMATION_TELEGRAM_CHAT_ID ?? file.chatId
  if (!chatId) return undefined
  const since = Date.parse(env.LINKEDIN_AUTOMATION_TELEGRAM_SINCE ?? file.since ?? '')
  const token = env.LINKEDIN_AUTOMATION_TELEGRAM_TOKEN ?? file.token ?? env.VEU_SUPPORT_BOT
  if (!/^-\d+$/.test(chatId) || !Number.isFinite(since) || since <= 0 || !token?.trim())
    throw new Error('telegram_notifications_config_invalid')
  return { chatId, since, token }
}
export const featureNames = { invitations: 'Приглашения', posts: 'Публикация', comments: 'Комментарии',
  feed: 'Лента', withdrawals: 'Отзыв приглашений' }
export function postReport(run?: import('../post-writer/types.ts').PostRun): FeatureReport | undefined {
  if (!run) return undefined
  const items = run.engagement.items
  return { postUrl: run.url, likes: { confirmed: items.filter(i => i.status === 'sent').length,
    pending: items.filter(i => ['pending', 'sending', 'uncertain'].includes(i.status) && !i.verificationStopped).length,
    unconfirmed: items.filter(i => ['sending', 'uncertain'].includes(i.status) && i.verificationStopped).length,
    failed: items.filter(i => ['failed', 'cancelled'].includes(i.status)).length } }
}
const clock = (at: number) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at)
const safe = (value: unknown, max = 250) => String(value ?? '').replace(/[\r\n\u0000-\u001f]/g, ' ')
  .replace(/(?:https?:\/\/)?[^\s]*bot\d+:[^\s]+/gi, '[скрыто]')
  .replace(/\b(?:password|token|api_key|cookie|authorization)\s*[:=]\s*\S+/gi, '[скрыто]')
  .slice(0, max)
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
const checkedToday = (task: Task, now: number) => Boolean(task.report?.checkedAt &&
  Number.isFinite(Date.parse(task.report.checkedAt)) && dateMsk(Date.parse(task.report.checkedAt)) === dateMsk(now))
const countsFor = (task: Task) => task.summary && task.feature === 'comments' && task.commentBaseline
  ? { ...task.summary, completed: Math.max(0, task.summary.completed - task.commentBaseline.completed),
    skipped: Math.max(0, task.summary.skipped - task.commentBaseline.skipped) } : task.summary
function postUrl(value?: string) {
  try { const url = new URL(value!); return url.protocol === 'https:' &&
    /(^|\.)linkedin\.com$/.test(url.hostname) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}

/** Only saved plans are shown. A dependency is never converted into an invented start time. */
export function remainingToday(task: Task, snapshot: Snapshot, now: number) {
  const schedule = snapshot.schedules.find(s => s.account.key === task.account.key)
  const tasks = snapshot.tasks.filter(t => t.account.key === task.account.key && t.day === dateMsk(now) &&
    !terminal(t) && !t.stopped && schedule?.enabled && schedule.slots.some(s => s.features.includes(t.feature)) &&
    !(t.feature === 'comments' && checkedToday(t, now)))
    .sort((a, b) => a.plannedAt - b.plannedAt)
  const rows = tasks.map(t => {
    const name = featureNames[t.feature]
    if (t.state === 'running') return `• ${name} — выполняется`
    if (t.state === 'verifying') return `• ${name} — проверяется результат, новых отправок нет`
    const waitsForPost = t.feature === 'comments' && !schedule?.commentsActivatedAt &&
      schedule?.slots.some(s => s.features.includes('posts')) &&
      !snapshot.tasks.some(p => p.account.key === t.account.key && p.publishedAt)
    if (waitsForPost) return `• ${name} — первая проверка после подтверждённой публикации`
    const until = Math.max(t.plannedAt, t.nextAt, ...(snapshot.cooldowns ?? []).filter(c =>
      [t.account.key, '*'].includes(c.account) && c.method === '*').map(c => c.until))
    if (until > now) return `• ${name} — ${until > t.plannedAt ? 'не раньше' : 'план'} ${clock(until)}`
    return `• ${name} — ожидает очереди, точное время пока неизвестно`
  })
  if (snapshot.tasks.some(t => t.account.key === task.account.key && t.day === dateMsk(now) &&
    t.feature === 'comments' && checkedToday(t, now) && !terminal(t) && !t.stopped && schedule?.enabled &&
    schedule.slots.some(s => s.features.includes('comments')))) rows.push('Мониторинг комментариев продолжается.')
  return [`Осталось на сегодня: ${tasks.length}.`, ...rows, 'Время московское.'].join('\n')
}

export function noticeCandidate(task: Task, now: number): { key: string; kind: 'result' | 'pause' | 'comments' | 'likes' } | undefined {
  const counts = countsFor(task)
  if (terminal(task)) return { kind: 'result', key: `result:${digest([task.runId, task.state, task.reason, counts])}` }
  const error = task.lastFailure
  const currentWait = /429|cooldown|rate_limit|too_many_requests/.test(task.reason ?? '') || (error?.nextAt ?? 0) > now
  if (error && currentWait && (error.httpStatus === 429 || /cooldown|rate_limit|too_many_requests/.test(error.code)) && task.nextAt > now)
    return { kind: 'pause', key: `pause:${digest([error.source, error.code, Math.max(task.nextAt, error.nextAt ?? 0)])}` }
  if (task.feature === 'comments' && checkedToday(task, now) && counts &&
    (counts.completed || counts.skipped || counts.unconfirmed))
    return { kind: 'comments', key: `comments:${digest([task.runId, counts])}` }
}

export function formatNotice(task: Task, snapshot: Snapshot, now: number, kind: 'result' | 'pause' | 'comments' | 'likes') {
  const s = countsFor(task), r = task.report, e = task.lastFailure
  const partial = task.state === 'needs_attention' || !!(s?.skipped || s?.unconfirmed) ||
    (kind === 'likes' && !!(r?.likes?.failed || r?.likes?.unconfirmed))
  const icon = kind === 'pause' ? '⏸' : task.state === 'stopped' ? '⏹' : partial ? '⚠️' : '✅'
  const lines = [`${icon} ${safe(task.account.name, 100)} · LinkedIn · ${kind === 'likes' ? 'Лайки к посту' : featureNames[task.feature]}`,
    `Ученик #${task.account.studentId} · аккаунт #${task.account.id} · ${task.day}`]
  if (kind === 'pause') lines.push('Выполнение на паузе.', `Ограничение запросов — до ${clock(Math.max(task.nextAt, e?.nextAt ?? 0))}.`)
  else if (task.state === 'stopped') lines.push('Прогон остановлен.')
  else if (task.state === 'needs_attention') lines.push('Прогон завершён с проблемой; требуется внимание.')
  else if (kind === 'comments') lines.push('Проверка комментариев завершена. Результат с начала сегодняшнего задания:')
  else lines.push(partial ? 'Выполнено частично.' : 'Завершено.')
  if (s && kind !== 'likes') {
    const label = { invitations: 'Отправлено приглашений', posts: 'Опубликовано постов',
      comments: 'Ответов отправлено', withdrawals: 'Отозвано приглашений старше 21 дня', feed: 'Выполнено действий' }[task.feature]
    lines.push(`${label}: ${s.completed}${r?.target === undefined ? '' : ` из ${r.target}`}.`)
    if (s.skipped) lines.push(`Пропущено: ${s.skipped}.`)
    if (s.unconfirmed) lines.push(`Не подтверждено: ${s.unconfirmed}. Повторной отправки нет.`)
  }
  if (task.feed) {
    lines.push(`Получено карточек: ${task.feed.feed.ids.length}.`,
      `Лайки: ${task.feed.actions.filter(a => a.kind === 'like' && a.state === 'confirmed').length} из 5.`,
      `Комментарии: ${task.feed.actions.filter(a => a.kind === 'comment' && a.state === 'confirmed').length} из 1.`)
  }
  const url = postUrl(r?.postUrl); if (url) lines.push(`Пост: ${url}`)
  if (r?.likes) lines.push(`Лайки к посту: ${r.likes.confirmed} подтверждены, ${r.likes.pending} ожидаются, ` +
    `${r.likes.unconfirmed} не подтверждены, ${r.likes.failed} не выполнены.`)
  if ((partial || kind === 'pause' || s?.skipped) && e) lines.push(`Источник: ${safe(e.source)}.`,
    `Этап: ${safe(e.stage ?? task.stageMessage ?? task.stage ?? 'не указан')}.`,
    `Ошибка: ${e.httpStatus ? `HTTP ${e.httpStatus}, ` : ''}${safe(e.code)}.`, safe(e.message))
  else if (task.state === 'needs_attention' && task.reason) lines.push(`Причина: ${safe(task.reason)}.`)
  lines.push('', remainingToday(task, snapshot, now))
  return lines.join('\n').slice(0, 3900)
}

export function createTelegramNoticeSender(options: { chatId: string; token?: string;
  api?: Pick<ReturnType<typeof createTelegramBotApi>, 'sendMessageResponse'>; now?: () => number }) {
  if (!/^-\d+$/.test(options.chatId)) throw new Error('automation_telegram_chat_invalid')
  const api = options.api ?? createTelegramBotApi({ token: options.token, requestTimeoutMs: 10_000 })
  return async (text: string): Promise<Omit<NoticeReceipt, 'at' | 'text'>> => {
    try {
      const value: any = await api.sendMessageResponse({ chatId: options.chatId, text })
      if (value?.ok === true && Number.isSafeInteger(value.result?.message_id) &&
        String(value.result?.chat?.id) === options.chatId) return { status: 'sent', messageId: value.result.message_id }
      if (value?.ok === false && value.error_code === 429) return { status: 'retry', code: 'telegram_429',
        nextAt: (options.now ?? Date.now)() + Math.max(1, Number(value.parameters?.retry_after) || 60) * 1000 }
      if (value?.ok === false && value.error_code >= 400 && value.error_code < 500)
        return { status: 'failed', code: `telegram_${Number(value.error_code)}` }
      return { status: 'unknown', code: 'telegram_response_unknown' }
    } catch { return { status: 'unknown', code: 'telegram_delivery_unknown' } }
  }
}

/** Sending is detached from the feature loop. Receipt is durable BEFORE the Telegram POST.
 * An ambiguous delivery is never resent automatically: Bot API has no idempotency key.
 */
export function createNotifications(options: { store: NoticeStore; since: number; chatId: string;
  send(text: string): Promise<Omit<NoticeReceipt, 'at' | 'text'>>; now?: () => number;
  failure?(task: Task): Promise<Event | undefined>;
  postReport?(task: Task): Promise<FeatureReport | undefined>; report?(event: Event): void }) {
  const now = options.now ?? Date.now
  let active: Promise<void> | undefined, closed = false, nextAt = 0
  const postChecks = new Map<string, number>()
  const failures = new Map<string, { at: number; event?: Event }>()
  async function run(snapshot: Snapshot, owner: string, epoch: number) {
    if (closed || now() < nextAt) return
    nextAt = now() + 5000
    const allReceipts = snapshot.tasks.flatMap(t => Object.values(t.notices ?? {}))
    const retryAt = Math.max(0, ...allReceipts.filter(r => r.status === 'retry').map(r => r.nextAt ?? 0))
    nextAt = Math.max(nextAt, retryAt)
    if (retryAt > now()) return
    for (const saved of snapshot.tasks) {
      if (closed) return
      if (saved.day < dateMsk(options.since) || saved.updatedAt < options.since) continue
      let task = saved
      const prefix = `${options.chatId}:`, receipts = task.notices ?? {}
      const interrupted = Object.entries(receipts).find(([key, value]) => key.startsWith(prefix) && value.status === 'sending')
      if (interrupted) {
        await options.store.finishNotice(task.id, interrupted[0], { ...interrupted[1], status: 'unknown',
          code: 'telegram_delivery_interrupted' }, owner, epoch)
        options.report?.({ at: now(), taskId: task.id, accountId: task.account.id, studentId: task.account.studentId,
          feature: task.feature, source: 'Telegram', code: 'telegram_delivery_interrupted', stage: 'Отправка отчёта',
          message: 'После перезапуска найдена незавершённая доставка отчёта. Повтор отключён, чтобы не создать дубль.' })
        return
      }
      const original = noticeCandidate(task, now())
      if (original?.kind === 'result' && receipts[prefix + original.key] && receipts[prefix + original.key].status !== 'retry' &&
        !(task.feature === 'posts' && task.publishedAt && task.report?.likes?.pending &&
          !Object.keys(receipts).some(k => k.startsWith(prefix + 'likes:')))) continue
      if (options.failure && (!task.lastFailure?.httpStatus) && (task.state === 'needs_attention' || task.summary?.skipped ||
        task.summary?.unconfirmed || /429|too_many_requests|rate_limit|shared_cooldown/.test(task.reason ?? ''))) {
        let cached = failures.get(task.id)
        if (!cached || now() >= cached.at + 60_000) {
          cached = { at: now(), event: await options.failure(task) }; failures.set(task.id, cached)
        }
        const failure = cached.event
        if (failure) task = { ...task, lastFailure: failure }
      }
      let candidate = noticeCandidate(task, now())
      if (candidate && receipts[prefix + candidate.key] && receipts[prefix + candidate.key].status !== 'retry') candidate = undefined
      if (!candidate && task.feature === 'posts' && task.publishedAt && task.report?.likes?.pending &&
        !Object.keys(receipts).some(k => k.startsWith(prefix + 'likes:')) && now() >= (postChecks.get(task.id) ?? 0)) {
        postChecks.set(task.id, now() + 60_000)
        const report = await options.postReport?.(task)
        if (report?.likes && !report.likes.pending) {
          task = { ...task, report }; candidate = { kind: 'likes', key: `likes:${task.runId}` }
        }
      }
      if (!candidate) continue
      const key = prefix + candidate.key, previous = receipts[key]
      if (previous && (previous.status !== 'retry' || (previous.nextAt ?? 0) > now())) continue
      const receipt: NoticeReceipt = { status: 'sending', at: now(), text: formatNotice(task, snapshot, now(), candidate.kind) }
      if (!await options.store.claimNotice(task.id, key, receipt, owner, epoch)) continue
      await options.store.owned(owner, epoch, now())
      const result = await options.send(receipt.text)
      const finished = { ...receipt, ...result }
      await options.store.finishNotice(task.id, key, finished, owner, epoch)
      if (result.status !== 'sent') options.report?.({ at: now(), taskId: task.id, studentId: task.account.studentId,
        accountId: task.account.id, feature: task.feature, source: 'Telegram', code: result.code ?? 'telegram_delivery_unknown',
        message: result.status === 'retry' ? 'Telegram отклонил отправку: отчёт будет повторён после паузы.' :
          result.status === 'failed' ? 'Telegram отклонил уведомление. Проверьте доступ бота к группе.' :
          'Доставка уведомления не подтверждена. Автоматического повтора нет, чтобы не создать дубль.',
        nextAt: result.nextAt, stage: 'Отправка отчёта' })
      if (result.status === 'retry') nextAt = Math.max(nextAt, result.nextAt ?? 0)
      return // One message per tick, never a burst after an outage.
    }
  }
  return {
    tick(snapshot: Snapshot, owner: string, epoch: number) {
      if (active || closed) return
      active = run(snapshot, owner, epoch).catch(() => {
        nextAt = now() + 60_000
        options.report?.({ at: now(), source: 'Telegram', code: 'telegram_notification_failed',
          message: 'Не удалось сохранить или доставить уведомление. Прогон фичи продолжается.', stage: 'Отправка отчёта' })
      }).finally(() => { active = undefined })
    },
    idle: () => active ?? Promise.resolve(),
    async close() { closed = true; await active }
  }
}
