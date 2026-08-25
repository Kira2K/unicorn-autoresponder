import assert from 'node:assert/strict'
import { durationUntil, latestForAccount, monitorActive, monitorError, monitorLabel } from './comment-monitor-view.js'

const now = Date.parse('2026-01-01T00:00:00Z')
assert.equal(durationUntil('2026-01-01T00:01:05Z', now), '1m 5s')
assert.equal(monitorActive({ status: 'waiting' }), true)
assert.equal(monitorActive({ status: 'completed' }), false)
assert.equal(monitorLabel({ status: 'paused' }), 'Needs attention')
assert.match(monitorError('comment_reply_uncertain'), /read-back only/)
assert.equal(latestForAccount([{ platformAccountId: 2 }], 2).platformAccountId, 2)
console.log('comment monitor view tests passed')
