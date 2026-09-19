import * as gateModule from '../../web-console/backend/linkedin-operation-gate.ts'
import { createInvitationWithdrawal } from './service.ts'
import type { Invitation, State } from './contracts.ts'
const { createLinkedInOperationGate } = gateModule as unknown as { createLinkedInOperationGate(): any }
export function concurrencyFixture() {
  const states = new Map<number, State>(), pending = new Map<string, Invitation[]>()
  const releases = new Map<string, () => void>(), entered = new Map<string, () => void>()
  const waiting = new Map<number, Promise<void>>(), holds = new Map<string, Promise<void>>()
  const calls: Array<{ accountId: string; invitationId: string }> = []
  for (const id of [103, 203]) {
    const key = `acc_${id}`
    pending.set(key, ['old-1', 'old-2'].map(invitationId => ({ id: invitationId,
      name: `Student ${id}: ${invitationId}`, createdAt: '2026-08-01T00:00:00Z' })))
    holds.set(key, new Promise(resolve => releases.set(key, resolve)))
    waiting.set(id, new Promise(resolve => entered.set(key, resolve)))
  }
  const assertScope = (id: number) => { if (!waiting.has(id)) throw new Error('Wrong student') }
  const service = createInvitationWithdrawal({
    account: async id => ({ platformAccountId: id, accountId: `acc_${id}`, linkedinUrl: `https://www.linkedin.com/in/test-${id}/` }),
    provider: () => ({ async verify() {}, async list(accountId) { return structuredClone(pending.get(accountId)!) },
      async cancel(accountId, invitationId) {
        calls.push({ accountId, invitationId }); entered.get(accountId)!()
        await holds.get(accountId)
        pending.set(accountId, pending.get(accountId)!.filter(row => row.id !== invitationId))
      } }),
    store: { async load(id) { return structuredClone(states.get(id)) },
      async save(id, state) { states.set(id, structuredClone(state)) } },
    assertRead: assertScope, assertWrite: assertScope, writable: () => true,
    gate: createLinkedInOperationGate(), now: () => Date.parse('2026-09-18T00:00:00Z'),
    random: () => 0, sleep: async () => {}
  })
  return { service, calls, entered: (id: number) => waiting.get(id)!, release: (id: number) => releases.get(`acc_${id}`)!(),
    async close() { const closing = service.close(); for (const release of releases.values()) release(); await closing } }
}
