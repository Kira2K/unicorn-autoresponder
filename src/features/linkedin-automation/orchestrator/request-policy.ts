import type { RequestPolicy, RequestContext, RequestInfo } from '../../../integrations/unipile/request-control.ts'
import type { Store, Task, Event, Feature } from './contracts.ts'
import { fail } from './contracts.ts'
import { canRunBesideUnknown } from './planner.ts'
import { describeFailure } from './failure.ts'
import { createAccountRequestQueue } from '../../../integrations/unipile/request-scheduler.ts'
import { safeUnipileDiagnostics, safeUnipileResponseShape } from '../../../integrations/unipile/error-diagnostics.ts'

const stages: Record<string, string> = {
  account_check: 'Проверка подключения аккаунта', own_profile_read: 'Проверка своего профиля',
  profile_read: 'Проверка профиля кандидата', profile_write: 'Изменение профиля',
  search_parameters: 'Подготовка поиска', people_search: 'Поиск кандидатов', connections_read: 'Чтение списка контактов',
  invitations_read: 'Сверка отправленных приглашений', invitation_send: 'Отправка приглашения',
  invitation_withdraw: 'Отзыв приглашения', posts_read: 'Проверка постов', post_send: 'Публикация поста',
  comments_read: 'Чтение комментариев и проверка ответов', comment_send: 'Отправка комментария',
  likes_read: 'Проверка лайка', like_send: 'Отправка лайка'
}

export function createRequestPolicy(options: { store: Store; assertOwner(): Promise<void>;
  resolveKey?(unipileId: string): string | undefined;
  accountInfo?(unipileId: string): { accountId: number; studentId: number } | undefined;
  onAccountAuthFailure?(unipileId: string, code: string): Promise<void>;
  version?: string; now?: () => number; random?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onFailure(error: unknown): void }): RequestPolicy {
  const now = options.now ?? Date.now, { store } = options
  const queue = createAccountRequestQueue({ now, random: options.random, sleep: options.sleep })
  async function guarded<T>(action: () => Promise<T>) {
    try { return await action() } catch (error) { options.onFailure(error); throw error }
  }
  function scope(info: RequestInfo, ctx?: RequestContext) { return info.account ?? ctx?.account ?? '*' }
  function audit(info: RequestInfo, ctx: RequestContext | undefined, code: string, message: string): Event {
    return { at: now(), ...options.accountInfo?.(scope(info, ctx)), taskId: ctx?.taskId, feature: ctx?.feature ?? info.operation,
      operation: info.route ?? `${info.method} ${info.operation}`, requestId: info.requestId, runId: ctx?.runId,
      stage: info.stage ? stages[info.stage] ?? info.stage : undefined,
      actionId: ctx?.actionId, initiator: ctx?.initiator, version: options.version,
      durationMs: info.startedAt === undefined ? undefined : Math.max(0, now() - info.startedAt), source: 'Unipile', code,
      message: info.stage && stages[info.stage] ? `${stages[info.stage]}. ${message}` : message }
  }
  return {
    queue: (info, ctx, prepare, action) => queue.run(options.resolveKey?.(scope(info, ctx)) ?? scope(info, ctx), action, {
      prepare, signal: ctx?.signal, waitForRequest: ctx?.waitForRequest,
      onWait: until => guarded(() => store.event({ ...audit(info, ctx, 'request_queue_wait',
        'Пауза между запросами аккаунта.'), nextAt: until }))
    }),
    async before(info, ctx) {
      if (ctx?.signal?.aborted) throw Object.assign(fail('automation_stop_requested'), { notSent: true })
      await ctx?.assertRequest?.()
      const account = scope(info, ctx)
      if (info.write || ctx?.taskId) await guarded(options.assertOwner)
      const until = await guarded(() => store.blockedUntil(options.resolveKey?.(account) ?? account, info.route ?? '*', now()))
      if (until > now()) throw Object.assign(fail('unipile_shared_cooldown', 'Сохранённое ожидание Unipile.', until),
        { notSent: true, details: { retryAt: until, retryAfterMs: until - now(), observedAt: now(), httpStatus: 429 } })
      if (!info.write) {
        if (ctx?.signal?.aborted) throw Object.assign(fail('automation_stop_requested'), { notSent: true })
        await guarded(() => store.event(audit(info, ctx, 'request_prepared', 'Чтение подготовлено; запрос ещё не отправлен.')))
        if (ctx?.signal?.aborted) throw Object.assign(fail('automation_stop_requested'), { notSent: true })
        await ctx?.assertRequest?.()
        return
      }
      if (ctx?.signal?.aborted) throw Object.assign(fail('automation_stop_requested'), { notSent: true })
      await ctx?.assertWrite?.()
      const snapshot = await guarded(() => store.snapshot())
      const schedule = snapshot.schedules.find(s => s.account.unipileId === account)
      const actualKey = options.resolveKey?.(account) ?? schedule?.account.key ?? `unipile:${account}`
      const feature = ctx?.feature ?? (['posts', 'comments', 'likes'].includes(info.operation) ? info.operation : 'invitations')
      const pending = snapshot.tasks.filter(t => t.account.key === actualKey || t.account.unipileId === account)
      const own = pending.find(t => t.id === ctx?.taskId)
      const candidate = own ?? { id: ctx?.taskId ?? 'manual', account: { key: actualKey }, feature } as Task
      if (!pending.every(task => canRunBesideUnknown(candidate, task, now())))
        throw Object.assign(fail('linkedin_operation_active', 'Ожидаем проверки предыдущей отправки.', now() + 60_000), { notSent: true })
      await guarded(() => store.event(audit(info, ctx, 'request_prepared', 'Изменение подготовлено; запрос ещё не отправлен.')))
      await guarded(options.assertOwner)
      if (ctx?.signal?.aborted) throw Object.assign(fail('automation_stop_requested'), { notSent: true })
      await ctx?.assertWrite?.()
      await ctx?.assertRequest?.()
    },
    async dispatched(info, ctx) {
      await guarded(() => store.event(audit(info, ctx, 'request_started', 'Запрос передан HTTP-клиенту Unipile.')))
    },
    async blocked(info, error, ctx) {
      const detail = describeFailure(error)
      await guarded(() => store.event({ ...audit(info, ctx, 'request_not_sent', `Запрос не отправлен: ${detail.message}`),
        diagnostic: detail.code }))
    },
    async succeeded(info, status, ctx) {
      await guarded(() => store.event({ ...audit(info, ctx, 'request_succeeded', 'Получен успешный ответ Unipile; результат проверяет фича.'), httpStatus: status }))
    },
    async failed(info, error: any, ctx) {
      const deadline = Number(error?.details?.retryAt), status = Number(error?.details?.httpStatus)
      const detail = describeFailure(error)
      const provider = safeUnipileDiagnostics(status, { req_id: error?.details?.requestId,
        title: error?.details?.providerTitle, message: error?.details?.providerMessage,
        type: error?.details?.errorType, detail: error?.details?.providerDetail ?? error?.details?.diagnostic },
        { requestPath: error?.details?.requestPath })
      const diagnostic = [provider.requestId && `Unipile req_id=${provider.requestId}`,
        provider.requestPath && `${info.method} ${provider.requestPath}`,
        provider.errorType, provider.providerTitle && `title: ${provider.providerTitle}`,
        provider.providerMessage && `message: ${provider.providerMessage}`,
        provider.providerDetail ?? provider.diagnostic,
        safeUnipileResponseShape(error?.details?.responseShape), detail.diagnostic].filter(Boolean).join('\n') || undefined
      const failureText = `${Number.isInteger(status) ? `HTTP ${status}. ` : ''}${
        provider.providerDetail ?? provider.providerMessage ?? provider.providerTitle ?? detail.message}`
      if (error?.code === 'unipile_provider_invalid_authorization')
        await guarded(async () => { await options.onAccountAuthFailure?.(scope(info, ctx), error.code) })
      if (!Number.isFinite(deadline) && status !== 429) {
        await guarded(() => store.event({ ...audit(info, ctx, detail.code, failureText), httpStatus: detail.httpStatus,
          diagnostic }))
        return
      }
      const providerDeadline = Number.isFinite(deadline)
      const until = providerDeadline ? deadline : now() + 90_000
      // V2 counts every Methods API route independently, including its "All methods" rule.
      // Provider/unknown errors retain the conservative account-wide cooldown.
      const routeLimited = status === 429 && provider.errorType === 'api/too_many_requests' && Boolean(info.route)
      await guarded(async () => {
        const account = scope(info, ctx)
        await store.cooldown({ account: options.resolveKey?.(account) ?? account, method: routeLimited ? info.route! : '*', until,
          observedAt: Number(error?.details?.observedAt) || now(), code: String(error?.code ?? 'unipile_rate_limit') })
        await store.event({ ...audit(info, ctx, detail.code, failureText + ' ' + (
          routeLimited ? 'Срок ожидания сохранён для этого API-метода. Остальные методы работают независимо.' :
          error?.details?.retryAfterSource === 'fallback' ?
            'Наша пауза после сбоя сервиса. Все фичи аккаунта ждут указанного времени.' :
          providerDeadline ? 'Unipile назначил ожидание. Новые запросы этого аккаунта ждут общего срока.' :
            'Unipile ограничил запросы, срок не указан. Назначена наша пауза 90 секунд.')), nextAt: until, httpStatus: status, diagnostic })
      })
    }
  }
}
