import { createInvitationWithdrawal } from '../../linkedin-automation/invitation-withdrawal/service.ts'
import type { Invitation, State } from '../../linkedin-automation/invitation-withdrawal/contracts.ts'
export function createMockWithdrawal() {
  const records = new Map<number, State>(), accounts = new Map<string, Invitation[]>(), locks = new Set<string>()
  const provider = {
    async verify() {},
    async list(account: string) {
      if (!accounts.has(account)) accounts.set(account, [
        { id: 'old-1', name: 'Тест: старое приглашение', createdAt: new Date(Date.now() - 30 * 86400000).toISOString() },
        { id: 'old-2', name: 'Тест: ручное приглашение', createdAt: new Date(Date.now() - 18 * 86400000).toISOString() },
        { id: 'new', name: 'Тест: новое приглашение', createdAt: new Date().toISOString() },
        { id: 'unknown', name: 'Тест: дата неизвестна' }
      ])
      return structuredClone(accounts.get(account)!)
    },
    async cancel(account: string, id: string) { accounts.set(account, (accounts.get(account) ?? []).filter(i => i.id !== id)) }
  }
  return createInvitationWithdrawal({ provider: () => provider,
    store: { async load(id) { return structuredClone(records.get(id)) }, async save(id, state) { records.set(id, structuredClone(state)) } },
    account: async id => ({ platformAccountId: id, accountId: `acc_mock_${id}`, linkedinUrl: 'https://www.linkedin.com/in/mock/' }),
    assertRead() {}, assertWrite() {}, writable: () => true,
    gate: { acquire(_kind, _id, key) { if (locks.has(key)) throw new Error('Busy'); locks.add(key); return () => { locks.delete(key) } } },
    now: Date.now, random: () => 0, sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
  })
}
