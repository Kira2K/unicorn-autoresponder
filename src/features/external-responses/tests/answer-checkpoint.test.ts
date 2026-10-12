import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareWithCheckpoint } from '../application_preparation/checkpoint.ts'
import { createAnswerGenerator } from '../application_preparation/answers.ts'
import { withPreparedAnswers } from '../application_preparation/prepared-answers.ts'

const field = (key: string, label = key) => ({ key, label, type: 'text', required: true, options: [] })
const input: any = { candidate: { id: 'student', databaseClientId: '35', facts: {}, cv: { sha256: 'original' } }, position: { id: 'role', title: 'Engineer', description: 'React', applyUrl: 'https://example.test/apply' }, engine: 'lever@2', form: { fields: [field('a'), field('b')], text: '', url: 'https://example.test/apply', closed: false, aiBan: false } }

test('resume reuses unchanged answers; only new or changed fields reach the generator', async () => {
  const calls: string[][] = []
  const generator: any = { cacheKey: () => 'fixture-v1', generate: async (_c: any, _p: any, f: any) => { calls.push(f.fields.map((f: any) => f.key)); return { values: Object.fromEntries(f.fields.map((f: any) => [f.key, { value: f.label, evidence: ['fixture'] }])), missing: [] } } }
  const first = await prepareWithCheckpoint(input, generator)
  const reused = await prepareWithCheckpoint({ ...input, previous: first.checkpoint }, generator)
  assert.deepEqual(calls, [['a', 'b']]); assert.equal(reused.reused, 2)
  const changed = { ...input, previous: first.checkpoint, form: { ...input.form, fields: [field('a'), field('b', 'Changed question'), field('c')] } }
  const next = await prepareWithCheckpoint(changed, generator)
  assert.deepEqual(calls[1], ['b', 'c']); assert.equal(next.answers.values.b.value, 'Changed question')
})

test('candidate, vacancy, engine, facts, options and unversioned generators cannot reuse incompatible answers', async () => {
  let calls = 0
  const generator: any = { cacheKey: () => 'v1', generate: async () => { calls++; return { values: {}, missing: input.form.fields } } }
  const first = await prepareWithCheckpoint(input, generator)
  for (const change of [{ candidate: { ...input.candidate, id: 'other' } }, { candidate: { ...input.candidate, facts: { country: 'Spain' } } }, { position: { ...input.position, id: 'other' } }, { engine: 'lever@3' }, { form: { ...input.form, fields: [ { ...field('a'), options: ['Yes', 'No'] } ] } }]) {
    assert.equal((await prepareWithCheckpoint({ ...input, ...change, previous: first.checkpoint }, generator)).generated > 0, true)
  }
  await prepareWithCheckpoint({ ...input, previous: first.checkpoint }, { generate: generator.generate })
  assert.equal(calls, 7)
})

test('changing one scoped override invalidates only its answer and never edits candidate facts', async () => {
  const base = createAnswerGenerator(), facts = structuredClone(input.candidate.facts)
  const prepare = (value: string) => withPreparedAnswers(base, { a: { value, evidence: ['operator scoped answer'] } })
  const first = await prepareWithCheckpoint(input, prepare('Yes'))
  const next = await prepareWithCheckpoint({ ...input, previous: first.checkpoint }, prepare('No'))
  assert.equal(next.reused, 1); assert.equal(next.generated, 1); assert.equal(next.answers.values.a.value, 'No')
  assert.deepEqual(input.candidate.facts, facts)
})

test('inconsistent required-answer checkpoints are regenerated rather than silently treated as complete', async () => {
  const generator = withPreparedAnswers(createAnswerGenerator(), { a: { value: 'Yes', evidence: ['confirmed'] } })
  const first = await prepareWithCheckpoint(input, generator)
  delete first.checkpoint.fields.a.answer
  first.checkpoint.fields.a.missing = false
  const fixed = await prepareWithCheckpoint({ ...input, previous: first.checkpoint }, generator)
  assert.equal(fixed.generated, 1)
  assert.equal(fixed.answers.values.a.value, 'Yes')
})
