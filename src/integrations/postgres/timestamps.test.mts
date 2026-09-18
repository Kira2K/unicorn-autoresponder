import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticTimestamps } from './working-timestamps.mts';
import { createPostgresClient } from './working-client.mts';
import { workingFake } from './working-fixture.mts';
test('system timestamps use PostgreSQL time; supplied dates and creation time survive patches', async () => {
  const f = workingFake(), table = f.state.definitions[0];
  for (const [id, title, uidt] of [['created','CreatedAt','CreatedTime'],['updated','UpdatedAt','LastModifiedTime']]) {
    const field = { id, title, column_name: id, uidt, sqlName: id, sqlType: 'timestamptz', pk: false };
    table.columns.push(field); table.mapping.push({ id, title, sqlName: id, sqlType: 'timestamptz' });
  }
  const db = await createPostgresClient(f.pool, 'unicorn_noco_copy_restore', { writable: true });
  f.state.rows = [{ record_key: '["1"]', source_json: '{"Id":1,"Name":"A"}' }];
  await db.createRecord(table.id, { Id: 1, Name: 'A' });
  const insert = f.state.calls.find(c => c.text.startsWith('INSERT'))!;
  assert.match(insert.text, /"created","updated"/);
  assert.equal((insert.text.match(/statement_timestamp\(\)/g) ?? []).length, 2);
  assert.equal(insert.values.some(v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)), false);
  await db.patchRecord(table.id, ['1'], { Name: 'B' });
  const update = [...f.state.calls].reverse().find(c => c.text.startsWith('UPDATE'))!;
  assert.match(update.text, /"updated"=statement_timestamp\(\)/);
  assert.doesNotMatch(update.text.split('RETURNING')[0], /"created"=/);
  assert.equal(automaticTimestamps(db.listTables()[0], { UpdatedAt: null }, false).length, 0);
  await db.patchRecord(table.id, ['1'], { Name: 'C', UpdatedAt: '2020-01-01T00:00:00Z' });
  const explicit = [...f.state.calls].reverse().find(c => c.text.startsWith('UPDATE'))!;
  assert.doesNotMatch(explicit.text, /statement_timestamp/); assert(explicit.values.includes('2020-01-01T00:00:00Z'));
  await assert.rejects(db.patchRecord(table.id, ['1'], {}), { code: 'empty_patch' });
});
