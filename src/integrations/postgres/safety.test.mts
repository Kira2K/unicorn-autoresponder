import test from 'node:test'; import assert from 'node:assert/strict';
import { createPostgresClient } from './working-client.mts';
import { decodeRecord, encodeKey } from './records.mts';
import { workingFake, people } from './working-fixture.mts';
import type { CopyDatabase } from './contracts.mts';
test('wrong database and missing ownership marker stop before reading inventory/data', async () => {
  for (const wrong of ['database', 'marker'] as const) {
    const { pool, state } = workingFake(); state[wrong] = 'linkedin_manager';
    await assert.rejects(createPostgresClient(pool, 'unicorn_noco_copy_restore'), /database_not_allowed/);
    assert.ok(!state.calls.some(c => c.text.includes('copy_meta.inventory')));
    assert.deepEqual(state.releases, [true]);
  }
  const { pool, state } = workingFake();
  await assert.rejects(createPostgresClient(pool, 'linkedin_manager' as CopyDatabase));
  assert.equal(state.calls.length, 0);
});
test('read failure is sanitized, rolled back, released and never retried', async () => {
  const { pool, state } = workingFake(); const client = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  state.fail = 'FROM noco.';
  await assert.rejects(client.getRecord('mpeople', ['1']), error => {
    assert.equal((error as Error).message, 'postgres_read_failed');
    assert.ok(!String(error).includes('SECRET')); return true;
  });
  assert.equal(state.calls.filter(c => c.text.includes('FROM noco.')).length, 1);
  assert.equal(state.calls.at(-1)?.text, 'ROLLBACK'); assert.equal(state.releases.at(-1), true);
});
test('unavailable connection and failed rollback discard connection safely', async () => {
  const { pool, state } = workingFake(), connect = pool.connect;
  pool.connect = async () => { throw Error('SECRET connect error'); };
  await assert.rejects(createPostgresClient(pool, 'unicorn_noco_copy_restore'), /postgres_read_failed/);
  assert.deepEqual(state.releases, []); pool.connect = connect;
  const client = await createPostgresClient(pool, 'unicorn_noco_copy_restore'); state.fail = 'ROLLBACK';
  state.rows = [{ record_key: '["1"]', source_json: '{"Id":1}' }];
  assert.equal((await client.getRecord('mpeople', ['1']))?.data.Id, 1);
  assert.equal(state.releases.at(-1), true);
});
test('renamed known CRM table is still excluded; unknown metadata is rejected', async () => {
  const { pool, state } = workingFake();
  state.definitions.push({ ...state.definitions[0], id: 'md7qid29wv5q0bd', table_name: 'renamed' });
  const client = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  await assert.rejects(client.listRecords('md7qid29wv5q0bd'), /table_not_allowed/);
  state.definitions.push(state.definitions[0]);
  await assert.rejects(createPostgresClient(pool, 'unicorn_noco_copy_restore'), /duplicate_table_metadata/);
});
test('big integers, exact decimals, Unicode, null and empty values are not lost', () => {
  const json = '{"big":9007199254740993,"decimal":1.0000000000000000001,"null":null,"empty":"","text":"Привет"}';
  const record = decodeRecord({ record_key: '["9007199254740993","b"]', source_json: json });
  assert.equal(record.data.big, '9007199254740993'); assert.equal(record.data.decimal, '1.0000000000000000001');
  assert.equal(record.data.null, null); assert.equal(record.data.empty, ''); assert.equal(record.sourceJson, json);
  assert.equal(encodeKey({ ...people, columns: [{ id: 'a', title: 'A', pk: true }, { id: 'b', title: 'B', pk: true }] },
    record.key), '["9007199254740993","b"]');
});
