import { randomUUID } from 'node:crypto'
import type { Preview, Run, Runtime, State, WithdrawalService } from './contracts.ts'
import { classifyInvitations, sameWithdrawalAccount, withdrawalError, withdrawalNeedsCheck, withdrawalPendingResults } from './policy.ts'
import { executeWithdrawal, withdrawalSteps } from './execution.ts'
import type { ExecutionStep } from '../execution-step.ts'
import { recheckWithdrawal } from './recheck.ts'
import { expireWithdrawalRecovery, withdrawalSummary } from './retry.ts'
import { ACTION_SKIPPED, skippedActions, recoveryDeadline } from '../action-recovery.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
const { withRequestContext, requestContext } = (requestControl as any).default ?? requestControl
export function createInvitationWithdrawal(runtime: Runtime): WithdrawalService {
  const originalStore = runtime.store, writes = new Map<number, Promise<void>>()
  runtime = Object.assign(Object.create(runtime), { store: { load: (id: number) => originalStore.load(id), save(id: number, state: State) {
    const snapshot = structuredClone(state)
    const write = (writes.get(id) ?? Promise.resolve()).catch(() => undefined)
      .then(() => originalStore.save(id, snapshot))
    writes.set(id, write); return write
  } } })
  const previews = new Map<number, Preview>(), latest = new Map<number, Run>()
  const activeStates = new Map<number, State>()
  const tasks = new Map<number, Promise<void>>()
  const managed = new Map<number, { state: State; steps: AsyncGenerator<ExecutionStep> }>()
  const stepping = new Set<number>()
  let closed = false
  const copy = <T>(value: T): T => structuredClone(value)
  const busy = () => withdrawalError('withdrawal_busy', 'Для этого аккаунта уже выполняется операция.')
  function assertOpen() { if (closed) throw withdrawalError('withdrawal_closed', 'Сервис остановлен.') }
  async function stateFor(id: number, accountId: string): Promise<State> {
    const state = await runtime.store.load(id)
    if (state && state.accountId !== accountId) throw withdrawalError('withdrawal_account_changed',
      'Аккаунт перепривязан. Сначала проверьте журнал предыдущих отзывов.')
    if (state?.retryAt && state.retryAt > runtime.now()) throw Object.assign(withdrawalError('withdrawal_cooldown',
      `Unipile ограничил запросы. Повторите после ${new Date(state.retryAt).toISOString()}.`),
      { nextAt: state.retryAt, details: { retryAt: state.retryAt } })
    return state ?? { accountId, attempted: [] }
  }
  const service: WithdrawalService = {
    async resumeManaged(id, runId) {
      assertOpen(); runtime.assertWrite(id)
      if (tasks.has(id) || stepping.has(id)) throw busy()
      const state = await runtime.store.load(id), run = state?.run
      if (!state || !run?.automationId || run.id !== runId)
        throw withdrawalError('withdrawal_run_changed', 'Задание изменилось.')
      if (run.status === 'completed') return
      if (!run.targets || !run.approvedAccount || !Number.isInteger(run.cursor))
        throw withdrawalError('withdrawal_targets_missing', 'Список заявок не сохранён. Продолжение невозможно.')
      // No provider requests here. The next step rechecks any in-flight result before continuing.
      run.stopRequested = false; run.status = withdrawalNeedsCheck(run) ? 'uncertain' : 'running'
      await runtime.store.save(id, state)
      const old = managed.get(id); if (old) await old.steps.return(undefined)
      managed.delete(id); latest.set(id, run)
    },
    async startAutomatic(id, key) {
      assertOpen(); runtime.assertWrite(id)
      if (tasks.has(id) || stepping.has(id)) throw busy()
      const account = await runtime.account(id), state = await stateFor(id, account.accountId)
      if (state.run?.id === key) return copy(state.run)
      if (withdrawalNeedsCheck(state.run)) throw withdrawalError('withdrawal_check_required', 'Сначала проверьте предыдущий отзыв.')
      const preview = await service.preview(id)
      const targets = preview.items.filter(item => item.eligible)
      const run: Run = { id: key, automationId: key, platformAccountId: id, accountId: account.accountId,
        status: targets.length ? 'running' : 'completed', total: targets.length, withdrawn: 0, skipped: 0,
        targets, cursor: 0, approvedAccount: account }
      state.run = run; await runtime.store.save(id, state); latest.set(id, run); previews.delete(id)
      return copy(run)
    },
    async stepManaged(id, runId, stop = false) {
      assertOpen(); runtime.assertWrite(id)
      if (tasks.has(id) || stepping.has(id)) throw busy()
      let release: (() => void) | undefined
      stepping.add(id)
      try {
        let current = managed.get(id)
        let state = current?.state ?? await runtime.store.load(id)
        if (!state?.run?.automationId || state.run.id !== runId) throw withdrawalError('withdrawal_run_changed', 'Задание изменилось.')
        const expiredRecovery = expireWithdrawalRecovery(state, runtime.now())
        // Retry a failed expiry checkpoint before allowing any subsequent action.
        if (expiredRecovery || Object.values(state.run.recovery ?? {}).some(value => value.skippedAt !== undefined))
          await runtime.store.save(id, state)
        if (expiredRecovery) {
          if (current) { await current.steps.return(undefined); managed.delete(id); current = undefined }
        }
        if (state.run.recoveryClosed) return { status: 'completed', reason: ACTION_SKIPPED, summary: withdrawalSummary(state), skippedActions: skippedActions(state.run.recovery) }
        const firstStop = stop && !state.run.stopRequested
        if (firstStop) { state.run.stopRequested = true; await runtime.store.save(id, state) }
        const unconfirmed = withdrawalPendingResults(state.run)
        if (state.run.status === 'completed') return { status: 'completed', summary: withdrawalSummary(state) }
        if (state.run.stopRequested) {
          if (current) { await current.steps.return(undefined); managed.delete(id) }
          const due = Math.max(state.retryAt ?? 0, Date.parse(state.run.nextActionAt ?? '') || 0,
            Date.parse(state.run.verificationAt ?? '') || 0, firstStop ? runtime.now() + 60_000 : 0)
          if (unconfirmed && due <= runtime.now()) {
            release = runtime.gate.acquire('invitation_withdrawal_check', runId, String(id))
            await recheckWithdrawal(runtime, id, runId); state = (await runtime.store.load(id))!
          }
          const pending = withdrawalPendingResults(state.run!)
          state.run!.status = 'stopped'
          if (pending) state.run!.nextActionAt = new Date(Math.max(due,
            Date.parse(state.run!.verificationAt ?? '') || runtime.now() + 60_000)).toISOString()
          await runtime.store.save(id, state)
          latest.set(id, state.run!); return pending ? { status: 'verifying',
            nextActionAt: state.run!.nextActionAt, reason: 'withdrawal_result_pending',
            recoveryDeadlineAt: recoveryDeadline(state.run!.recovery), skippedActions: skippedActions(state.run!.recovery) }
            : { status: 'stopped', summary: withdrawalSummary(state), skippedActions: skippedActions(state.run!.recovery) }
        }
        const due = Date.parse(state.run.nextActionAt ?? '') || state.retryAt || 0
        if (due > runtime.now()) return { status: unconfirmed ? 'verifying' : 'waiting',
          nextActionAt: new Date(due).toISOString(), reason: 'saved_pause', recoveryDeadlineAt: recoveryDeadline(state.run.recovery) }
        release = runtime.gate.acquire('invitation_withdrawal', runId, String(id))
        const remaining = () => Boolean(state!.run!.targets && state!.run!.cursor! < state!.run!.total)
        if (!current && (state.run.current || (!remaining() &&
          (state.run.unconfirmed?.some(id => state!.run!.recovery?.[`cancel:${id}`]?.skippedAt === undefined) || (state.run.confirmed?.length && !state.run.checkedAt))))) {
          try { await recheckWithdrawal(runtime, id, runId) }
          catch (error) {
            state = (await runtime.store.load(id))!
            if (state.run!.nextActionAt) return { status: 'verifying', nextActionAt: state.run!.nextActionAt, reason: 'withdrawal_read_retry', recoveryDeadlineAt: recoveryDeadline(state.run!.recovery) }
            throw error
          }
          state = (await runtime.store.load(id))!
          latest.set(id, state.run!)
          if (state.run!.status === 'uncertain' && !remaining()) return { status: 'verifying', nextActionAt: state.run!.nextActionAt }
        }
        const run = state.run!
        if (run.status === 'completed' || run.recoveryClosed) return { status: 'completed', summary: withdrawalSummary(state),
          reason: run.recoveryClosed ? ACTION_SKIPPED : undefined, skippedActions: skippedActions(run.recovery) }
        if (run.stopRequested && !withdrawalNeedsCheck(run)) { run.status = 'stopped'; await runtime.store.save(id, state); return { status: 'stopped' } }
        if (!run.targets || !run.approvedAccount) return { status: 'needs_attention', reason: 'withdrawal_targets_missing' }
        if (!current) {
          run.status = 'running'; await runtime.store.save(id, state)
          current = { state, steps: withdrawalSteps(Object.assign(Object.create(runtime), { cooperative: true }),
            { token: runId, account: run.approvedAccount, items: run.targets, expiresAt: Infinity }, state) }
          managed.set(id, current)
        }
        latest.set(id, run)
        let result: IteratorResult<ExecutionStep>
        try { result = await current.steps.next() }
        catch (error) { managed.delete(id); throw error }
        const step = result.value ?? { status: (run.status as string) === 'completed' ? 'completed' : 'needs_attention' }
        if (result.done || ['completed', 'stopped', 'needs_attention', 'verifying'].includes(step.status) || step.reason === 'withdrawal_step_yield') {
          await current.steps.return(undefined); managed.delete(id)
        }
        return { ...step, skippedActions: skippedActions(run.recovery), recoveryDeadlineAt: run.recoveryClosed ? undefined : recoveryDeadline(run.recovery) }
      } finally { stepping.delete(id); release?.() }
    },
    async preview(id) {
      assertOpen(); runtime.assertRead(id)
      if (tasks.has(id)) throw busy()
      previews.delete(id)
      const account = await runtime.account(id), state = await stateFor(id, account.accountId)
      const protectedSince = await runtime.protectedSince?.(id)
      const items = classifyInvitations(await runtime.provider().list(account.accountId), runtime.now(), state.attempted, protectedSince)
      const preview = { token: randomUUID(), account, items, expiresAt: runtime.now() + 600_000 }
      previews.set(id, preview)
      return { token: preview.token, items: copy(items), writerEnabled: runtime.writable() }
    },
    async start(id, token) {
      assertOpen(); runtime.assertWrite(id)
      if (tasks.has(id)) {
        if (latest.get(id)?.id === token) return copy(latest.get(id)!)
        throw busy()
      }
      let initialLease = runtime.gate.acquire('invitation_withdrawal', token, String(id))
      const release = () => { initialLease?.(); initialLease = undefined }
      try {
        const account = await runtime.account(id), state = await stateFor(id, account.accountId)
        if (state.run?.id === token) return copy(await service.status(id) as Run)
        if (withdrawalNeedsCheck(state.run)) throw withdrawalError('withdrawal_check_required',
          'Проверьте результат предыдущего отзыва перед новым запуском.')
        const preview = previews.get(id)
        if (!preview || preview.token !== token || preview.expiresAt <= runtime.now() ||
          !sameWithdrawalAccount(preview.account, account)) throw withdrawalError(
          'withdrawal_preview_expired', 'Обновите список перед подтверждением отзыва.')
        const total = preview.items.filter(item => item.eligible).length
        if (!total) throw withdrawalError('withdrawal_empty', 'Нет приглашений старше 14 дней для отзыва.')
        const run: Run = { id: token, platformAccountId: id, accountId: account.accountId,
          status: 'running', total, withdrawn: 0, skipped: 0,
          targets: copy(preview.items.filter(item => item.eligible)), cursor: 0, approvedAccount: copy(account) }
        state.run = run
        await runtime.store.save(id, copy(state))
        assertOpen(); runtime.assertWrite(id)
        latest.set(id, run); activeStates.set(id, state); previews.delete(id); release()
        const task = executeWithdrawal(runtime, preview, state).finally(() => { tasks.delete(id); activeStates.delete(id) })
        tasks.set(id, task)
        return copy(run)
      } finally { if (!tasks.has(id)) release?.() }
    },
    async recheck(id, runId) {
      assertOpen(); runtime.assertWrite(id)
      if (tasks.has(id)) throw busy()
      const release = runtime.gate.acquire('invitation_withdrawal_check', runId, String(id))
      previews.delete(id)
      const task = recheckWithdrawal(runtime, id, runId).then(run => { latest.set(id, copy(run)) })
        .finally(() => { tasks.delete(id); previews.delete(id); release?.() })
      tasks.set(id, task); await task
      return service.status(id)
    },
    async status(id) {
      runtime.assertRead(id)
      const run = latest.get(id) ?? (await runtime.store.load(id))?.run
      if (!run) return undefined
      return copy(run.status === 'running' && !run.automationId && !tasks.has(id) ? { ...run, status: 'interrupted',
        error: run.targets ? 'Исполнитель не активен. Сохранённую очередь можно продолжить после проверки начатых отзывов.' :
          'Исполнитель не активен. Список заявок не сохранён; можно проверить только начатые отзывы.' } : run)
    },
    async resume(id, runId) {
      assertOpen(); runtime.assertWrite(id)
      if (tasks.has(id)) throw busy()
      let initialLease = runtime.gate.acquire('invitation_withdrawal', runId, String(id))
      const release = () => { initialLease?.(); initialLease = undefined }
      try {
        const account = await runtime.account(id)
        let state = await stateFor(id, account.accountId)
        if (!state.run || state.run.id !== runId) throw withdrawalError('withdrawal_run_changed', 'Задание изменилось.')
        if (withdrawalNeedsCheck(state.run)) {
          await recheckWithdrawal(runtime, id, runId); state = (await runtime.store.load(id))!
        }
        const run = state.run!
        if (run.status === 'uncertain' || run.stopRequested || run.status === 'completed') return copy(run)
        if (!run.targets || !run.approvedAccount || !Number.isInteger(run.cursor)) {
          run.status = 'interrupted'; run.error = 'Список заявок не сохранён. Продолжение невозможно.'
          await runtime.store.save(id, copy(state)); latest.set(id, run); return copy(run)
        }
        run.status = 'running'; run.error = undefined
        await runtime.store.save(id, copy(state)); latest.set(id, run); activeStates.set(id, state)
        const preview = { token: runId, account: run.approvedAccount, items: run.targets, expiresAt: Infinity }
        release()
        const task = executeWithdrawal(runtime, preview, state).finally(() => { tasks.delete(id); activeStates.delete(id) })
        tasks.set(id, task); return copy(run)
      } finally { if (!tasks.has(id)) release?.() }
    },
    async stop(id) {
      runtime.assertRead(id)
      const stored = activeStates.get(id) ?? managed.get(id)?.state ?? await runtime.store.load(id)
      const run = latest.get(id) ?? stored?.run
      if (run && run.status !== 'completed') {
        run.stopRequested = true
        if (stored?.run?.id === run.id) {
          stored.run.stopRequested = true
          if (!tasks.has(id) && !stepping.has(id)) { stored.run.status = 'stopped'; run.status = 'stopped' }
          await runtime.store.save(id, stored); latest.set(id, stored.run)
        }
      }
      return service.status(id)
    },
    busy: () => tasks.size > 0,
    async close() {
      closed = true
      for (const run of latest.values()) if (run.status === 'running') run.stopRequested = true
      await Promise.all(tasks.values())
    }
  }
  // Manual and scheduled entry points share the same request attribution, including
  // the background continuation created inside start/resume.
  for (const name of ['preview', 'start', 'startAutomatic', 'stepManaged', 'resume', 'recheck'] as const) {
    const action = service[name]
    if (action) (service as any)[name] = (...args: any[]) => withRequestContext({ feature: 'withdrawals',
      runId: typeof args[1] === 'string' ? args[1] : requestContext()?.runId,
      initiator: requestContext()?.initiator ?? (name === 'recheck' ? 'recovery' : 'manual') }, () => (action as any)(...args))
  }
  return service
}
