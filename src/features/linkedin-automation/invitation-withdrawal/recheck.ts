import type { Runtime } from './contracts.ts'
import { assertApprovedQueue, withdrawalError, withdrawalNeedsCheck, withdrawalRetryAt } from './policy.ts'
import { readWithdrawalResult } from './readback.ts'
import { withdrawalRecoveryKey, expireWithdrawalRecovery } from './retry.ts'
import { recordFailure, recoveryWakeAt } from '../action-recovery.ts'
export async function recheckWithdrawal(runtime: Runtime, id: number, runId: string) {
  const account = await runtime.account(id), state = structuredClone(await runtime.store.load(id))
  if (!state?.run || state.run.id !== runId) throw withdrawalError('withdrawal_run_changed', 'Задание изменилось. Откройте его заново.')
  if (state.accountId !== account.accountId) throw withdrawalError('withdrawal_account_changed', 'Привязка аккаунта изменилась.')
  if (expireWithdrawalRecovery(state, runtime.now())) { runtime.assertWrite(id); await runtime.store.save(id, state) }
  if (state.run.recoveryClosed) return state.run
  if (state.retryAt && state.retryAt > runtime.now()) throw withdrawalError('withdrawal_cooldown',
    `Unipile ограничил запросы. Повторите после ${new Date(state.retryAt).toISOString()}.`)
  const run = state.run
  const recoveryKey = withdrawalRecoveryKey(state)
  assertApprovedQueue(run)
  if (!withdrawalNeedsCheck(run)) return run
  if (Date.parse(run.nextActionAt ?? '') > runtime.now()) return run
  if (!Number.isSafeInteger(run.withdrawn) || !Number.isSafeInteger(run.skipped) || !Number.isSafeInteger(run.total) ||
    run.withdrawn < 0 || run.skipped < 0 || run.total < run.withdrawn + run.skipped ||
    [run.confirmed, run.noLongerPending, run.unconfirmed].some(ids => ids !== undefined && (!Array.isArray(ids) ||
      new Set(ids).size !== ids.length || ids.some(item => typeof item !== 'string' || !state.attempted.includes(item)))) ||
    (run.confirmed?.length ?? 0) > run.withdrawn || (run.noLongerPending?.length ?? 0) > run.skipped ||
    run.confirmed?.some(item => run.noLongerPending?.includes(item)) ||
    (run.current && (!state.attempted.includes(run.current) || run.withdrawn + run.skipped >= run.total ||
      run.confirmed?.includes(run.current) || run.noLongerPending?.includes(run.current))))
    throw withdrawalError('withdrawal_journal_invalid', 'Не удалось проверить журнал. Автоматическое исправление запрещено.')
  const save = async () => { runtime.assertWrite(id); await runtime.store.save(id, state) }
  let pending = new Set<string>()
  let phase = 'identity'
  try {
    const provider = runtime.provider()
    await provider.verify(account)
    if (run.recovery) delete run.recovery.identity
    phase = recoveryKey
    await readWithdrawalResult(provider, account.accountId,
      [...(run.confirmed ?? []), ...(run.unconfirmed ?? []), ...(run.current ? [run.current] : [])]
        .filter(id => run.recovery?.[`cancel:${id}`]?.skippedAt === undefined), runtime.sleep)
  } catch (error: any) {
    const value = recordFailure(run.recovery?.[phase], error, runtime.now())
    if (value) (run.recovery ??= {})[phase] = value
    const retryAt = withdrawalRetryAt(error, runtime.now(), (run.retryAttempt ?? 0) + 1)
    if (retryAt) { state.retryAt = retryAt; run.nextActionAt = new Date(recoveryWakeAt(value, retryAt)).toISOString(); run.retryAttempt = (run.retryAttempt ?? 0) + 1; await save() }
    if (error?.code !== 'withdrawal_result_pending') throw error
    if (!Array.isArray(error.pendingIds)) throw error
    pending = new Set(error.pendingIds)
  }
  run.unconfirmed ??= []
  if (run.current) {
    if (pending.has(run.current)) run.unconfirmed.push(run.current)
    else { run.skipped++; (run.noLongerPending ??= []).push(run.current) }
    if (run.targets) run.cursor = Math.max(run.cursor ?? 0, run.targets.findIndex(item => item.id === run.current) + 1)
  }
  const skippedUnknown = (id: string) => run.recovery?.[`cancel:${id}`]?.skippedAt !== undefined
  for (const id of run.unconfirmed.filter(id => !pending.has(id) && !skippedUnknown(id))) {
    run.skipped++; (run.noLongerPending ??= []).push(id)
  }
  run.unconfirmed = run.unconfirmed.filter(id => pending.has(id) || skippedUnknown(id))
  run.current = undefined; run.nextActionAt = undefined; run.error = undefined
  run.retryAttempt = undefined; state.retryAt = undefined
  run.checkedAt = run.confirmed?.some(id => pending.has(id)) ? undefined : new Date(runtime.now()).toISOString()
  run.verificationAt = pending.size ? new Date(runtime.now() +
    [1, 5, 15, 30, 60, 120][Math.min(5, run.verificationChecks ?? 0)] * 60_000).toISOString() : undefined
  run.verificationChecks = pending.size ? (run.verificationChecks ?? 0) + 1 : undefined
  if (pending.size && (!run.targets || run.cursor === run.total)) run.nextActionAt = run.verificationAt
  run.status = pending.size ? 'uncertain' : run.withdrawn + run.skipped === run.total ? 'completed' : run.targets ? 'stopped' : 'interrupted'
  if (pending.size) run.error = 'Часть результатов ещё не подтверждена. Остальная сохранённая очередь может продолжаться.'
  if (!pending.size && run.recovery) delete run.recovery[recoveryKey]
  if (!pending.size && run.unconfirmed.length && run.cursor === run.total) {
    run.status = 'interrupted'; run.recoveryClosed = true
  }
  await save() // Publish the new count only after durable storage; repeat checks cannot increment it twice.
  return run
}
