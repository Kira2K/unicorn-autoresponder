import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlNamesFromInventory } from './sql-mapping.mts';
import { sqlType } from './sql-values.mts';
import { insertRow, verifyRow } from './sql-rows.mts';
import { schemaSql } from './sql-schema.mts';
import { createWorkingCatalog } from '../../../postgres/working-catalog.mts';
import { parameter, projection } from '../../../postgres/working-records.mts';
import type { Snapshot } from './snapshot.mts';
const column = { id: 'ctag', title: 'Tags', column_name: 'Tags', uidt: 'MultiSelect' };
const table = { id: 'mtags', title: 'Projects', table_name: 'Projects', columns: [
  { id: 'cid', title: 'Id', column_name: 'id', uidt: 'ID', pk: true }, column
] };
const inventory = [{ id: table.id, definition: { ...table, sqlName: 'Projects', sqlTable: 'noco.Projects', mapping: [
  { id: 'cid', title: 'Id', sqlName: 'id', sqlType: 'bigint' },
  { id: 'ctag', title: 'Tags', sqlName: 'Tags', sqlType: 'text' }
] } }];
const snapshot = { tables: [table], unavailable: new Map(), manifest: { baseId: 'pqe5susktrsa9z3', schemaHash: 'h' } } as unknown as Snapshot;
test('explicit text-backed MultiSelect keeps import, verify and SQL-client string values', () => {
  const before = structuredClone(inventory), names = sqlNamesFromInventory(inventory, [table]);
  assert.equal(sqlType(column), 'jsonb');
  assert.equal(sqlType(column, names), 'text');
  assert.match(schemaSql(snapshot, names), /"Tags" text/);
  const working = createWorkingCatalog(inventory).get(table.id), tags = working.columns.find(c => c.id === column.id)!;
  assert.match(projection(working), /'Tags',t\."Tags"/);
  for (const value of [null, '', 'Documentation', 'Infrastructure,Bots', 'Юникод,☀']) {
    const row = { Id: 1, Tags: value };
    for (const sql of [insertRow(snapshot, table, row, names), verifyRow(snapshot, table, row, names)])
      assert.ok(sql.includes(value === null ? 'NULL::text' : "'" + value + "'::text"));
    assert.equal(parameter(tags, value), value);
  }
  assert.deepEqual(inventory, before);
});
test('unsupported physical conversion and non-string MultiSelect fail closed', () => {
  for (const type of ['numeric', 'boolean']) {
    const bad = structuredClone(inventory); bad[0].definition.mapping[1].sqlType = type;
    assert.throws(() => sqlNamesFromInventory(bad, [table]), /invalid_sql_mapping/);
  }
  const names = sqlNamesFromInventory(inventory, [table]);
  assert.throws(() => insertRow(snapshot, table, { Id: 1, Tags: ['Bots'] }, names), /non_text_source_value/);
});
