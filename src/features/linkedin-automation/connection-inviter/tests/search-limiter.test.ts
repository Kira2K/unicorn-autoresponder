const assert = require('node:assert/strict')
const { connectionSearchSlot } = require('../search-limiter.ts') as
  typeof import('../search-limiter.ts')

let now = Date.parse('2026-08-29T09:00:00Z')
let attempts: string[] = []
for (let index = 0; index < 69; index += 1) {
  const slot = connectionSearchSlot(attempts, now, 60_000)
  now += slot.delayMs
  attempts = [...slot.recent, new Date(now).toISOString()]
}
const elapsed = now - Date.parse('2026-08-29T09:00:00Z')
assert.equal(elapsed > 21 * 60_000, true)
assert.equal(elapsed >= 120 * 60_000, true)

const seeded = connectionSearchSlot([
  '2026-08-29T09:00:00Z', '2026-08-29T09:01:00Z', '2026-08-29T09:02:00Z',
  '2026-08-29T09:03:00Z', '2026-08-29T09:04:00Z'
], Date.parse('2026-08-29T09:05:00Z'), 60_000)
assert.equal(seeded.delayMs, 5 * 60_000)
assert.equal(seeded.waitKind, 'search_batch_cooldown')

console.log('connection account-wide search limiter tests passed')
