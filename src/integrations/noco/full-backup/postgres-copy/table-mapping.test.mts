import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareSql } from './prepare.mts';
import { sqlNamesFromInventory } from './sql-mapping.mts';
import { schemaSql } from './sql-schema.mts';
import type { Snapshot } from './snapshot.mts';
const table = { id: 'mt', title: 'CV processing', table_name: 'CV processing', columns: [
  { id: 'ci', title: 'Id', column_name: 'id', uidt: 'ID', pk: true, ai: true }
] };
const inventory = [{ id: 'mt', definition: { id: 'mt', sqlName: 'CV processing', sqlTable: 'noco.CV processing',
  mapping: [{ id: 'ci', sqlName: 'id', sqlType: 'bigint' }] } }];
const snapshot: Snapshot = { directory: '', tables: [table], data: new Map([['mt', [{ Id: 1 }]]]),
  edges: [], unavailable: new Map(), sourceIssues: [], manifest: { version: 1, baseId: 'pqe5susktrsa9z3',
    startedAt: '', completedAt: '2026-09-17T00:00:00Z', schemaHash: 'h', tables: [], links: 0, attachments: 0 } };
test('repeat import uses mapped table for schema, rows, verification and sequence ownership', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mapped-table-'));
  try {
    const names = sqlNamesFromInventory(inventory, snapshot.tables);
    await prepareSql(snapshot, directory, [], names);
    for (const name of ['import.sql', 'verify.sql']) {
      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      assert.match(sql, /noco\."CV processing"/); assert.doesNotMatch(sql, /noco\."mt"/);
    }
    const sql = await fs.readFile(path.join(directory, 'import.sql'), 'utf8');
    assert.match(sql, /OWNED BY noco\."CV processing"\."id"/);
    assert.match(sql, /incompatible_sql_table_mapping/);
    assert.match(schemaSql(snapshot), /incompatible_sql_table_mapping/);
    assert.equal(table.table_name, 'CV processing');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('table mapping does not allow another schema or two IDs mapped to one table', () => {
  assert.throws(() => sqlNamesFromInventory([{ ...inventory[0], definition: {
    ...inventory[0].definition, sqlTable: 'crm.CV processing' } }], [table]));
  assert.throws(() => sqlNamesFromInventory([...inventory, { id: 'other', definition: {
    ...inventory[0].definition, id: 'other', mapping: [] } }], [table, { ...table, id: 'other', columns: [] }]));
});
