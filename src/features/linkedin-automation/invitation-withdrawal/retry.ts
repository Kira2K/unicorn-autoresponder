import type { Provider, Runtime, State } from './contracts.ts'
import { withdrawalError, withdrawalRetryAt } from './policy.ts'
import { listReadMessage } from '../../../integrations/unipile/read-retry.ts'
import { recordFailure, recoveryExpired, recoveryWakeAt, skipRecovery, skippedAction } from '../action-recovery.ts'

export const withdrawalRecoveryKey = (state: State) => state.run?.current ? `cancel:${state.run.current}` : 'readback'
export function expireWithdrawalRecovery(state: State, now: number) {
  const run = state.run!
  let changed = false
  for (const [key, value] of Object.entries(run.recovery ?? {})) {
    if (value.skippedAt !== undefined || !recoveryExpired(value, now)) continue
    skipRecovery(value, now); changed = true
    if (run.current && key === `cancel:${run.current}`) {
      (run.unconfirmed ??= []).push(run.current)
      run.current = undefined; run.cursor = (run.cursor ?? 0) + 1
    }
    if (key === 'identity' || key === 'readback') run.recoveryClosed = true
    run.nextActionAt = undefined
    run.error = 'После 20 минут ошибок действие пропущено. Неподтверждённые отзывы сохранены без повторной отправки.'
  }
  if (run.recoveryClosed) run.status = 'interrupted'
  return changed
}

export function withdrawalSummary(state: State) {
  const run = state.run!
  const unconfirmed = (run.unconfirmed?.length ?? 0) + (run.current ? 1 : 0) +
    (run.checkedAt ? 0 : run.confirmed?.length ?? 0)
  return { completed: Math.max(0, run.withdrawn - (run.checkedAt ? 0 : run.confirmed?.length ?? 0)),
    skipped: run.skipped + Math.max(0, run.total - (run.cursor ?? 0) - (run.current ? 1 : 0)), unconfirmed }
}

// Only reads are retried. A failed cancel can schedule a pause, never another POST.
export function createWithdrawalReads(runtime: Runtime, state: State, provider: Pick<Provider, 'verify' | 'list'>) {
  const run = state.run!, id = run.platformAccountId
  const save = async () => { runtime.assertWrite(id); await runtime.store.save(id, structuredClone(state)) }
  const stopped = () => {
    if (run.stopRequested) throw withdrawalError('withdrawal_stop_requested', 'Ожидание остановлено.')
    runtime.assertWrite(id)
  }
  async function waitAfterRateLimit(error: unknown, key = withdrawalRecoveryKey(state)) {
    const attempt = (run.retryAttempt ?? 0) + 1
    const retryAt = withdrawalRetryAt(error, runtime.now(), attempt)
    if (retryAt === undefined) throw error
    const recovery = run.recovery ??= {}
    const value = recordFailure(recovery[key], error, runtime.now())
    if (value) recovery[key] = value
    state.retryAt = retryAt; run.retryAttempt = attempt
    run.nextActionAt = new Date(recoveryWakeAt(value, retryAt)).toISOString()
    run.error = listReadMessage(error) ?? 'Чтение временно недоступно. Продолжим после сохранённой паузы.'
    await save() // No further provider call unless the pause and current intent were saved.
    if (runtime.cooperative) throw withdrawalError('withdrawal_step_yield', 'Ожидание сохранено.')
    while (runtime.now() < retryAt) {
      if (recoveryExpired(value, runtime.now())) { expireWithdrawalRecovery(state, runtime.now()); await save(); throw skippedAction() }
      stopped()
      await runtime.sleep(Math.min(250, retryAt - runtime.now()))
    }
    stopped()
  }
  async function read<T>(key: string, action: () => Promise<T>): Promise<T> {
    while (true) {
      stopped()
      if (recoveryExpired(run.recovery?.[key], runtime.now())) {
        expireWithdrawalRecovery(state, runtime.now()); await save(); throw skippedAction()
      }
      let result: T
      try { result = await action() }
      catch (error: any) {
        // Bound a manual read loop; managed steps yield to the persisted scheduler.
        if (!runtime.cooperative && (run.retryAttempt ?? 0) >= 3 && error?.details?.httpStatus !== 429 && !run.recovery?.[key] && error?.details?.httpStatus !== 500) throw error
        await waitAfterRateLimit(error, key); continue
      }
      if (key === 'identity' && run.recovery) delete run.recovery[key]
      if (run.retryAttempt) {
        run.retryAttempt = undefined; run.nextActionAt = undefined; state.retryAt = undefined
        run.error = undefined
        await save() // Saving success is outside the retry loop's provider-error catch.
      }
      return result
    }
  }
  return { verify: (account: Parameters<Provider['verify']>[0]) => read('identity', () => provider.verify(account)),
    list: (accountId: string) => read(withdrawalRecoveryKey(state), () => provider.list(accountId)), waitAfterRateLimit }
}
