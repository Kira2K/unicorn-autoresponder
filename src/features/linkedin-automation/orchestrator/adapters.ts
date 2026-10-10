import * as requestControl from '../../../integrations/unipile/request-control.ts'
import type { createConnectionInviterService } from '../connection-inviter/service.ts'
import type { PostWriterService } from '../post-writer/service.ts'
import type { Adapters, StepContext } from './contracts.ts'
import { fail } from './contracts.ts'
import { dateMsk } from './planner.ts'
import type { ExecutionStep } from '../execution-step.ts'
const { withRequestContext, requestContext } = (requestControl as any).default ?? requestControl

export type Services = {
  identity?(account: number): Promise<{ unipileId: string; key: string }>
  inviter: ReturnType<typeof createConnectionInviterService>
  posts: PostWriterService
  comments: {
    prepareManaged(account: number, key: string, publishedAt?: number): Promise<{ jobId: string; expiresAt: string; state: { automationId?: string } }>
    stepManaged(id: string, stop?: boolean, cooperate?: StepContext['cooperate'], verifyOnly?: boolean): Promise<ExecutionStep>
    resumeManaged(id: string): Promise<void>
  }
}
export function createFeatureAdapters(services: Services): Adapters {
  const identity = async (ctx: StepContext) => {
    if (!services.identity) return
    const value = await services.identity(ctx.task.account.id)
    if (value.unipileId !== ctx.task.account.unipileId || value.key !== ctx.task.account.key)
      throw fail('automation_account_changed')
  }
  const scope = async <T>(ctx: StepContext, action: () => Promise<T>, stopping = false): Promise<T> => {
    // Stopping saved local work must remain possible after an account is disconnected.
    if (!stopping) await identity(ctx)
    return withRequestContext({
    taskId: ctx.task.id, runId: ctx.task.runId, account: ctx.task.account.unipileId, feature: ctx.task.feature,
    initiator: stopping ? 'recovery' : 'schedule',
    // Stop is local cleanup only. Even accidental read-back is fenced at HTTP dispatch.
    signal: stopping ? AbortSignal.abort('disabled') : ctx.signal, waitForRequest: ctx.waitForRequest,
    assertWrite: async () => { await identity(ctx); await ctx.assertWrite() } }, action) as Promise<T>
  }
  const estimates = async (task: StepContext['task']) => {
    if (task.feature === 'invitations') {
      const value = await services.inviter.readiness(task.account.id)
      const latest = value.latest
      // Upper pacing bound plus profile/read-back budget for the remaining saved daily quota.
      return latest ? Math.max(0, (latest.dailyQuota ?? latest.dailyLimit ?? 0) - latest.counters.sent) * 210_000 : 180 * 60_000
    }
    if (task.feature === 'withdrawals') {
      const value = await services.inviter.withdrawals?.status(task.account.id)
      return value ? Math.max(0, value.total - value.withdrawn - value.skipped) * 20_000 + 60_000 : 20 * 60_000
    }
    return task.feature === 'comments' ? 30 * 90_000 : 30 * 60_000
  }
  const invitations = async (ctx: StepContext, stop = false) => scope(ctx, async () => {
    if (!ctx.task.runId) {
      if (stop) return { status: 'stopped' as const }
      await ctx.stage?.('invitation_prepare', 'Приглашения: сверяем сохранённый прогон и дневную норму.')
      const run = await services.inviter.start(ctx.task.account.id, {}, ctx.task.id)
      await ctx.bind(run.runId); requestContext().runId = run.runId
    }
    const stopNow = () => { if (['disabled', 'deadline'].includes(ctx.signal.reason))
      void services.inviter.stopRun(ctx.task.runId!).catch(() => undefined) }
    ctx.signal.addEventListener('abort', stopNow, { once: true })
    try { return await services.inviter.stepManaged(ctx.task.runId!, stop || ctx.signal.aborted, ctx.cooperate) }
    finally { ctx.signal.removeEventListener('abort', stopNow) }
  }, stop)
  const posts = async (ctx: StepContext, stop = false) => scope(ctx, async () => {
    if (!ctx.task.runId) {
      if (stop) return { status: 'stopped' as const }
      await ctx.stage?.('post_prepare', ctx.task.postPolicy?.contentMode === 'prepared'
        ? `Посты: ищем готовый текст на ${ctx.task.day}.${ctx.task.postPolicy.generateIfMissing ? ' Если текста нет, создадим новый из CV или по стеку.' : ''}`
        : 'Посты: готовим новый текст из CV, а при его отсутствии — по стеку.')
      const run = await services.posts.prepareManaged(ctx.task.account.id, ctx.task.day, ctx.task.id, ctx.task.postPolicy)
      await ctx.bind(run.id); requestContext().runId = run.id
    }
    const stopNow = () => { if (['disabled', 'deadline'].includes(ctx.signal.reason))
      void services.posts.action(ctx.task.runId!, 'stop').catch(() => undefined) }
    ctx.signal.addEventListener('abort', stopNow, { once: true })
    try {
      const result = await services.posts.stepManaged(ctx.task.runId!, stop || ctx.signal.aborted, ctx.cooperate)
      if ('warning' in result && result.warning) {
        if (ctx.task.reason !== result.warning.code)
          await ctx.stage?.(result.warning.code, `Предупреждение: ${result.warning.message}`)
        return { ...result, reason: result.reason ?? result.warning.code }
      }
      return result
    }
    finally { ctx.signal.removeEventListener('abort', stopNow) }
  }, stop)
  const comments = async (ctx: StepContext, stop = false): Promise<ExecutionStep> => scope(ctx, async () => {
    if (stop) return ctx.task.runId ? services.comments.stepManaged(ctx.task.runId, true) : { status: 'stopped' }
    if (ctx.task.runId && ctx.task.day < dateMsk(ctx.now()))
      return services.comments.stepManaged(ctx.task.runId, false, ctx.cooperate, true)
    const publishedAt = Math.max(0, ...(await services.posts.get(ctx.task.account.id)).runs
      .filter(run => run.status === 'published').map(run => run.publishedAt ?? 0))
    const job = await services.comments.prepareManaged(ctx.task.account.id, `automation:${ctx.task.account.key}`, publishedAt)
    await ctx.stage?.('comments_check', 'Комментарии: проверяем сессию, предыдущие ответы и новые комментарии.')
    if (ctx.task.runId !== job.jobId) await ctx.bind(job.jobId)
    const result = await services.comments.stepManaged(job.jobId, ctx.signal.aborted, ctx.cooperate)
    // Session completion is a boundary, not the end of continuous monitoring.
    return result.status === 'completed' ? { ...result, status: 'waiting', nextActionAt:
      new Date(Math.max(ctx.now() + 1000, Date.parse(job.expiresAt))).toISOString(), reason: 'session_finished' } : result
  }, stop)
  const withdrawals = async (ctx: StepContext, stop = false) => scope(ctx, async () => {
    const service = services.inviter.withdrawals
    if (!service?.startAutomatic || !service.stepManaged) throw fail('automation_withdrawal_adapter_missing')
    if (!ctx.task.runId) {
      if (stop) return { status: 'stopped' as const }
      await ctx.stage?.('withdrawal_prepare', 'Отзыв: получаем список и выбираем приглашения строго старше 14 суток.')
      const run = await service.startAutomatic(ctx.task.account.id, ctx.task.id)
      await ctx.bind(run.id); requestContext().runId = run.id
    }
    return service.stepManaged(ctx.task.account.id, ctx.task.runId!, stop || ctx.signal.aborted)
  }, stop)
  return Object.fromEntries(Object.entries({ invitations, posts, comments, withdrawals })
    .map(([name, step]) => [name, { estimate: estimates, step: (ctx: StepContext) => step(ctx),
      resume: (ctx: StepContext) => scope(ctx, async () => {
        if (!ctx.task.runId) return
        if (name === 'posts') await services.posts.resumeManaged(ctx.task.runId)
        else if (name === 'comments') await services.comments.resumeManaged(ctx.task.runId)
        else if (name === 'invitations') await services.inviter.resumeManaged(ctx.task.runId)
        else if (name === 'withdrawals') {
          if (!services.inviter.withdrawals?.resumeManaged) throw fail('automation_withdrawal_adapter_missing')
          await services.inviter.withdrawals.resumeManaged(ctx.task.account.id, ctx.task.runId)
        }
      }),
      stop: (ctx: StepContext) => step(ctx, true) }])) as unknown as Adapters
}
