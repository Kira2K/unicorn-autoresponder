import test from 'node:test'
import assert from 'node:assert/strict'
import { applicationStatus } from '../application_workflow/status.ts'
import { applicationWorkerPacket } from '../application_workflow/worker-packet.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'

test('worker packet stays small without losing reconciliation or rule gates', async () => {
  const rules = await loadSelectionRules()
  const batch: any = { records: [{ position: { id: 'role', title: 'Engineer', description: 'PRIVATE DESCRIPTION '.repeat(5000) },
    status: 'unknown', attempt: 2, reason: 'unknown_outcome', answers: { values: { name: 'PRIVATE ANSWER' },
      missing: [{ key: 'question', label: 'PRIVATE QUESTION', type: 'select', options: ['OPTION '.repeat(5000)] }] } }] }
  const input = { candidateId: 'candidate', batchId: 'batch', positionIds: ['role'], cvMode: 'original' as const }
  const status = applicationStatus(input, batch, undefined, rules)
  const packet = applicationWorkerPacket(status, 'workflow.json')
  assert.equal(packet.target.next, 'reconcile_existing_attempt')
  assert.equal(packet.target.attempt, 2)
  assert.equal(packet.rules.status, 'requires_revalidation')
  assert.equal(packet.target.missingQuestionCount, 1)
  assert.equal(packet.cvMode, 'original')
  assert.doesNotMatch(JSON.stringify(packet), /PRIVATE|OPTION/)
  assert.ok(Buffer.byteLength(JSON.stringify(packet)) < 2000)
  assert.ok(Buffer.byteLength(JSON.stringify(status)) > 30000)
  // Full fields remain available for an explicit status read, never silently shortened.
  assert.deepEqual(status.targets[0].missingQuestions[0].options, batch.records[0].answers.missing[0].options)
})

test('worker packets cannot silently choose or add a target', async () => {
  const rules = await loadSelectionRules()
  const status = applicationStatus({ candidateId: 'c', batchId: 'b', positionIds: ['a', 'b'] }, undefined, rules, rules)
  assert.throws(() => applicationWorkerPacket(status, 'input'), /requires_one_position/)
  assert.throws(() => applicationWorkerPacket(status, 'input', 'outside'), /outside_batch/)
  assert.equal(applicationWorkerPacket(status, 'input', 'b').target.id, 'b')
  assert.equal(status.targets.length, 2)
})

test('completed target stays complete in a fresh worker packet', async () => {
  const rules = await loadSelectionRules()
  const batch: any = { records: [{ position: { id: 'role' }, status: 'succeeded', attempt: 1 }] }
  const status = applicationStatus({ candidateId: 'c', batchId: 'b', positionIds: ['role'] }, batch, rules, rules)
  assert.equal(applicationWorkerPacket(status, 'input').target.next, 'none')
})
