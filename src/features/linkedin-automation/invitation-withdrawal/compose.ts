import { resolve } from 'node:path'
import { createInvitationWithdrawal } from './service.ts'
import { createWithdrawalFileStore } from './file-store.ts'
import { createWithdrawalProvider } from '../../../integrations/unipile/invitation-withdrawal.ts'
import { resolveContext } from '../connection-inviter/account.mts'
import { withdrawalError } from './policy.ts'
import type { ConnectionRuntime } from '../connection-inviter/runtime.ts'
import type { Provider, Store } from './contracts.ts'
export function composeInvitationWithdrawal(runtime: ConnectionRuntime, assertScope: (id: number) => void,
  injected?: { provider: Provider; store: Store }) {
  let provider: Provider | undefined = injected?.provider
  return createInvitationWithdrawal({
    provider: () => provider ??= createWithdrawalProvider(),
    store: injected?.store ?? createWithdrawalFileStore(resolve('storage/linkedin-invitation-withdrawal')),
    account: async id => {
      const account = await resolveContext(runtime, id)
      return { platformAccountId: id, accountId: account.accountId, linkedinUrl: account.linkedinUrl,
        verifiedProviderId: account.verifiedProviderId }
    },
    assertRead: assertScope,
    assertWrite(id) {
      assertScope(id)
      if (!runtime.writerEnabled) throw withdrawalError('withdrawal_read_only', 'Backend работает только на чтение.')
      runtime.assertWriterOwnership?.()
    },
    writable: () => runtime.writerEnabled,
    gate: { acquire(...args) {
      if (!runtime.gate) throw withdrawalError('withdrawal_gate_missing', 'Защита параллельных операций не подключена.')
      return runtime.gate.acquire(...args)
    } },
    now: () => runtime.now().getTime(), random: runtime.random, sleep: runtime.sleep
  })
}
