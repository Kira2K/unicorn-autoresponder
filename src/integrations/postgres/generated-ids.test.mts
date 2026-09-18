import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresClient } from './working-client.mts';
import { workingFake } from './working-fixture.mts';

function fixture(sequence: string | null = '101') {
  const fake = workingFake();
  const original = fake.pool.connect;
  fake.pool.connect = async () => {
    const session = await original();
    return { ...session, async query(text: string, values: unknown[] = []) {
      const result = await session.query(text, values);
      if (text.includes('nextval')) return { rows: [{ id: sequence }] };
      return result;
    } };
  };
  fake.state.rows = [{ record_key: '["101"]', source_json: '{"Id":101,"Name":"New"}' }];
  return fake;
}
test('missing numeric ID comes from PostgreSQL once; input and explicit IDs stay unchanged', async () => {
  const { pool, state } = fixture(), db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  const input = Object.freeze({ Name: 'New' });
  assert.deepEqual((await db.createRecord('mpeople', input)).key, ['101']);
  assert.deepEqual(input, { Name: 'New' });
  const insert = state.calls.find(c => c.text.startsWith('INSERT'))!;
  assert.ok(insert.values.includes('101')); assert.ok(insert.values.includes('["101"]'));
  assert.match(String(insert.values.at(-1)), /"Id":"101"/);
  await db.createRecord('mpeople', { Id: 101, Name: 'New' });
  assert.equal(state.calls.filter(c => c.text.includes('nextval')).length, 1);
  assert.equal(state.calls.filter(c => c.text.startsWith('INSERT')).length, 2);
});
test('missing allocator, unsafe ID and explicit null fail without INSERT', async () => {
  for (const id of [null, '0', '9007199254740992', '1.5']) {
    const { pool, state } = fixture(id), db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
    await assert.rejects(db.createRecord('mpeople', { Name: 'New' }));
    assert.equal(state.calls.filter(c => c.text.startsWith('INSERT')).length, 0);
  }
  const { pool, state } = fixture(), db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  await assert.rejects(db.createRecord('mpeople', { Id: null, Name: 'New' }), /record_key_required/);
  assert.equal(state.calls.filter(c => c.text.includes('nextval')).length, 0);
});
test('uncertain COMMIT does not allocate again or repeat INSERT', async () => {
  const { pool, state } = fixture(), db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  state.fail = 'COMMIT';
  await assert.rejects(db.createRecord('mpeople', { Name: 'New' }), { code: 'commit_uncertain' });
  assert.equal(state.calls.filter(c => c.text.includes('nextval')).length, 1);
  assert.equal(state.calls.filter(c => c.text.startsWith('INSERT')).length, 1);
});
test('parallel creates use distinct database-issued IDs; allocation failure cannot INSERT', async () => {
  const { pool, state } = workingFake(), original = pool.connect;
  let next = 1000;
  pool.connect = async () => {
    const s = await original();
    return { ...s, async query(text, values = []) {
      const result = await s.query(text, values);
      if (text.includes('nextval')) return { rows: [{ id: String(++next) }] };
      if (text.startsWith('INSERT')) return { rows: [{ record_key: values.at(-2), source_json: values.at(-1) }] };
      return result;
    } };
  };
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  const results = await Promise.all(['first', 'second'].map(Name => db.createRecord('mpeople', { Name })));
  assert.deepEqual(results.map(r => r.key), [['1001'], ['1002']]);
  assert.equal(state.calls.filter(c => c.text.includes('nextval')).length, 2);
  state.fail = 'nextval';
  await assert.rejects(db.createRecord('mpeople', { Name: 'failed' }), { code: 'postgres_write_failed' });
  assert.equal(state.calls.filter(c => c.text.startsWith('INSERT')).length, 2);
});
