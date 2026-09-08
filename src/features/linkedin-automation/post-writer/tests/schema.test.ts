import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensurePostSchema, columns } from '../../../../integrations/noco/linkedin-post-writer-schema/logic.ts'
import { tableNames } from '../noco-store.ts'
import type { NocoTransport } from '../noco-transport.ts'

function fixture(existing = true) {
  const tables = new Map<string, { id: string; title: string; columns: Record<string, unknown>[] }>()
  const writes: { method: string; body: unknown }[] = []
  if (existing) tables.set(tableNames.settings, { id: tableNames.settings,
    title: tableNames.settings, columns: structuredClone(columns) })
  const http: NocoTransport = {
    baseId: 'test', records: async () => [],
    async request(method, path, body) {
      if (method !== 'GET') writes.push({ method, body: structuredClone(body) })
      if (path.includes('/meta/bases/')) {
        if (method === 'POST') {
          const value = body as { title: string; columns: Record<string, unknown>[] }
          tables.set(value.title, { id: value.title, title: value.title, columns: value.columns })
        }
        return { list: structuredClone([...tables.values()]) }
      }
      if (path.includes('/meta/tables/') && method === 'GET') return structuredClone(tables.get(path.split('/').at(-1)!))
      throw new Error('Unexpected schema request')
    }
  }
  return { http, writes, tables }
}

test('dry-run reports two missing tables without paid Unique Fields', async () => {
  const f = fixture()
  const result = await ensurePostSchema(f.http)
  assert.equal(result[0].missing.length, 0)
  assert.equal(result.filter(table => table.missing.length).length, 2)
  assert.equal(f.writes.length, 0)
})

test('schema creation uses ordinary text keys, never unique or unsigned', async () => {
  const f = fixture(false)
  assert.ok((await ensurePostSchema(f.http, true)).every(table => !table.missing.length))
  assert.equal(f.writes.length, 3)
  for (const write of f.writes) {
    const key = (write.body as { columns: Record<string, unknown>[] }).columns.find(column => column.title === 'record_key')!
    assert.equal('unique' in key, false)
    assert.equal('un' in key, false)
  }
})

test('existing settings table is preserved; second apply performs no mutations', async () => {
  const f = fixture(), original = structuredClone(f.tables.get(tableNames.settings))
  await ensurePostSchema(f.http, true)
  assert.equal(f.writes.length, 2)
  assert.deepEqual(f.tables.get(tableNames.settings), original)
  await ensurePostSchema(f.http, true)
  assert.equal(f.writes.length, 2)
  assert.ok(f.writes.every(write => write.method === 'POST'))
})

test('incompatible existing fields block apply rather than being overwritten', async () => {
  const f = fixture()
  f.tables.get(tableNames.settings)!.columns.find(field => field.title === 'record_key')!.uidt = 'Number'
  await assert.rejects(ensurePostSchema(f.http, true), /schema_incomplete/)
  assert.equal(f.writes.length, 0)
})
