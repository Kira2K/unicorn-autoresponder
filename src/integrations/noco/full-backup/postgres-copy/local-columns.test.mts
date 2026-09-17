import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaSql } from './sql-schema.mts';
import { insertRow } from './sql-rows.mts';
import type { Snapshot } from './snapshot.mts';
test('source import touches only source columns and its own inventory rows', () => {
  const table = { id: 'mcv', title: 'CV processing', table_name: 'cv', columns: [
    { id: 'cid', title: 'Id', column_name: 'id', uidt: 'ID', pk: true },
    { id: 'cstatus', title: 'status', column_name: 'status', uidt: 'SingleLineText' }
  ] };
  const snapshot: Snapshot = { directory: '', manifest: { version: 1, baseId: 'pqe5susktrsa9z3',
    startedAt: '', schemaHash: 'schema-hash', tables: [], links: 0, attachments: 0 },
    tables: [table], data: new Map(), edges: [], sourceIssues: [], unavailable: new Map() };
  const before = structuredClone(snapshot), schema = schemaSql(snapshot), row = insertRow(snapshot, table, { Id: 1, status: 'filled' });
  assert.match(schema, /ON CONFLICT \(id\) DO UPDATE SET definition=EXCLUDED.definition/);
  assert.match(row, /ON CONFLICT \(_copy_id\) DO UPDATE/);
  assert.doesNotMatch(schema + row, /last_responsible|last_workflow_error|workflow_trace|sql-only:|DROP |TRUNCATE |DELETE FROM copy_meta/);
  assert.deepEqual(snapshot, before);
});
