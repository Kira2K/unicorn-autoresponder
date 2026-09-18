import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog } from './catalog.mts';
import { createPostgresClient } from './working-client.mts';
import { generatedIdColumn, assignGeneratedId } from './generated-ids.mts';
import { createWorkingCatalog } from './working-catalog.mts';
import { workingFake, metadata } from './working-fixture.mts';

test('mapped physical table preserves IDs, working reads, patches, joins and ID allocation', async () => {
  const { pool, state } = workingFake();
  for (const t of state.definitions) Object.assign(t, { sqlName: t.title, sqlTable: `noco.${t.title}` });
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  state.rows = [{ record_key: '["1"]', source_json: '{"Id":1,"Name":"same"}' }];
  assert.equal((await db.getRecord('mpeople', ['1']))?.data.Name, 'same');
  await db.patchRecord('mpeople', ['1'], { Name: 'changed' });
  await db.listRelated('mpeople', 'cteamlink', ['1']);
  assert.ok(state.calls.some(c => /UPDATE noco\."clients"/.test(c.text)));
  assert.ok(state.calls.some(c => /JOIN noco\."teams"/.test(c.text)));
  assert.ok(!state.calls.some(c => /noco\."mpeople"|noco\."mteams"/.test(c.text)));
  const table = createWorkingCatalog(state.definitions.map(definition => ({ definition }))).get('mpeople');
  const data: Record<string, unknown> = {};
  assert.equal(generatedIdColumn(table).id, 'cid');
  await assignGeneratedId({ release() {}, async query(_text, values) {
    assert.deepEqual(values, ['noco."clients"', 'cid']); return { rows: [{ id: '2' }] };
  } }, table, data);
  assert.equal(data.Id, '2');
});
test('working reader handles spaces in physical names without modifying source names', async () => {
  const { pool, state } = workingFake();
  Object.assign(state.definitions[0], { sqlName: 'CV processing', sqlTable: 'noco.CV processing' });
  state.rows = [{ record_key: '["1"]', source_json: '{"Id":1}' }];
  const client = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  assert.equal((await client.getRecord('mpeople', ['1']))?.key[0], '1');
  await client.listRelated('mteams', 'cpeople', ['1']);
  assert.ok(state.calls.some(c => c.text.includes('FROM noco."CV processing"')));
  assert.ok(state.calls.some(c => c.text.includes('JOIN noco."CV processing"')));
  assert.equal(client.listTables()[0].table_name, 'clients');
});
test('physical mapping rejects mismatches, collisions, CRM aliases and invalid identifiers', () => {
  for (const values of [
    { sqlName: 'clients', sqlTable: 'other.clients' },
    { sqlName: 'teams', sqlTable: 'noco.teams' },
    { sqlName: 'linkedin_manager_tasks', sqlTable: 'noco.linkedin_manager_tasks' },
    { sqlName: '', sqlTable: 'noco.' },
    { sqlName: 'x'.repeat(64), sqlTable: 'noco.' + 'x'.repeat(64) },
    { sqlName: 'x\0', sqlTable: 'noco.x\0' }
  ]) {
    const definitions = structuredClone(metadata);
    Object.assign(definitions[1], { sqlName: 'teams', sqlTable: 'noco.teams' });
    Object.assign(definitions[0], values);
    assert.throws(() => createCatalog(definitions.map(definition => ({ definition }))));
  }
});
