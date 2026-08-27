const assert = require('node:assert/strict')
const { createLinkedInOperationGate } = require('./linkedin-operation-gate.ts') as any

function run() {
  const gate = createLinkedInOperationGate()
  const release = gate.acquire('linkedin_auth', 'run-1')
  assert.deepEqual(gate.current(), { kind: 'linkedin_auth', id: 'run-1' })
  assert.throws(() => gate.acquire('profile_fill', 'job-1'), { code: 'linkedin_operation_active' })
  release()
  const releaseProfile = gate.acquire('profile_fill', 'job-1')
  releaseProfile()
  assert.equal(gate.current(), undefined)
}

try { run(); console.log('linkedin operation gate tests passed') }
catch (error) { console.error(error); process.exitCode = 1 }
