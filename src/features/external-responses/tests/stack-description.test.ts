import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createWorkingCatalog } from '../../../integrations/postgres/working-catalog.mts'

const sql = await readFile(new URL('../stack_catalog/migrations/001_stack_description.sql', import.meta.url), 'utf8')
const definition = {
  id: 'msr3ihfj0kjue1t', title: 'stacks', table_name: 'stacks', sqlName: 'stacks', sqlTable: 'noco.stacks',
  columns: [{ id: 'cid', title: 'Id', pk: true }, { id: 'cname', title: 'name' }],
  mapping: [{ id: 'cid', title: 'Id', sqlName: 'id', sqlType: 'bigint' }, { id: 'cname', title: 'name', sqlName: 'name', sqlType: 'text' }]
}
async function fixture() {
  const db = new PGlite()
  await db.exec('CREATE SCHEMA noco; CREATE SCHEMA copy_meta; CREATE TABLE noco.stacks(id bigint PRIMARY KEY,name text,updated_at timestamptz); CREATE TABLE copy_meta.inventory(id text PRIMARY KEY,definition jsonb NOT NULL);')
  await db.query('INSERT INTO copy_meta.inventory VALUES ($1,$2)', ['stacks', definition])
  await db.exec("INSERT INTO noco.stacks(id,name) VALUES (5,'JAVA'),(7,'GO')")
  return db
}

test('stack description migration seeds only Java, preserves source metadata and is repeatable', async () => {
  const db = await fixture()
  try {
    for (let i = 0; i < 2; i++) await db.exec(`BEGIN; ${sql} COMMIT;`)
    const rows = (await db.query<{ id: number; stack_description: string | null }>('SELECT id,stack_description FROM noco.stacks ORDER BY id')).rows
    assert.equal(rows[0].stack_description, 'Middle/senior backend positions using Java and the Spring framework.')
    assert.equal(rows[1].stack_description, null)
    const metadata = (await db.query<{ definition: typeof definition }>('SELECT definition FROM copy_meta.inventory ORDER BY id')).rows
    assert.equal(metadata.length, 2)
    assert.deepEqual(metadata.find(row => row.definition.id)?.definition, definition)
    assert.equal(createWorkingCatalog(metadata).get(definition.id).columns.find(c => c.dataKey === 'stack_description')?.sqlType, 'text')
  } finally { await db.close() }
})

test('migration refuses to overwrite an edited description; failure rolls back metadata registration', async () => {
  const db = await fixture()
  try {
    await db.exec("ALTER TABLE noco.stacks ADD COLUMN stack_description text; UPDATE noco.stacks SET stack_description='Existing reviewed criteria' WHERE id=5")
    await assert.rejects(db.exec(`BEGIN; ${sql} COMMIT;`), /java_description_already_configured/)
    await db.exec('ROLLBACK')
    assert.deepEqual((await db.query('SELECT stack_description FROM noco.stacks WHERE id=5')).rows, [{ stack_description: 'Existing reviewed criteria' }])
    assert.equal((await db.query('SELECT * FROM copy_meta.inventory')).rows.length, 1)
  } finally { await db.close() }
})
