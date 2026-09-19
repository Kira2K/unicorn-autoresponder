import type { Provider } from './contracts.ts'
import { withdrawalError } from './policy.ts'
export async function readWithdrawalResult(provider: Pick<Provider, 'list'>, accountId: string,
  invitationId: string | undefined, sleep: (ms: number) => Promise<void>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(attempt * 1000)
    const pending = await provider.list(accountId)
    if (!invitationId || !pending.some(row => row.id === invitationId)) return pending
  }
  throw withdrawalError('withdrawal_result_pending',
    'Приглашение пока отображается в ожидающих. Проверьте результат позже; повторный отзыв не отправляем.')
}
