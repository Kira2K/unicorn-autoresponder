import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_MARKER } from '../../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../../integrations/postgres/contracts.mts';
import { metadata } from '../../../../integrations/postgres/working-fixture.mts';
import { cvLocalColumns, cvLocalDefinition, cvLocalKey, ensureCvSqlColumns } from './workflow-schema.mts';
import { tableIds } from './tables.mts';
function fixture(sqlName = tableIds.cv) {
  const source = { ...structuredClone(metadata[0]), id: tableIds.cv, title: 'CV processing', sqlName, sqlTable: `noco.${sqlName}` };
  const state = { definition: undefined as unknown, columns: [] as Record<string, unknown>[], calls: [] as string[], fail: '',
    database: 'unicorn_noco_copy_restore', releases: 0, inspectedNames: [] as unknown[] };
  const pool: SqlPool = { async end() {}, async connect() {
    const before = structuredClone({ definition: state.definition, columns: state.columns });
    return { release() { state.releases++; }, async query(text, values = []) {
      state.calls.push(text);
      if (state.fail && text.includes(state.fail)) throw Error('failure');
      if (text.includes('current_database()')) return { rows: [{ database: state.database, marker: COPY_MARKER }] };
      if (text.startsWith('SELECT id, definition')) return { rows: [{ id: tableIds.cv, definition: source },
        ...(state.definition ? [{ id: cvLocalKey, definition: state.definition }] : [])] };
      if (text.includes('information_schema.columns')) { state.inspectedNames.push(values[0]); return { rows: state.columns }; }
      if (text.startsWith('ALTER TABLE')) state.columns = cvLocalColumns.map(column_name =>
        ({ column_name, data_type: 'text', is_nullable: 'YES', column_default: null }));
      if (text.startsWith('INSERT INTO copy_meta.inventory')) state.definition = JSON.parse(String(values[1]));
      if (text === 'ROLLBACK') Object.assign(state, before);
      return { rows: [] };
    } };
  } };
  return { state, pool };
}
test('dry run does not write; one transaction adds three fields; repeat is a no-op', async () => {
  const { pool, state } = fixture();
  assert.equal((await ensureCvSqlColumns(pool, 'unicorn_noco_copy_restore')).ready, false);
  assert.equal(state.calls.some(c => /^(ALTER|INSERT)/.test(c)), false);
  assert.equal((await ensureCvSqlColumns(pool, 'unicorn_noco_copy_restore', true)).ready, true);
  assert.deepEqual(state.definition, cvLocalDefinition);
  state.definition = { columns: cvLocalDefinition.columns.map(c => ({ sqlType: c.sqlType, name: c.name })), sqlOnlyFor: tableIds.cv };
  await ensureCvSqlColumns(pool, 'unicorn_noco_copy_restore', true);
  assert.equal(state.calls.filter(c => c.startsWith('ALTER TABLE')).length, 1);
  assert.equal(state.calls.filter(c => c === 'COMMIT').length, 2);
});

test('renamed CV table is inspected and updated through its saved SQL name', async () => {
  const { pool, state } = fixture('CV processing');
  assert.equal((await ensureCvSqlColumns(pool, 'unicorn_noco_copy_restore', true)).ready, true);
  assert.ok(state.inspectedNames.every(name => name === 'CV processing'));
  assert.match(state.calls.find(c => c.startsWith('ALTER TABLE'))!, /^ALTER TABLE noco\."CV processing" /);
  assert.equal((await ensureCvSqlColumns(pool, 'unicorn_noco_copy_restore')).ready, true);
  assert.equal(state.calls.filter(c => c.startsWith('ALTER TABLE')).length, 1);
});
test('unknown/partial columns and a changed registry block the migration', async () => {
  for (const variant of ['unowned', 'partial', 'metadata']) {
    const { pool, state } = fixture();
    if (variant !== 'unowned') state.definition = { ...cvLocalDefinition, ...(variant === 'metadata' ? { unknown: true } : {}) };
    if (variant === 'unowned') state.columns = [{ column_name: cvLocalColumns[0] }];
    await assert.rejects(ensureCvSqlColumns(pool, 'unicorn_noco_copy_restore', true));
    assert.equal(state.calls.some(c => c.startsWith('ALTER TABLE')), false);
  }
});
test('wrong database, failed save and uncertain COMMIT never retry DDL', async () => {
  for (const fail of ['INSERT INTO', 'COMMIT', 'database']) {
    const { pool, state } = fixture();
    if (fail === 'database') state.database = 'linkedin_manager'; else state.fail = fail;
    await assert.rejects(ensureCvSqlColumns(pool, 'unicorn_noco_copy_restore', true));
    assert.ok(state.calls.filter(c => c.startsWith('ALTER TABLE')).length <= 1);
    assert.equal(state.definition, undefined); assert.equal(state.columns.length, 0);
    assert.equal(state.releases, 1); assert.ok(state.calls.includes('ROLLBACK'));
  }
});
