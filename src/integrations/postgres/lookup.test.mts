import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPostgresClient } from './working-client.mts';
import { workingFake } from './working-fixture.mts';
test('selective reads bind values, validate fields, preserve pages and bypass archive JSON', async () => {
  const f = workingFake(), db = await createPostgresClient(f.pool, 'unicorn_noco_copy_restore');
  f.state.rows = [{ record_key: '["7"]', source_json: '{"Id":7,"Name":"Аудит"}' }];
  const page = await db.findRecords('mpeople', 'Name', ["x' OR true --", 'Аудит'], { limit: 1 });
  assert.equal(page.records[0].data.Name, 'Аудит');
  const query = [...f.state.calls].reverse().find(c => c.text.includes('ANY('))!;
  assert.deepEqual(query.values[0], ["x' OR true --", 'Аудит']);
  assert.ok(!query.text.includes("x' OR true")); assert.ok(!query.text.includes('_copy_source'));
  assert.match(query.text, /"cname"/); assert.equal(query.values.at(-1), 2);
  await assert.rejects(db.findRecords('mpeople', 'Team', ['1']), /field_not_searchable/);
  await assert.rejects(db.findRecords('mpeople', 'Name;DELETE', ['1']), /field_not_searchable/);
  const count = f.state.calls.length;
  assert.deepEqual(await db.findRecords('mpeople', 'Name', []), { records: [], nextKey: null });
  assert.equal(f.state.calls.filter(c => c.text.includes('ANY(')).length, 1);
  assert.ok(f.state.calls.length >= count);
  await db.findRecords('mpeople', 'Name', [''], { trim: true });
  assert.match([...f.state.calls].reverse().find(c => c.text.includes('ANY('))!.text, /btrim\(COALESCE/);
});
test('logical key locks last until commit; failed commits do not repeat an operation', async () => {
  const f = workingFake(), db = await createPostgresClient(f.pool, 'unicorn_noco_copy_restore', { writable: true });
  await db.transaction(tx => tx.lockKey('mpeople', 'claim:7'));
  const lock = f.state.calls.findIndex(c => c.text.includes('pg_advisory_xact_lock'));
  assert.ok(lock > 0); assert.equal(f.state.calls[lock + 1].text, 'COMMIT');
  assert.deepEqual(f.state.calls[lock].values, ['["mpeople","claim:7"]']);
  f.state.fail = 'COMMIT'; let calls = 0;
  await assert.rejects(db.transaction(async tx => { calls++; await tx.lockKey('mpeople', 'claim:7'); }), /commit_uncertain/);
  assert.equal(calls, 1);
});

test('record locks bind the physical key and remain inside the write transaction', async () => {
  const f = workingFake(), db = await createPostgresClient(f.pool, 'unicorn_noco_copy_restore', { writable: true });
  await db.transaction(async tx => {
    await tx.lockRecord('mpeople', ['7']);
    await tx.getRecord('mpeople', ['7']);
  });
  const lock = f.state.calls.findIndex(c => c.text.includes('FOR UPDATE'));
  assert.ok(lock > 0);
  assert.match(f.state.calls[lock].text, /SELECT _copy_id FROM noco\."mpeople" WHERE _copy_id=\$1 FOR UPDATE/);
  assert.deepEqual(f.state.calls[lock].values, ['["7"]']);
  assert.match(f.state.calls[lock + 1].text, /AS source_json/);
  assert.equal(f.state.calls[lock + 2].text, 'COMMIT');
  await assert.rejects(db.transaction(tx => tx.lockRecord('mpeople', [])), /invalid_record_key/);
});
