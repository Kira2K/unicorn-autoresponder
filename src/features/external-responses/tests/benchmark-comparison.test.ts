import test from 'node:test'
import assert from 'node:assert/strict'
import { compareDecisions } from '../benchmark/compare.ts'
test('comparison catches changed verdicts, missing/duplicate cases and invented evidence without fuzzy matching', () => {
  const gold = [{ id: 'a', global: 'eligible' as const, stacks: { python: 'eligible' as const }, evidenceText: 'Remote worldwide' }]
  const good = { id: 'a', global: 'eligible' as const, stacks: { python: 'eligible' as const }, evidence: ['Remote worldwide'] }
  assert.equal(compareDecisions(gold, [good]).equivalentQuality, true)
  assert.equal(compareDecisions(gold, [{ ...good, evidence: ['Remote US only'] }]).equivalentQuality, false)
  assert.equal(compareDecisions(gold, [good, good]).equivalentQuality, false)
  assert.equal(compareDecisions(gold, []).equivalentQuality, false)
  assert.equal(compareDecisions(gold, [{ ...good, global: 'excluded' }]).equivalentQuality, false)
})
