import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresClient } from './working-client.mts';
import { workingFake } from './working-fixture.mts';
test('current columns, not snapshot JSON; exact numbers and stable pages', async () => {
  const { pool, state } = workingFake(); const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  state.rows = [{ record_key: '["1"]', source_json: '{"Id":1,"Name":"Новый","Amount":9007199254740993,"Date":"2026-09-11"}' },
    { record_key: '["2"]', source_json: '{"Id":2,"Name":null}' }];
  const page = await db.listRecords('mpeople', { limit: 1 });
  assert.deepEqual(page.nextKey, ['1']); assert.equal(page.records[0].data.Amount, '9007199254740993');
  const sql = state.calls.at(-2)!.text;
  assert.match(sql, /jsonb_build_object/); assert.ok(!sql.includes('_copy_source'));
  assert.equal(page.records[0].data.Name, 'Новый');
});
test('writes require explicit enablement and update only supplied columns', async () => {
  const { pool, state } = workingFake();
  const readonly = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  await assert.rejects(readonly.patchRecord('mpeople', ['1'], { Name: 'x' }), /writes_disabled/);
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  state.rows = [{ record_key: '["1"]', source_json: '{"Id":1,"Name":"O\u0027Brien","Email":"keep"}' }];
  const input = Object.freeze({ Name: "O'Brien" });
  const updated = await db.patchRecord('mpeople', ['1'], input);
  assert.equal(updated.data.Email, 'keep');
  const call = state.calls.find(c => c.text.startsWith('UPDATE'))!;
  assert.match(call.text, /SET "cname"=\$2::text/); assert.ok(!call.text.split('RETURNING')[0].includes('cmail'));
  assert.ok(!call.text.includes(input.Name)); assert.ok(call.values.includes(input.Name));
  assert.equal(state.calls.at(-1)?.text, 'COMMIT');
});
test('create preserves explicit PK and archive; unknown/PK/virtual writes fail', async () => {
  const { pool, state } = workingFake();
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  state.rows = [{ record_key: '["7"]', source_json: '{"Id":7,"Name":""}' }];
  assert.deepEqual((await db.createRecord('mpeople', { Id: '7', Name: '' })).key, ['7']);
  const insert = state.calls.find(c => c.text.startsWith('INSERT'))!;
  assert.match(insert.text, /_copy_source/); assert.ok(!insert.text.includes('ON CONFLICT'));
  for (const fields of [{ Id: '8' }, { unknown: 3 }, { Team: [] }, { Name: undefined }])
    await assert.rejects(db.patchRecord('mpeople', ['7'], fields));
  await assert.rejects(db.createRecord('mpeople', { Name: 'no id' }), /postgres_id_allocator_required/);
  assert.equal(state.calls.filter(c => c.text.startsWith('INSERT')).length, 1);
});
test('transactions rollback on callback failure; uncertain COMMIT never retries', async () => {
  const { pool, state } = workingFake();
  const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore', { writable: true });
  state.rows = [{ record_key: '["7"]', source_json: '{"Id":7}' }];
  await assert.rejects(db.transaction(async tx => { await tx.patchRecord('mpeople', ['7'], { Name: 'x' }); throw new Error('stop'); }));
  assert.equal(state.calls.at(-1)?.text, 'ROLLBACK');
  state.fail = 'COMMIT';
  await assert.rejects(db.patchRecord('mpeople', ['7'], { Name: 'y' }), /commit_uncertain/);
  assert.equal(state.calls.filter(c => c.text.startsWith('UPDATE')).length, 2);
  assert.equal(state.releases.at(-1), true);
});
test('relations use actual FK; CRM, invalid keys and pages are blocked', async () => {
  const { pool, state } = workingFake(); const db = await createPostgresClient(pool, 'unicorn_noco_copy_restore');
  await db.listRelated('mpeople', 'cteamlink', ['1']);
  const sql = state.calls.find(c => c.text.includes('JOIN noco.'))!.text;
  assert.match(sql, /s\."cteam"=t\."ctid"/); assert.ok(!sql.includes('link_cteamlink'));
  await assert.rejects(db.getRecord('crm', ['1']), /table_not_allowed/);
  await assert.rejects(db.getRecord('mpeople', []), /invalid_record_key/);
  await assert.rejects(db.listRecords('mpeople', { limit: 101 }), /invalid_page_size/);
  assert.equal('query' in db, false);
});
