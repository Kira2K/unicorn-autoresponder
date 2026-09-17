import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkingCatalog } from './working-catalog.mts';
import { sourceFields } from './local-columns.mts';
import { metadata, workingFake } from './working-fixture.mts';
import { createPostgresClient } from './working-client.mts';
import type { SqlPool } from './contracts.mts';
const extension = { sqlOnlyFor: 'mpeople', columns: [{ name: 'workflow_trace', sqlType: 'text' }] };
const rows = () => [...metadata.map(definition => ({ definition })), { definition: extension }];
test('local fields are separate, visible and excluded from the source projection', () => {
  const input = rows(), before = structuredClone(input), table = createWorkingCatalog(input).get('mpeople');
  assert.deepEqual(input, before);
  assert.equal(table.columns.find(c => c.dataKey === 'workflow_trace')?.sqlOnly, true);
  assert.deepEqual(sourceFields(table.columns, { Id: 1, Name: 'A', workflow_trace: 'private', unknown: 'x' }), { Id: 1, Name: 'A' });
  assert.equal(createWorkingCatalog(metadata.map(definition => ({ definition }))).get('mpeople').columns.length, table.columns.length - 1);
});
test('local/source collisions, duplicate definitions, unknown tables and CRM are rejected', () => {
  for (const columns of [[{ name: 'cname', sqlType: 'text' }], [...extension.columns, ...extension.columns]])
    assert.throws(() => createWorkingCatalog([...rows().slice(0, 2), { definition: { ...extension, columns } }]), { code: 'local_column_conflict' });
  for (const sqlOnlyFor of ['missing', 'linkedin_manager'])
    assert.throws(() => createWorkingCatalog([...rows().slice(0, 2), { definition: { ...extension, sqlOnlyFor } }]));
  for (const change of [{ sqlTable: 'noco.mpeople' }, { columns: [{ name: '_copy_source', sqlType: 'text' }] }])
    assert.throws(() => createWorkingCatalog([...rows().slice(0, 2), { definition: { ...extension, ...change } }]), { code: 'invalid_local_columns' });
});
test('CRUD uses physical local columns but never puts them into the Noco archive', async () => {
  const fake = workingFake();
  const pool: SqlPool = { end: fake.pool.end, async connect() {
    const s = await fake.pool.connect();
    return { release: s.release, async query(text, values) {
      const result = await s.query(text, values);
      return text.includes('copy_meta.inventory') ? { rows: rows() } : result;
    } };
  } };
  fake.state.rows = [{ source_json: JSON.stringify({ Id: 1, Name: 'A', workflow_trace: 'trace' }), record_key: '["1"]' }];
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  const result = await db.createRecord('mpeople', { Id: 1, Name: 'A', workflow_trace: 'trace' });
  assert.equal(result.data.workflow_trace, 'trace');
  const insert = fake.state.calls.find(c => c.text.startsWith('INSERT INTO'))!;
  assert.match(insert.text, /"workflow_trace"/);
  assert.deepEqual(JSON.parse(String(insert.values.at(-1))), { Id: 1, Name: 'A' });
  await db.patchRecord('mpeople', ['1'], { workflow_trace: '' });
  const update = fake.state.calls.find(c => c.text.startsWith('UPDATE'))!;
  assert.match(update.text, /SET "workflow_trace"=/); assert.doesNotMatch(update.text.split('WHERE')[0], /"cname"=/);
  await assert.rejects(db.patchRecord('mpeople', ['1'], { unregistered: 'bad' }), { code: 'field_not_writable' });
  const readOnly = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  await assert.rejects(readOnly.patchRecord('mpeople', ['1'], { workflow_trace: 'bad' }), { code: 'writes_disabled' });
});
