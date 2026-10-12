import assert from 'node:assert/strict'
import test from 'node:test'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { loadApplicationFormMemory, saveVerifiedApplicationFormMemory } from '../applications/source-memory.ts'
import type { SqlOperation } from '../infrastructure/postgres.ts'
import type { Field } from '../types.ts'
import { createApplicationFormMemory } from '../application_workflow/form-memory.ts'

const fields: Field[] = [{ key: 'resume', label: 'Resume', type: 'file', required: true, options: [] }]
const base = { sourceId: '12', companyId: '34', applyUrl: 'https://jobs.example.test/apply/5?candidate=private', engine: 'greenhouse@2' }
const stamp = (day: number) => `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`
function fixture(initial: Record<string, unknown> = { version: 1, snapshot: { runId: 'other' }, decisions: { a: 'keep' } }) {
  let state = structuredClone(initial)
  const queries: { text: string; values?: unknown[] }[] = []
  const operation: SqlOperation = async callback => callback({
    async query(text, values) {
      queries.push({ text, values })
      if (text.startsWith('SELECT')) return { rows: values?.[0] === '12' && values?.[1] === '34' ? [{ collection_state: structuredClone(state) }] : [] }
      if (text.startsWith('UPDATE')) { state = JSON.parse(String(values?.[2])); return { rows: [] } }
      throw Error('unexpected_sql')
    },
    release() {},
  })
  return { operation, queries, get state() { return state } }
}
const verified = (formFields: Field[] = fields, day = 6) => ({ ...base, fields: formFields, formSignature: digest(formFields), verifiedAt: stamp(day), verified: true as const })

test('stores public schema under separate namespace, preserving collection memory', async () => {
  const db = fixture({ version: 1, collection: { keep: true }, decisions: { x: 42 }, collection_recipe: 'untouched' })
  const secret = { ...verified(), answers: { resume: { value: 'private CV', evidence: ['email@example.com'] } },
    candidate: { email: 'email@example.com' }, credential: 'password', script: 'alert(1)' }
  await saveVerifiedApplicationFormMemory(secret, db.operation)
  const stored = db.state as any
  assert.deepEqual(stored.collection, { keep: true })
  assert.deepEqual(stored.decisions, { x: 42 })
  assert.equal(stored.collection_recipe, 'untouched')
  assert.equal(stored.applicationForms.version, 1)
  assert.equal(stored.applicationForms.variants[0].applyOrigin, 'https://jobs.example.test')
  assert.equal(JSON.stringify(stored).includes('private CV'), false)
  assert.equal(JSON.stringify(stored).includes('email@example.com'), false)
  assert.equal(JSON.stringify(stored).includes('password'), false)
  assert.equal(JSON.stringify(stored).includes('alert(1)'), false)
  assert.match(db.queries[0].text, /FOR UPDATE/)
  assert.equal(db.queries.some(query => query.text.includes('collection_recipe=$')), false)
})

test('reads only the exact source, company, origin, engine and optional form signature', async () => {
  const db = fixture()
  await saveVerifiedApplicationFormMemory(verified(), db.operation)
  assert.equal((await loadApplicationFormMemory(base, db.operation))?.formSignature, digest(fields))
  assert.equal(await loadApplicationFormMemory({ ...base, companyId: '35' }, db.operation), null)
  assert.equal(await loadApplicationFormMemory({ ...base, applyUrl: 'https://other.example.test/apply' }, db.operation), null)
  assert.equal(await loadApplicationFormMemory({ ...base, engine: 'greenhouse@3' }, db.operation), null)
  assert.equal(await loadApplicationFormMemory({ ...base, formSignature: '0'.repeat(64) }, db.operation), null)
})

test('rejects unverified snapshots, invalid scope, LinkedIn, and schema mismatch without writing', async () => {
  const db = fixture()
  for (const input of [
    { ...verified(), verified: false },
    { ...verified(), sourceId: '12 OR 1=1' },
    { ...verified(), applyUrl: 'http://jobs.example.test/apply' },
    { ...verified(), applyUrl: 'https://linkedin.com/jobs/1' },
    { ...verified(), formSignature: '0'.repeat(64) },
    { ...verified(), fields: [{ ...fields[0], answer: 'private' }] },
  ]) {
    if (input.fields?.[0] && 'answer' in input.fields[0]) {
      await saveVerifiedApplicationFormMemory(input as any, db.operation)
      assert.equal(JSON.stringify(db.state).includes('private'), false)
    } else await assert.rejects(saveVerifiedApplicationFormMemory(input as any, db.operation))
  }
  assert.equal((db.state as any).applicationForms.variants.length, 1)
})

test('bounds variants and invalidates malformed saved schemas', async () => {
  const db = fixture()
  for (let day = 1; day <= 12; day++) {
    const variant = [{ ...fields[0], key: `field${day}` }]
    await saveVerifiedApplicationFormMemory(verified(variant, day), db.operation)
  }
  assert.equal((db.state as any).applicationForms.variants.length, 8)
  assert.equal((await loadApplicationFormMemory(base, db.operation))?.formSignature, digest([{ ...fields[0], key: 'field12' }]))
  const corrupted = structuredClone(db.state) as any
  corrupted.applicationForms.variants[0].fields[0].label = 'changed'
  const stale = fixture(corrupted)
  assert.equal((await loadApplicationFormMemory(base, stale.operation))?.formSignature, digest([{ ...fields[0], key: 'field11' }]))
})

test('keeps realistic ATS bracket keys and complete country menus without truncation', async () => {
  const db = fixture()
  const fields: Field[] = [{ key: 'name:cards[abc-123][field0]', label: 'Country of residence', type: 'select', required: true,
    options: Array.from({ length: 250 }, (_, i) => `Country ${i + 1}`) }]
  await saveVerifiedApplicationFormMemory(verified(fields), db.operation)
  assert.deepEqual((await loadApplicationFormMemory(base, db.operation))?.fields, fields)
})

test('workflow recognizes an older verified variant and does not confuse source bindings', async () => {
  const db = fixture(), memory = createApplicationFormMemory({ read: db.operation, write: db.operation })
  await saveVerifiedApplicationFormMemory(verified(fields, 5), db.operation)
  await saveVerifiedApplicationFormMemory(verified([{ ...fields[0], key: 'other' }], 6), db.operation)
  const position: any = { applyUrl: base.applyUrl, source: { database: { sourceId: base.sourceId, companyId: base.companyId } } }
  assert.equal(await memory.inspect(position, base.engine, fields), 'known')
  assert.equal(await memory.inspect(position, base.engine, [{ ...fields[0], key: 'new' }]), 'changed')
  assert.equal(await memory.inspect({ ...position, source: { database: { sourceId: '13', companyId: '34' } } }, base.engine, fields), 'new')
})
