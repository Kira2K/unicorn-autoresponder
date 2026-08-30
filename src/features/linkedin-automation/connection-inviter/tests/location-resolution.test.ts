const assert = require('node:assert/strict')
const { selectLocation } = require('../location-resolution.ts') as
  typeof import('../location-resolution.ts')

const at = '2026-08-29T09:00:00Z'
assert.deepEqual(selectLocation('Berlin', [
  { id: 'geo-munich', name: 'Munich, Germany' },
  { id: 'geo-berlin', name: 'Berlin' }
], at), { status: 'resolved', city: 'Berlin', id: 'geo-berlin', label: 'Berlin', resolvedAt: at })
assert.equal(selectLocation('Bangalore', [{ id: 'geo-blr', name: 'Bengaluru' }], at).id, 'geo-blr')
assert.equal(selectLocation('Springfield', [
  { id: 'one', name: 'Springfield Illinois' }, { id: 'two', name: 'Springfield Missouri' }
], at).status, 'unresolved')

console.log('connection location resolution tests passed')
