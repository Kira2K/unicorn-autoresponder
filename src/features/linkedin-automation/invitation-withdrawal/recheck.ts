import type { Runtime } from './contracts.ts'
import { withdrawalError, withdrawalNeedsCheck, withdrawalRetryAt } from './policy.ts'
import { readWithdrawalResult } from './readback.ts'
export async function recheckWithdrawal(runtime: Runtime, id: number, runId: string) {
  const account = await runtime.account(id), state = structuredClone(await runtime.store.load(id))
  if (!state?.run || state.run.id !== runId) throw withdrawalError('withdrawal_run_changed', 'Задание изменилось. Откройте его заново.')
  if (state.accountId !== account.accountId) throw withdrawalError('withdrawal_account_changed', 'Привязка аккаунта изменилась.')
  if (state.retryAt && state.retryAt > runtime.now()) throw withdrawalError('withdrawal_cooldown',
    `Unipile ограничил запросы. Повторите после ${new Date(state.retryAt).toISOString()}.`)
  const run = state.run
  if (!withdrawalNeedsCheck(run)) return run
  if (!Number.isSafeInteger(run.withdrawn) || !Number.isSafeInteger(run.skipped) || !Number.isSafeInteger(run.total) ||
    run.withdrawn < 0 || run.skipped < 0 || run.total < run.withdrawn + run.skipped ||
    [run.confirmed, run.noLongerPending].some(ids => ids !== undefined && (!Array.isArray(ids) ||
      new Set(ids).size !== ids.length || ids.some(item => typeof item !== 'string' || !state.attempted.includes(item)))) ||
    (run.confirmed?.length ?? 0) > run.withdrawn || (run.noLongerPending?.length ?? 0) > run.skipped ||
    run.confirmed?.some(item => run.noLongerPending?.includes(item)) ||
    (run.current && (!state.attempted.includes(run.current) || run.withdrawn + run.skipped >= run.total ||
      run.confirmed?.includes(run.current) || run.noLongerPending?.includes(run.current))))
    throw withdrawalError('withdrawal_journal_invalid', 'Не удалось проверить журнал. Автоматическое исправление запрещено.')
  const save = async () => { runtime.assertWrite(id); await runtime.store.save(id, state) }
  try {
    const provider = runtime.provider()
    await provider.verify(account)
    await readWithdrawalResult(provider, account.accountId,
      [...(run.confirmed ?? []), ...(run.current ? [run.current] : [])], runtime.sleep)
  } catch (error: any) {
    const retryAt = withdrawalRetryAt(error, runtime.now(), (run.retryAttempt ?? 0) + 1)
    if (retryAt) { state.retryAt = retryAt; run.retryAttempt = (run.retryAttempt ?? 0) + 1; await save() }
    if (error?.code !== 'withdrawal_result_pending') throw error
    run.status = 'uncertain'; run.error = error.message
    await save(); return run
  }
  if (run.current) { run.skipped++; (run.noLongerPending ??= []).push(run.current) }
  run.current = undefined; run.nextActionAt = undefined; run.error = undefined
  run.retryAttempt = undefined; state.retryAt = undefined
  run.checkedAt = new Date(runtime.now()).toISOString()
  run.status = run.withdrawn + run.skipped === run.total ? 'completed' : 'stopped'
  await save() // Publish the new count only after durable storage; repeat checks cannot increment it twice.
  return run
}
