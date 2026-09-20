import type { Preview, Runtime, State } from './contracts.ts'
import { classifyInvitations, withdrawalDelay, withdrawalError, withdrawalRetryAt } from './policy.ts'
import { readWithdrawalResult } from './readback.ts'
import { createWithdrawalReads } from './retry.ts'
export async function executeWithdrawal(runtime: Runtime, preview: Preview, state: State) {
  const run = state.run!, id = run.platformAccountId
  const save = () => runtime.store.save(id, structuredClone(state))
  const stopped = () => run.stopRequested === true
  let inFlight = false
  try {
    const account = await runtime.account(id)
    if (JSON.stringify(account) !== JSON.stringify(preview.account))
      throw withdrawalError('withdrawal_account_changed', 'Привязка аккаунта изменилась. Обновите список.')
    const provider = runtime.provider()
    const reads = createWithdrawalReads(runtime, state, provider)
    await reads.verify(account)
    let pending = await reads.list(account.accountId)
    let mutations = 0
    for (const item of preview.items.filter(item => item.eligible)) {
      if (stopped()) break
      const current = classifyInvitations(pending, runtime.now(), state.attempted).find(row => row.id === item.id)
      if (!current?.eligible || current.createdAt !== item.createdAt) { run.skipped++; continue }
      if (mutations > 0) {
        let delay = withdrawalDelay(runtime.random)
        run.nextActionAt = new Date(runtime.now() + delay).toISOString()
        while (delay > 0 && !stopped()) {
          const slice = Math.min(250, delay); await runtime.sleep(slice); delay -= slice
        }
        run.nextActionAt = undefined
      }
      if (stopped()) break
      runtime.assertWrite(id)
      run.current = item.id; state.attempted.push(item.id)
      await save() // Durable intent before the only POST; even a lost response must not be repeated.
      if (stopped()) break
      runtime.assertWrite(id)
      inFlight = true; mutations++
      try { await provider.cancel(account.accountId, item.id) }
      catch (error) { await reads.waitAfterRateLimit(error) }
      pending = await readWithdrawalResult(reads, account.accountId, item.id, runtime.sleep)
      run.withdrawn++; run.current = undefined
      await save()
      inFlight = false
    }
    run.status = stopped() ? 'stopped' : 'completed'
    await save()
  } catch (error: any) {
    const retryAt = withdrawalRetryAt(error, runtime.now())
    if (retryAt) state.retryAt = retryAt
    const requestedStop = error?.code === 'withdrawal_stop_requested'
    run.status = inFlight ? 'uncertain' : requestedStop ? 'stopped' : 'failed'
    run.error = inFlight ? 'Результат отзыва не подтверждён. Очередь остановлена; повторной отправки не будет.' :
      requestedStop ? undefined : 'Не удалось проверить аккаунт, прочитать список или сохранить состояние. Очередь остановлена.'
    try { await save() } catch {
      run.error = (run.error ? run.error + ' ' : '') + 'Не удалось сохранить итог. Не повторяйте запуск до проверки журнала.'
    }
  } finally { run.nextActionAt = undefined }
}
