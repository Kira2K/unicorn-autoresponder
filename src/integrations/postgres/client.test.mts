import test from 'node:test'; import assert from 'node:assert/strict';
import { createPostgresReadClient } from './client.mts';
import { fakePool } from './fixture.mts';
test('metadata excludes CRM; identifiers and CRM relations fail before querying data', async () => {
  const { pool, state } = fakePool(); const client = await createPostgresReadClient(pool, 'unicorn_noco_copy');
  assert.deepEqual(client.listTables().map(t => t.id), ['mpeople']);
  const connected = state.connects;
  for (const id of ['mcrm', 'unknown', 'mpeople; DROP TABLE crm'])
    await assert.rejects(client.getRecord(id, ['1']));
  await assert.rejects(client.listRelated('mpeople', 'ccrm', ['1']), /table_not_allowed/);
  await assert.rejects(client.listRelated('mpeople', 'missing', ['1']), /relation_not_allowed/);
  assert.equal(state.connects, connected);
  assert.equal('query' in client, false); assert.equal('createRecord' in client, false);
});
test('read-only keyset pages, relation pages, exact record and missing record', async () => {
  const { pool, state } = fakePool(); const client = await createPostgresReadClient(pool, 'unicorn_noco_copy');
  const first = await client.listRecords('mpeople', { limit: 2 });
  assert.deepEqual(first.records.map(r => r.data.Id), [1, 2]); assert.deepEqual(first.nextKey, ['2']);
  const second = await client.listRecords('mpeople', { limit: 2, after: first.nextKey! });
  assert.deepEqual(second.records.map(r => r.data.Id), [3]); assert.equal(second.nextKey, null);
  assert.equal((await client.getRecord('mpeople', ['1']))?.data.name, '');
  assert.equal(await client.getRecord('mpeople', ['404']), null);
  const related = await client.listRelated('mpeople', 'cfriends', ['1'], { limit: 2 });
  assert.deepEqual(related.nextKey, ['2']);
  assert.equal(state.calls.filter(c => c.text === 'BEGIN READ ONLY').length, state.connects);
  assert.equal(state.calls.filter(c => c.text === 'ROLLBACK').length, state.connects);
  assert.ok(state.released.every(v => !v));
});
test('key values use parameters, invalid pages are blocked and input/catalog cannot be mutated', async () => {
  const { pool, state } = fakePool(); const client = await createPostgresReadClient(pool, 'unicorn_noco_copy');
  const key = Object.freeze(["x'); DELETE FROM crm; --"]);
  await client.getRecord('mpeople', key);
  const query = state.calls.find(c => c.text.includes('WHERE _copy_id=$1'))!;
  assert.ok(!query.text.includes(key[0])); assert.deepEqual(query.values, [JSON.stringify(key)]);
  for (const limit of [0, 101, 1.5, NaN]) await assert.rejects(client.listRecords('mpeople', { limit }));
  await assert.rejects(client.getRecord('mpeople', []), /invalid_record_key/);
  const list = client.listTables(); list[0].id = 'mcrm'; state.metadata[0].id = 'mutated';
  assert.equal(client.listTables()[0].id, 'mpeople');
});
test('parallel client instances do not share records or connection state', async () => {
  const left = fakePool(), right = fakePool();
  left.state.records[0].source_json = '{"owner":"left"}';
  right.state.records[0].source_json = '{"owner":"right"}';
  const a = await createPostgresReadClient(left.pool, 'unicorn_noco_copy');
  const b = await createPostgresReadClient(right.pool, 'unicorn_noco_copy');
  const [first, second] = await Promise.all([a.getRecord('mpeople', ['1']), b.getRecord('mpeople', ['1'])]);
  assert.equal(first?.data.owner, 'left'); assert.equal(second?.data.owner, 'right');
  assert.equal(left.state.connects, 2); assert.equal(right.state.connects, 2);
});
