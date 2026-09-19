import type { Provider, Runtime, State } from './contracts.ts'
import { withdrawalError, withdrawalRetryAt } from './policy.ts'

// Only reads are retried. A failed cancel can schedule a pause, never another POST.
export function createWithdrawalReads(runtime: Runtime, state: State, provider: Pick<Provider, 'verify' | 'list'>) {
  const run = state.run!, id = run.platformAccountId
  const save = async () => { runtime.assertWrite(id); await runtime.store.save(id, structuredClone(state)) }
  const stopped = () => {
    if (run.stopRequested) throw withdrawalError('withdrawal_stop_requested', 'Ожидание остановлено.')
    runtime.assertWrite(id)
  }
  async function waitAfterRateLimit(error: unknown) {
    const attempt = (run.retryAttempt ?? 0) + 1
    const retryAt = withdrawalRetryAt(error, runtime.now(), attempt)
    if (retryAt === undefined) throw error
    state.retryAt = retryAt; run.retryAttempt = attempt
    run.nextActionAt = new Date(retryAt).toISOString()
    await save() // No further provider call unless the pause and current intent were saved.
    while (runtime.now() < retryAt) {
      stopped()
      await runtime.sleep(Math.min(250, retryAt - runtime.now()))
    }
    stopped()
  }
  async function read<T>(action: () => Promise<T>): Promise<T> {
    while (true) {
      runtime.assertWrite(id)
      // Stop may finish an immediate read-back, but must not restart a paused read.
      if (run.retryAttempt) stopped()
      let result: T
      try { result = await action() }
      catch (error) { await waitAfterRateLimit(error); continue }
      if (run.retryAttempt) {
        run.retryAttempt = undefined; run.nextActionAt = undefined; state.retryAt = undefined
        await save() // Saving success is outside the retry loop's provider-error catch.
      }
      return result
    }
  }
  return { verify: (account: Parameters<Provider['verify']>[0]) => read(() => provider.verify(account)),
    list: (accountId: string) => read(() => provider.list(accountId)), waitAfterRateLimit }
}
