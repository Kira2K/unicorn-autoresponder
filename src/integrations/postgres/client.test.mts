import test from 'node:test'; import assert from 'node:assert/strict';
import { createPostgresClient } from './working-client.mts';
import { workingFake } from './working-fixture.mts';
test('metadata excludes CRM; invalid tables cannot query data or write by default', async () => {
  const { pool, state } = workingFake();
  state.definitions[1].title = 'CRM'; state.definitions[1].table_name = 'linkedin_manager_tasks';
  const client = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  assert.deepEqual(client.listTables().map(t => t.id), ['mpeople']);
  for (const id of ['mteams', 'unknown', 'mpeople; DROP TABLE crm'])
    await assert.rejects(client.getRecord(id, ['1']));
  await assert.rejects(client.listRelated('mpeople', 'cteamlink', ['1']), /table_not_allowed/);
  await assert.rejects(client.listRelated('mpeople', 'missing', ['1']));
  await assert.rejects(client.createRecord('mpeople', { Id: '1' }), /writes_disabled/);
  assert.ok(!state.calls.some(c => /FROM noco\.|INSERT/.test(c.text)));
  assert.equal('query' in client, false);
});
test('read-only keyset pages, relation pages, exact record and missing record', async () => {
  const { pool, state } = workingFake(), connect = pool.connect;
  const records = [1, 2, 3].map(Id => ({ record_key: JSON.stringify([String(Id)]), source_json: JSON.stringify({ Id, Name: '' }) }));
  pool.connect = async () => {
    const s = await connect(); return { ...s, async query(text, values = []) {
      const result = await s.query(text, values);
      if (!text.includes('AS source_json')) return result;
      if (text.includes('WHERE t._copy_id=$1')) return { rows: records.filter(r => r.record_key === values[0]) };
      const related = text.includes(' JOIN '), after = values[related ? 1 : 0], limit = Number(values[related ? 2 : 1]);
      return { rows: records.filter(r => after === null || r.record_key > String(after)).slice(0, limit) };
    } };
  };
  const client = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  const first = await client.listRecords('mpeople', { limit: 2 });
  assert.deepEqual(first.records.map(r => r.data.Id), [1, 2]); assert.deepEqual(first.nextKey, ['2']);
  const second = await client.listRecords('mpeople', { limit: 2, after: first.nextKey! });
  assert.deepEqual(second.records.map(r => r.data.Id), [3]); assert.equal(second.nextKey, null);
  assert.equal((await client.getRecord('mpeople', ['1']))?.data.Name, '');
  assert.equal(await client.getRecord('mpeople', ['404']), null);
  assert.deepEqual((await client.listRelated('mteams', 'cpeople', ['1'], { limit: 2 })).nextKey, ['2']);
  assert.equal(state.calls.filter(c => c.text === 'BEGIN READ ONLY').length, state.releases.length);
  assert.equal(state.calls.filter(c => c.text === 'ROLLBACK').length, state.releases.length);
  assert.ok(state.releases.every(v => !v));
});
test('key values use parameters, invalid pages are blocked and input/catalog cannot be mutated', async () => {
  const { pool, state } = workingFake(); const client = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  const key = Object.freeze(["x'); DELETE FROM crm; --"]);
  await client.getRecord('mpeople', key);
  const query = state.calls.find(c => c.text.includes('WHERE t._copy_id=$1'))!;
  assert.ok(!query.text.includes(key[0])); assert.deepEqual(query.values, [JSON.stringify(key)]);
  for (const limit of [0, 101, 1.5, NaN]) await assert.rejects(client.listRecords('mpeople', { limit }));
  await assert.rejects(client.getRecord('mpeople', []), /invalid_record_key/);
  const list = client.listTables(); list[0].id = 'mcrm'; state.definitions[0].id = 'mutated';
  assert.equal(client.listTables()[0].id, 'mpeople');
});
test('parallel client instances do not share records or connection state', async () => {
  const left = workingFake(), right = workingFake();
  left.state.rows = [{ record_key: '["1"]', source_json: '{"Id":1,"Name":"left"}' }];
  right.state.rows = [{ record_key: '["1"]', source_json: '{"Id":1,"Name":"right"}' }];
  const a = await createPostgresClient(left.pool, 'unicorn_noco_copy_restore');
  const b = await createPostgresClient(right.pool, 'unicorn_noco_copy_restore');
  const [first, second] = await Promise.all([a.getRecord('mpeople', ['1']), b.getRecord('mpeople', ['1'])]);
  assert.equal(first?.data.Name, 'left'); assert.equal(second?.data.Name, 'right');
  assert.equal(left.state.releases.length, 2); assert.equal(right.state.releases.length, 2);
});
