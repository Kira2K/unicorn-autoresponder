import type { Preview, Runtime, State } from './contracts.ts'
import { classifyInvitations, withdrawalDelay, withdrawalError, withdrawalRetryAt } from './policy.ts'
import { readWithdrawalResult } from './readback.ts'
import { createWithdrawalReads } from './retry.ts'
export async function executeWithdrawal(runtime: Runtime, preview: Preview, state: State) {
  const run = state.run!, id = run.platformAccountId
  const save = () => runtime.store.save(id, structuredClone(state))
  const stopped = () => run.stopRequested === true
  run.confirmed = []; run.noLongerPending = []
  let inFlight = false
  try {
    const account = await runtime.account(id)
    if (JSON.stringify(account) !== JSON.stringify(preview.account))
      throw withdrawalError('withdrawal_account_changed', 'Привязка аккаунта изменилась. Обновите список.')
    const provider = runtime.provider()
    const reads = createWithdrawalReads(runtime, state, provider)
    await reads.verify(account)
    let mutations = 0
    for (const item of preview.items.filter(item => item.eligible)) {
      if (stopped()) break
      const [current] = classifyInvitations([item], runtime.now(), state.attempted)
      if (!current.eligible) { run.skipped++; continue }
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
      if (stopped()) { run.current = undefined; break }
      runtime.assertWrite(id)
      inFlight = true; mutations++
      let confirmed = false
      try { await provider.cancel(account.accountId, item.id); confirmed = true }
      catch (error: any) {
        // A missing request may have been accepted or canceled elsewhere since preview.
        // Even after a lost/limited response, absence proves only that it is no longer pending.
        if (![404, 410].includes(error?.details?.httpStatus)) await reads.waitAfterRateLimit(error)
        await readWithdrawalResult(reads, account.accountId, [item.id], runtime.sleep)
      }
      if (confirmed) { run.withdrawn++; run.confirmed.push(item.id) }
      else { run.skipped++; run.noLongerPending.push(item.id) }
      run.current = undefined
      await save()
      inFlight = false
    }
    // Ordinary successful POSTs share one full read-back at the end, also after Stop.
    if (run.confirmed.length) {
      await readWithdrawalResult(reads, account.accountId, run.confirmed, runtime.sleep)
      run.checkedAt = new Date(runtime.now()).toISOString()
    }
    run.status = stopped() ? 'stopped' : 'completed'
    await save()
  } catch (error: any) {
    const retryAt = withdrawalRetryAt(error, runtime.now())
    if (retryAt) state.retryAt = retryAt
    const requestedStop = error?.code === 'withdrawal_stop_requested'
    const needsCheck = inFlight || Boolean(run.confirmed.length && !run.checkedAt)
    run.status = needsCheck ? 'uncertain' : requestedStop ? 'stopped' : 'failed'
    run.error = needsCheck ? 'Проверка результата не завершена. Очередь остановлена; повторной отправки не будет.' :
      requestedStop ? undefined : 'Не удалось проверить аккаунт, прочитать список или сохранить состояние. Очередь остановлена.'
    try { await save() } catch {
      run.error = (run.error ? run.error + ' ' : '') + 'Не удалось сохранить итог. Не повторяйте запуск до проверки журнала.'
    }
  } finally { run.nextActionAt = undefined }
}
