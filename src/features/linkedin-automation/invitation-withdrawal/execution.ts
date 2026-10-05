import type { Preview, Runtime, State } from './contracts.ts'
import { assertApprovedQueue, classifyInvitations, sameWithdrawalAccount, withdrawalDelay, withdrawalError, withdrawalRetryAt } from './policy.ts'
import { readWithdrawalResult } from './readback.ts'
import { createWithdrawalReads, withdrawalSummary } from './retry.ts'
import { ACTION_SKIPPED } from '../action-recovery.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
const { withRequestContext } = (requestControl as any).default ?? requestControl
import type { ExecutionStep } from '../execution-step.ts'

export async function* withdrawalSteps(runtime: Runtime, preview: Preview, state: State): AsyncGenerator<ExecutionStep> {
  const run = state.run!, id = run.platformAccountId
  const save = async () => {
    try { await runtime.store.save(id, structuredClone(state)) }
    catch (cause) { throw Object.assign(new Error('Не удалось сохранить шаг отзыва.', { cause }),
      { code: 'withdrawal_persistence_unavailable' }) }
  }
  const stopped = () => run.stopRequested === true
  run.confirmed ??= []; run.noLongerPending ??= []
  if (!run.targets || !run.approvedAccount || !Number.isInteger(run.cursor)) {
    run.status = 'interrupted'; run.error = 'Список подтверждённых заявок не сохранён. Можно проверить только начатые отзывы.'
    await save(); yield { status: 'needs_attention', reason: 'withdrawal_targets_missing' }; return
  }
  let inFlight = false
  try {
    assertApprovedQueue(run)
    const account = await runtime.account(id)
    if (!sameWithdrawalAccount(account, run.approvedAccount!))
      throw withdrawalError('withdrawal_account_changed', 'Привязка аккаунта изменилась. Обновите список.')
    const provider = runtime.provider()
    const reads = createWithdrawalReads(runtime, state, provider)
    const due = Math.max(state.retryAt ?? 0, Date.parse(run.nextActionAt ?? '') || 0)
    if (due > runtime.now()) yield { status: 'waiting', nextActionAt: new Date(due).toISOString(), reason: 'saved_pause' }
    run.nextActionAt = undefined
    if (!stopped()) await reads.verify(account)
    if (run.current) throw withdrawalError('withdrawal_check_required', 'Сначала проверьте начатый отзыв.')
    for (let index = run.cursor!; index < run.targets.length; index++) {
      const item = run.targets[index]
      if (stopped()) break
      const [current] = classifyInvitations([item], runtime.now(), state.attempted, await runtime.protectedSince?.(id))
      if (!current.eligible) {
        run.skipped++; run.cursor = index + 1; await save()
        yield { status: 'ready', reason: 'candidate_skipped' }; continue
      }
      if (Date.parse(run.nextActionAt ?? '') > runtime.now())
        yield { status: 'waiting', nextActionAt: run.nextActionAt, reason: 'withdrawal_pacing' }
      run.nextActionAt = undefined
      if (stopped()) break
      runtime.assertWrite(id)
      run.current = item.id; state.attempted.push(item.id)
      await save() // Durable intent before the only POST; even a lost response must not be repeated.
      if (stopped()) {
        // No POST was started, so this specific intent may safely be released.
        run.current = undefined; state.attempted = state.attempted.filter(value => value !== item.id)
        await save(); break
      }
      runtime.assertWrite(id)
      inFlight = true; run.checkedAt = undefined
      let confirmed = false
      try { await withRequestContext({ actionId: `cancel:${item.id}` }, () => provider.cancel(account.accountId, item.id)); confirmed = true }
      catch (error: any) {
        if (error?.notSent === true) {
          run.current = undefined; state.attempted = state.attempted.filter(value => value !== item.id)
          inFlight = false; await save(); throw error
        }
        // A missing request may have been accepted or canceled elsewhere since preview.
        // Even after a lost/limited response, absence proves only that it is no longer pending.
        if (![404, 410].includes(error?.details?.httpStatus)) await reads.waitAfterRateLimit(error)
        await readWithdrawalResult(reads, account.accountId, [item.id], runtime.sleep)
      }
      if (confirmed) { run.withdrawn++; run.confirmed.push(item.id) }
      else { run.skipped++; run.noLongerPending.push(item.id) }
      run.current = undefined
      run.cursor = index + 1
      run.nextActionAt = run.cursor < run.targets.length ?
        new Date(runtime.now() + withdrawalDelay(runtime.random)).toISOString() : undefined
      await save()
      inFlight = false
      yield { status: 'ready', reason: 'withdrawal_saved', nextActionAt: run.nextActionAt }
    }
    // Ordinary successful POSTs share one full read-back at the end, also after Stop.
    const checking = [...run.confirmed, ...(run.unconfirmed ?? [])]
      .filter(id => run.recovery?.[`cancel:${id}`]?.skippedAt === undefined)
    if (!stopped() && checking.length) {
      if (Date.parse(run.verificationAt ?? '') > runtime.now()) {
        run.status = 'uncertain'; run.nextActionAt = run.verificationAt; await save()
        yield { status: 'verifying', nextActionAt: run.verificationAt }; return
      }
      await readWithdrawalResult(reads, account.accountId, checking, runtime.sleep)
      for (const id of (run.unconfirmed ?? []).filter(id => checking.includes(id))) { run.skipped++; run.noLongerPending.push(id) }
      run.unconfirmed = (run.unconfirmed ?? []).filter(id => !checking.includes(id)); run.verificationAt = undefined
      run.checkedAt = new Date(runtime.now()).toISOString()
    }
    run.status = stopped() ? 'stopped' : 'completed'
    if (!stopped() && run.unconfirmed?.length) { run.status = 'interrupted'; run.recoveryClosed = true }
    run.nextActionAt = undefined
    await save()
    yield { status: stopped() ? 'stopped' : 'completed', reason: run.recoveryClosed ? ACTION_SKIPPED : undefined,
      summary: withdrawalSummary(state) }
  } catch (error: any) {
    if (error?.code === 'withdrawal_persistence_unavailable') throw error
    if (run.recoveryClosed) { await save(); yield { status: 'completed', reason: ACTION_SKIPPED, summary: withdrawalSummary(state) }; return }
    const retryAt = withdrawalRetryAt(error, runtime.now())
    if (retryAt) { state.retryAt = retryAt; run.nextActionAt = new Date(retryAt).toISOString() }
    else if (error?.code === 'withdrawal_result_pending')
      run.nextActionAt = new Date(runtime.now() + 60_000).toISOString()
    const requestedStop = error?.code === 'withdrawal_stop_requested'
    const needsCheck = inFlight || Boolean(run.current) || Boolean(run.unconfirmed?.length) || Boolean(run.confirmed.length && !run.checkedAt)
    const waiting = runtime.cooperative && (error?.code === 'withdrawal_step_yield' || (error?.notSent && retryAt))
    run.status = stopped() || requestedStop ? 'stopped' : needsCheck ? 'uncertain' : waiting ? 'running' : 'failed'
    run.error = error?.code === 'withdrawal_step_yield' && run.error ? run.error :
      needsCheck ? 'Проверка результата не завершена. Очередь остановлена; повторной отправки не будет.' :
      requestedStop ? undefined : 'Не удалось проверить аккаунт, прочитать список или сохранить состояние. Очередь остановлена.'
    await save()
    yield { status: stopped() || requestedStop ? 'stopped' : needsCheck ? 'verifying' : waiting ? 'waiting' : 'needs_attention',
      reason: String(error?.code ?? 'withdrawal_failed'), nextActionAt: run.nextActionAt }
  }
}

export async function executeWithdrawal(runtime: Runtime, preview: Preview, state: State) {
  const steps = withdrawalSteps(runtime, preview, state)
  const run = state.run!
  const needsCheck = () => Boolean(run.current || (run.confirmed?.length && !run.checkedAt))
  const waitUntil = async (deadline: string) => {
    let remaining = Math.max(0, Date.parse(deadline) - runtime.now())
    while (remaining > 0 && !run.stopRequested) {
      const slice = Math.min(250, remaining); await runtime.sleep(slice); remaining -= slice
    }
  }
  try { while (true) {
    let release: (() => void) | undefined
    try { release = runtime.gate.acquire('invitation_withdrawal', state.run!.id, String(state.run!.platformAccountId)) }
    catch (error: any) {
      if (error?.code !== 'linkedin_operation_active') throw error
      if (run.stopRequested) {
        run.status = needsCheck() ? 'uncertain' : 'stopped'
        run.error = run.status === 'uncertain' ? 'Очередь остановлена. Проверка отправленного ожидает освобождения аккаунта.' : undefined
        await runtime.store.save(run.platformAccountId, structuredClone(state)); break
      }
      run.nextActionAt = new Date(Math.max(runtime.now() + 30_000,
        state.retryAt ?? 0, Date.parse(run.nextActionAt ?? '') || 0)).toISOString()
      await runtime.store.save(run.platformAccountId, structuredClone(state))
      await waitUntil(run.nextActionAt); continue
    }
    let result: IteratorResult<ExecutionStep>
    try { result = await steps.next() } finally { release?.() }
    if (result.done) break
    const step = result.value
    // The existing service drives exactly the same steps as a future coordinator.
    if (step.nextActionAt && step.status === 'waiting') await waitUntil(step.nextActionAt)
  } } catch {
    // Driver failures also stop writes; do not leave a rejected background task running.
    run.status = needsCheck() ? 'uncertain' : 'failed'
    run.error = 'Не удалось продолжить очередь или сохранить состояние. Проверьте журнал перед продолжением.'
    try { await runtime.store.save(run.platformAccountId, structuredClone(state)) }
    catch { run.error += ' Не удалось сохранить итог.' }
  } finally { await steps.return(undefined) }
}
