import { randomUUID } from 'node:crypto'
import type { Preview, Run, Runtime, State, WithdrawalService } from './contracts.ts'
import { classifyInvitations, withdrawalError, withdrawalNeedsCheck } from './policy.ts'
import { executeWithdrawal } from './execution.ts'
import { recheckWithdrawal } from './recheck.ts'
export function createInvitationWithdrawal(runtime: Runtime): WithdrawalService {
  const previews = new Map<number, Preview>(), latest = new Map<number, Run>()
  const tasks = new Map<number, Promise<void>>()
  let closed = false
  const copy = <T>(value: T): T => structuredClone(value)
  const busy = () => withdrawalError('withdrawal_busy', 'Для этого аккаунта уже выполняется операция.')
  function assertOpen() { if (closed) throw withdrawalError('withdrawal_closed', 'Сервис остановлен.') }
  async function stateFor(id: number, accountId: string): Promise<State> {
    const state = await runtime.store.load(id)
    if (state && state.accountId !== accountId) throw withdrawalError('withdrawal_account_changed',
      'Аккаунт перепривязан. Сначала проверьте журнал предыдущих отзывов.')
    if (state?.retryAt && state.retryAt > runtime.now()) throw withdrawalError('withdrawal_cooldown',
      `Unipile ограничил запросы. Повторите после ${new Date(state.retryAt).toISOString()}.`)
    return state ?? { accountId, attempted: [] }
  }
  const service: WithdrawalService = {
    async preview(id) {
      assertOpen(); runtime.assertRead(id)
      if (tasks.has(id)) throw busy()
      previews.delete(id)
      const account = await runtime.account(id), state = await stateFor(id, account.accountId)
      const items = classifyInvitations(await runtime.provider().list(account.accountId), runtime.now(), state.attempted)
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
      const release = runtime.gate.acquire('invitation_withdrawal', token, String(id))
      try {
        const account = await runtime.account(id), state = await stateFor(id, account.accountId)
        if (state.run?.id === token) return copy(await service.status(id) as Run)
        if (withdrawalNeedsCheck(state.run)) throw withdrawalError('withdrawal_check_required',
          'Проверьте результат предыдущего отзыва перед новым запуском.')
        const preview = previews.get(id)
        if (!preview || preview.token !== token || preview.expiresAt <= runtime.now() ||
          JSON.stringify(preview.account) !== JSON.stringify(account)) throw withdrawalError(
          'withdrawal_preview_expired', 'Обновите список перед подтверждением отзыва.')
        const total = preview.items.filter(item => item.eligible).length
        if (!total) throw withdrawalError('withdrawal_empty', 'Нет приглашений старше 14 дней для отзыва.')
        const run: Run = { id: token, platformAccountId: id, accountId: account.accountId,
          status: 'running', total, withdrawn: 0, skipped: 0 }
        state.run = run
        await runtime.store.save(id, copy(state))
        assertOpen(); runtime.assertWrite(id)
        latest.set(id, run); previews.delete(id)
        const task = executeWithdrawal(runtime, preview, state).finally(() => { tasks.delete(id); release?.() })
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
      return copy(run.status === 'running' && !tasks.has(id) ? { ...run, status: 'interrupted',
        error: 'Backend перезапущен. Автоматического продолжения нет; начатые отзывы повторяться не будут.' } : run)
    },
    async stop(id) {
      runtime.assertRead(id)
      const run = latest.get(id)
      if (run?.status === 'running') run.stopRequested = true
      return service.status(id)
    },
    busy: () => tasks.size > 0,
    async close() {
      closed = true
      for (const run of latest.values()) if (run.status === 'running') run.stopRequested = true
      await Promise.all(tasks.values())
    }
  }
  return service
}
