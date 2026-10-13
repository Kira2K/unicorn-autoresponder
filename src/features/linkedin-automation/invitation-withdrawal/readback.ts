import type { Provider } from './contracts.ts'
import { withdrawalError } from './policy.ts'
export async function readWithdrawalResult(provider: Pick<Provider, 'list'>, accountId: string,
  invitationIds: string[], _sleep: (ms: number) => Promise<void>) {
  const targets = new Set(invitationIds)
  if (!targets.size) return []
  const pending = await provider.list(accountId)
  if (!pending.some(row => targets.has(row.id))) return pending
  throw Object.assign(withdrawalError('withdrawal_result_pending',
    'Не все проверяемые приглашения исчезли из ожидающих. Проверьте результат позже; повторный отзыв не отправляем.'),
    { pendingIds: pending.filter(row => targets.has(row.id)).map(row => row.id) })
}
