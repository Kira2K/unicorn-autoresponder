import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresClient } from './working-client.mts';
import type { PostgresTransaction } from './working-client.mts';
import { workingFake } from './working-fixture.mts';
import { createWorkingCatalog } from './working-catalog.mts';
import { parameter, projection } from './working-records.mts';
test('bad marker and forbidden database never allow a write', async () => {
  const { pool, state } = workingFake();
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  state.marker = 'wrong';
  await assert.rejects(db.createRecord('mpeople', { Id: '1' }), /database_not_allowed/);
  assert.ok(!state.calls.some(c => c.text.startsWith('INSERT')));
  state.database = 'linkedin_manager';
  await assert.rejects(createPostgresClient(pool, 'unicorn_noco_copy_restore'), /database_not_allowed/);
});
test('expired transaction cannot be reused; swallowed operation errors cannot commit', async () => {
  const { pool, state } = workingFake();
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  let saved: PostgresTransaction | undefined;
  await db.transaction(async tx => { saved = tx; });
  const count = state.calls.length;
  await assert.rejects(saved!.getRecord('mpeople', ['1']), /transaction_closed/);
  assert.equal(state.calls.length, count);
  await assert.rejects(db.transaction(async tx => {
    try { await tx.patchRecord('mpeople', ['1'], { unknown: true }); } catch { /* caller tries to hide failure */ }
  }), /field_not_writable/);
  assert.equal(state.calls.at(-1)?.text, 'ROLLBACK');
});
test('FK updates fail for missing parents; deletion fails when still referenced', async () => {
  const { pool, state } = workingFake();
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  await assert.rejects(db.patchRecord('mpeople', ['1'], { TeamId: '404' }), /invalid_reference/);
  assert.ok(!state.calls.some(c => c.text.startsWith('UPDATE')));
  const incomingPool = { ...pool, async connect() {
    const session = await pool.connect(); return { ...session, async query(text: string, values?: unknown[]) {
      if (text.startsWith('SELECT 1 FROM') && text.includes(' JOIN ')) return { rows: [{ exists: 1 }] };
      return session.query(text, values);
    } };
  } };
  const guarded = await createPostgresClient(incomingPool, 'unicorn_noco_copy_restore', { writable: true });
  await assert.rejects(guarded.deleteRecord('mteams', ['1']), /record_is_referenced/);
});
test('NULL, empty strings and JSON arrays stay distinct; unsafe numeric inputs fail', () => {
  const { state } = workingFake();
  const c = createWorkingCatalog(state.definitions.map(definition => ({ definition }))).get('mpeople').columns;
  const text = c.find(c => c.title === 'Name')!, json = c.find(c => c.title === 'Json')!;
  assert.equal(parameter(text, ''), ''); assert.equal(parameter(text, null), null);
  assert.equal(parameter(json, ['Русский', null, '']), '["Русский",null,""]');
  assert.throws(() => parameter(text, 123));
  assert.throws(() => parameter(c[0], 9007199254740992), /invalid_field_value/);
});
test('metadata cannot inject SQL; large tables avoid PostgreSQL function argument limit', () => {
  const { state } = workingFake();
  state.definitions[0].mapping[0].sqlType = 'text); DROP TABLE anything;--';
  assert.throws(() => createWorkingCatalog(state.definitions.map(definition => ({ definition }))).get('mpeople'));
  const good = workingFake(); const table = createWorkingCatalog(good.state.definitions.map(definition => ({ definition }))).get('mpeople');
  table.columns = Array.from({ length: 101 }, (_, i) => ({ ...table.columns[1], id: `c${i}`, title: `Field '${i}`, dataKey: `Field '${i}`, sqlName: `c${i}` }));
  const sql = projection(table); assert.equal((sql.match(/jsonb_build_object/g) ?? []).length, 3);
  assert.match(sql, /Field ''0/);
});
test('duplicate display labels use stable field IDs without losing either column', () => {
  const { state } = workingFake();
  state.definitions[0].columns[2].title = 'Name';
  state.definitions[0].mapping[2].title = 'Name';
  const t = createWorkingCatalog(state.definitions.map(definition => ({ definition }))).get('mpeople');
  assert.equal(t.columns[1].dataKey, 'cname'); assert.equal(t.columns[2].dataKey, 'cmail');
  const sql = projection(t); assert.match(sql, /'cname',t\."cname"/); assert.match(sql, /'cmail',t\."cmail"/);
});
