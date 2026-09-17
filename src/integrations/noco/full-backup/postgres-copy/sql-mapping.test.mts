import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlNamesFromInventory } from './sql-mapping.mts';
import { schemaSql } from './sql-schema.mts';
import { insertRow, verifyRow } from './sql-rows.mts';
import type { Snapshot } from './snapshot.mts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareSql } from './prepare.mts';
const table = { id: 'mt', title: 'Test', table_name: 'Test', columns: [
  { id: 'ci', title: 'Id', column_name: 'id', uidt: 'ID', pk: true, ai: true },
  { id: 'ca', title: 'Author', column_name: 'created_by', uidt: 'CreatedBy' }
] };
const inventory = [{ id: 'mt', definition: { id: 'mt', sqlTable: 'noco.mt', mapping: [
  { id: 'ci', sqlName: 'id', sqlType: 'bigint' },
  { id: 'ca', sqlName: 'source_created_by', sqlType: 'jsonb' }
] } }];
const snapshot: Snapshot = { directory: '', tables: [table], data: new Map(), edges: [],
  unavailable: new Map(), sourceIssues: [], manifest: { version: 1, baseId: 'pqe5susktrsa9z3',
    startedAt: '', schemaHash: 'h', tables: [], links: 0, attachments: 0 } };
test('repeat import and verification use persistent physical names without mutating source metadata', () => {
  const before = structuredClone({ snapshot, inventory });
  const names = sqlNamesFromInventory(inventory, snapshot.tables);
  const row = { Id: 12, Author: { id: 'original' } };
  for (const sql of [schemaSql(snapshot, names), insertRow(snapshot, table, row, names), verifyRow(snapshot, table, row, names)]) {
    assert.match(sql, /source_created_by/);
    assert.doesNotMatch(sql, /"created_by" (?:jsonb|IS)|ALTER .*RENAME/);
  }
  assert.deepEqual({ snapshot, inventory }, before);
  assert.doesNotMatch(insertRow(snapshot, table, row, names), /workflow_trace|last_responsible/);
});
test('an import without the current mapping fails closed against aliased SQL inventory', () => {
  assert.match(schemaSql(snapshot), /incompatible_sql_mapping/);
});
test('an unavailable source field never clears an existing SQL value or claims verification', () => {
  const current = { ...snapshot, unavailable: new Map([[table.id, new Set(['ca'])]]) };
  const row = { Id: 1 }, names = sqlNamesFromInventory(inventory, current.tables);
  const update = insertRow(current, table, row, names).split('DO UPDATE SET')[1];
  assert.doesNotMatch(update, /source_created_by/);
  assert.doesNotMatch(verifyRow(current, table, row, names), /source_created_by/);
});
test('mapping rejects wrong table, incompatible type, duplicate names and service columns', () => {
  for (const mutate of [
    (x: typeof inventory) => { x[0].definition.sqlTable = 'crm.mt'; },
    (x: typeof inventory) => { x[0].definition.mapping[1].sqlType = 'text'; },
    (x: typeof inventory) => { x[0].definition.mapping[1].sqlName = 'id'; },
    (x: typeof inventory) => { x[0].definition.mapping[1].sqlName = '_copy_source'; },
    (x: typeof inventory) => { x[0].definition.mapping.push(x[0].definition.mapping[0]); }
  ]) {
    const input = structuredClone(inventory); mutate(input);
    assert.throws(() => sqlNamesFromInventory(input, snapshot.tables), /invalid_sql_mapping/);
  }
});
test('repeat import does not rewind issued IDs or reset is_called after rows were deleted', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noco-sequence-test-'));
  try {
    const current = { ...snapshot, manifest: { ...snapshot.manifest, completedAt: '2026-09-17T00:00:00Z' },
      data: new Map([[table.id, []]]) };
    await prepareSql(current, directory, [], sqlNamesFromInventory(inventory, current.tables));
    const sql = await fs.readFile(path.join(directory, 'import.sql'), 'utf8');
    assert.match(sql, /GREATEST\(COALESCE/);
    assert.match(sql, /SELECT last_value FROM noco\."seq_ci"/);
    assert.match(sql, /OR \(SELECT is_called FROM noco\."seq_ci"\)/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
