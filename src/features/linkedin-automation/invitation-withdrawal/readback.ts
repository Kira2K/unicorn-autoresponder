import type { Provider } from './contracts.ts'
import { withdrawalError } from './policy.ts'
export async function readWithdrawalResult(provider: Pick<Provider, 'list'>, accountId: string,
  invitationIds: string[], sleep: (ms: number) => Promise<void>) {
  const targets = new Set(invitationIds)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(attempt * 1000)
    const pending = await provider.list(accountId)
    if (!pending.some(row => targets.has(row.id))) return pending
  }
  throw withdrawalError('withdrawal_result_pending',
    'Не все проверяемые приглашения исчезли из ожидающих. Проверьте результат позже; повторный отзыв не отправляем.')
}
