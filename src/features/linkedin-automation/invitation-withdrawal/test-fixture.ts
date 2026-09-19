import type { Invitation, Runtime, State } from './contracts.ts'
import { createInvitationWithdrawal } from './service.ts'
export function fixture() {
  let pending: Invitation[] = [1, 2].map(id => ({ id: String(id), name: `Test ${id}`, createdAt: '2026-08-01T00:00:00Z' }))
  let stored: State | undefined
  let locked = false, writable = true, saves = 0, failSave = 0
  const calls: string[] = [], delays: number[] = []
  const runtime: Runtime = {
    provider: () => provider,
    store: { async load() { return structuredClone(stored) }, async save(_id, state) {
      if (++saves === failSave) throw new Error('disk failed')
      stored = structuredClone(state)
    } },
    account: async id => ({ platformAccountId: id, accountId: 'acc_test', linkedinUrl: 'https://www.linkedin.com/in/test/' }),
    assertRead(id) { if (id !== 1) throw new Error('account forbidden') },
    assertWrite(id) { runtime.assertRead(id); if (!writable) throw new Error('writer disabled') },
    writable: () => writable, now: () => Date.parse('2026-09-17T12:00:00Z'), random: () => 0.5,
    sleep: async ms => { delays.push(ms) },
    gate: { acquire() { if (locked) throw new Error('account busy'); locked = true; return () => { locked = false } } }
  }
  const provider = {
    async verify() {}, async list() { return structuredClone(pending) },
    async cancel(_account: string, id: string) { calls.push(id); pending = pending.filter(item => item.id !== id) }
  }
  return { runtime, provider, calls, delays, service: createInvitationWithdrawal(runtime),
    pending: (items: Invitation[]) => { pending = items }, failSave: (number: number) => { failSave = number },
    readonly: () => { writable = false }, stored: () => structuredClone(stored) }
}
export async function finished(service: ReturnType<typeof createInvitationWithdrawal>) {
  for (let i = 0; i < 100; i++) {
    if (!service.busy()) return service.status(1)
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('run did not finish')
}
