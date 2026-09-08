import { setImmediate } from 'node:timers/promises'
import { createMockDependencies } from '../mock.ts'
import { createPostWriterService } from '../service.ts'
import type { Dependencies, Gate } from '../types.ts'
export function fixture() {
  let now = Date.parse('2026-09-07T10:00:00+03:00')
  const held = new Map<string, string>()
  const leases = new Map<string, symbol>()
  const gate: Gate = { acquire(_kind, id, account) {
    if (held.has(account)) throw Object.assign(new Error('busy'), { code: 'linkedin_operation_active' })
    held.set(account, id)
    const lease = Symbol()
    leases.set(account, lease)
    return () => { if (leases.get(account) === lease) { held.delete(account); leases.delete(account) } }
  } }
  const deps = createMockDependencies(gate)
  deps.now = () => now
  deps.random = () => 0
  const publish = deps.adapter.publish
  const like = deps.adapter.like
  const counts = { publish: 0, like: 0 }
  deps.adapter.publish = async (account, text, image) => {
    counts.publish++
    const post = await publish(account, text, image)
    post.createdAt = now
    return post
  }
  deps.adapter.like = async (account, id) => { counts.like++; await like(account, id) }
  let service = createPostWriterService(deps, false)
  return { deps, counts, held, get service() { return service },
    setNow(value: number) { now = value },
    restart() { service.close(); held.clear(); service = createPostWriterService(deps, false) },
    async step(ms = 0) { now += ms; await service.tick(); for (let i = 0; i < 12; i++) await setImmediate() },
    async run() { return (await service.get(203)).runs[0] },
    async untilPublished() { for (let i = 0; i < 5; i++) { now += 6000; await service.tick(); await setImmediate() } }
  }
}
