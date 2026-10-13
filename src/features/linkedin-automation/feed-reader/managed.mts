import { createRequire } from 'node:module'
import { createFeedRun, feedRunSummary, feedRecoveryDeadline, feedResumeBlockedReason, stepFeedRun } from './run.mts'
import type { FeedRun, FeedRunDependencies } from './run.mts'
import type { FeedModel } from './selection.mts'
import type { FeatureAdapter, StepContext } from '../orchestrator/contracts.ts'
import type { ExecutionStep } from '../execution-step.ts'
const { withRequestContext, requestContext } = createRequire(import.meta.url)('../../../integrations/unipile/request-control.ts')
const { describeFailure } = createRequire(import.meta.url)('../orchestrator/failure.ts') as typeof import('../orchestrator/failure.ts')
const stages: Record<string, string> = {
  feed_read: 'Лента: читаем следующую порцию', feed_classify: 'Лента: оцениваем новые карточки',
  feed_selected: 'Лента: выбор постов сохранён', feed_post_prepare: 'Лента: проверяем выбранный пост и доступность действий',
  feed_comment_draft: 'Лента: готовим комментарий', feed_actions: 'Лента: начинаем сохранённые действия',
  feed_like_send: 'Лента: отправляем лайк', feed_like_verify: 'Лента: проверяем результат лайка',
  feed_comment_send: 'Лента: отправляем комментарий', feed_comment_verify: 'Лента: проверяем результат комментария',
  feed_finished: 'Лента: проход завершён', feed_action_expired: 'Лента: срок проверки действия истёк; результат сохранён, повторной отправки не будет'
}
const fail = (code: string) => Object.assign(new Error(code), { code })
export function createManagedFeedAdapter(options: {
  identity(accountId: number): Promise<{ unipileId: string; ownerId: string }>
  history(accountKey: string): Promise<string[]>
  dependencies(context: StepContext): Pick<FeedRunDependencies, 'read' | 'provider'>
  model(context: StepContext): FeedModel
  random?(): number
}): FeatureAdapter {
  const step = async (ctx: StepContext, stop = false): Promise<ExecutionStep> => {
    if (!ctx.stage) throw fail('feed_persistence_missing')
    const identity = async () => {
      const current = await options.identity(ctx.task.account.id)
      if (current.unipileId !== ctx.task.account.unipileId || `linkedin:${current.ownerId}` !== ctx.task.account.key)
        throw fail('automation_account_changed')
      return current
    }
    if (stop && !ctx.task.feed) return { status: 'stopped' }
    if (!stop) await identity()
    let modelClient: FeedModel | undefined
    const model = (): FeedModel => modelClient ??= options.model(ctx)
    // Reject missing model configuration before spending the first feed request.
    if (!stop && !ctx.task.feed) model()
    const save = async (run: FeedRun) => {
      const previous = ctx.task.feed
      ctx.task.feed = structuredClone(run)
      const totals = feedRunSummary(run), action = run.actions.find(a => ['sending', 'verifying', 'ready'].includes(a.state))
      if (requestContext()) requestContext().actionId = action?.key
      const issue = run.actions.find(a => {
        const old = previous?.actions.find(saved => saved.key === a.key)
        return a.error && a.state !== 'confirmed' &&
          (!old || old.error !== a.error || old.httpStatus !== a.httpStatus || old.state !== a.state || old.nextAt !== a.nextAt)
      })
      const readIssue = run.feed.error
      const modelIssue = run.stage === 'feed_classify' ? run.modelError : undefined
      const detail = modelIssue ? { source: 'OpenAI' as const, httpStatus: modelIssue.httpStatus }
        : readIssue && run.stage === 'feed_read' ? { source: readIssue.source === 'Unipile' ? 'Unipile' as const : 'наш код' as const,
          httpStatus: readIssue.httpStatus, diagnostic: readIssue.diagnostic }
        : issue ? { source: describeFailure({ code: issue.error }).source, httpStatus: issue.httpStatus, actionId: issue.key } : undefined
      const stage = run.stage === 'feed_read' && run.feed.phase === 'reading' ? `${stages.feed_read}, запрошено: ${run.feed.count}` +
        (run.feed.batchSize ? `; объём порции: ${run.feed.batchSize}, осталось получить: ${run.feed.batchRemaining}` : '') : stages[run.stage] ?? run.stage
      await ctx.stage!(run.stage, `${stage}. Карточек: ${totals.cards}; лайков: ${totals.likes}/5; комментариев: ${totals.comments}/1; ` +
        `пропущено: ${totals.skipped}; не подтверждено: ${totals.unconfirmed}.` +
        (issue ? ` Действие ${issue.kind}, пост ${issue.cardId}: ${issue.httpStatus ? `HTTP ${issue.httpStatus}, ` : ''}${issue.error}.` : '') +
        (modelIssue ? ` Ошибка оценки карточек: OpenAI, ${modelIssue.code}${modelIssue.httpStatus ? `, HTTP ${modelIssue.httpStatus}` : ''}.` : '') +
        (readIssue ? ` Ошибка чтения ленты: ${readIssue.source}, этап ${readIssue.stage}, ${readIssue.code}` +
          `${readIssue.httpStatus ? `, HTTP ${readIssue.httpStatus}` : ''}${readIssue.diagnostic ? ` (${readIssue.diagnostic})` : ''}.` : ''), detail)
    }
    if (!ctx.task.feed) {
      // History spans completed/stopped tasks as well; daily scheduling never resets deduplication.
      await ctx.assertWrite()
      const own = await identity(), excluded = await options.history(ctx.task.account.key)
      await save(createFeedRun({ id: ctx.task.id, accountId: own.unipileId, ownerId: own.ownerId, now: ctx.now(), excluded }))
      await ctx.bind(ctx.task.id)
    } else if (!ctx.task.runId) await ctx.bind(ctx.task.feed.id)
    const unused = () => { throw new Error('feed_stopped_no_requests') }
    const provider = stop ? { read: unused, provider: { prepare: unused, like: unused, comment: unused, verify: unused } } : options.dependencies(ctx)
    // Client/model creation is lazy: Stop must work even with missing credentials or a disconnected account.
    return withRequestContext({ account: ctx.task.account.unipileId, taskId: ctx.task.id, runId: ctx.task.runId,
      feature: 'feed', initiator: 'schedule', signal: stop ? AbortSignal.abort() : ctx.signal,
      waitForRequest: ctx.waitForRequest, assertWrite: async () => { await identity(); await ctx.assertWrite() } }, async () => {
      const result = await stepFeedRun(ctx.task.feed!, { ...provider, save, now: ctx.now, random: options.random ?? Math.random,
        signal: stop ? AbortSignal.abort() : ctx.signal, assertActive: async () => { await identity(); await ctx.assertWrite() },
        model: { evaluate: input => ctx.cooperate(() => model().evaluate(input)), comment: input => ctx.cooperate(() => model().comment(input)) } })
      const totals = feedRunSummary(result)
      const nextAt = result.nextAt
      const verifying = result.actions.some(a => ['sending', 'verifying'].includes(a.state))
      const status: ExecutionStep['status'] = ['completed', 'stopped', 'needs_attention'].includes(result.phase)
        ? result.phase as 'completed' | 'stopped' | 'needs_attention' : verifying ? 'verifying' : nextAt && nextAt > ctx.now() ? 'waiting' : 'ready'
      return { status, reason: result.reason, nextActionAt: nextAt ? new Date(nextAt).toISOString() : undefined,
        recoveryDeadlineAt: feedRecoveryDeadline(result),
        summary: { completed: totals.likes + totals.comments, skipped: totals.skipped, unconfirmed: totals.unconfirmed } }
    })
  }
  return { estimate: async () => 30 * 60_000, step: ctx => step(ctx), stop: ctx => step(ctx, true),
    resumeBlockedReason: (task, now) => feedResumeBlockedReason(task.feed, now),
    async resume(ctx) {
      const run = ctx.task.feed
      if (!run || !['stopped', 'needs_attention'].includes(run.phase)) return
      if (!ctx.stage) throw fail('feed_persistence_missing')
      const blocked = feedResumeBlockedReason(run, ctx.now())
      if (blocked) throw fail(blocked)
      const current = await options.identity(ctx.task.account.id)
      if (current.unipileId !== run.accountId || current.ownerId !== run.ownerId) throw fail('automation_account_changed')
      if (!run.selection && run.feed.phase === 'needs_attention') {
        // Explicit resume may retry a known failed read, never a lost response/unknown Retry-After.
        run.feed.phase = 'waiting'
      }
      const draft = run.actions.find(a => a.kind === 'comment' && a.state === 'skipped' &&
        a.error === 'feed_comment_invalid' && a.attemptedAt === undefined && !a.commentId)
      if (draft) {
        // Explicit operator recovery may redo local preparation; a sent/unknown comment is never reset.
        draft.state = 'ready'; delete draft.error; delete draft.httpStatus; delete draft.text
      }
      // Resume the same selection and intent ledger; unknown actions never become ready.
      run.phase = !run.selection ? 'collecting' : run.actions.some(a => a.state === 'ready' &&
        (!a.postId || a.kind === 'comment' && !a.text)) ? 'preparing' : 'acting'
      if (!run.selection && run.feed.phase === 'stopped') {
        run.feed.phase = run.feed.cursor ? 'waiting' : run.feed.pages ? 'completed' : 'ready'
      }
      delete run.reason
      await ctx.stage('feed_resume', 'Лента: продолжаем прежний проход, сохраняя выбор, паузы и результаты отправок.')
    }
  }
}
