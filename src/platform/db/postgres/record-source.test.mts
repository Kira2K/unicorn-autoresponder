import test from 'node:test';
import assert from 'node:assert/strict';
import { readPages } from './pages.mts';
import { createPostgresRecordSource } from './record-source.mts';
import { makeFixture, TABLES } from './test-fixture.mts';
const record = (id: number) => ({ key: [String(id)], data: { Id: id }, sourceJson: '{}' });
test('pages and full relations preserve current values, not archived JSON', async () => {
  const f = makeFixture(), source = createPostgresRecordSource(async () => f.reader);
  assert.deepEqual(await source.fetchRecords(TABLES.restrictions.id), await f.records.fetchRecords(TABLES.restrictions.id));
  assert.equal(f.requests.filter(id => id === 'relation').length, 2);
  f.data.clients[0].client_name = 'Изменено'; f.data.clients[0].stacks_id = 4;
  const actual = await source.fetchRecords(TABLES.clients.id);
  assert.deepEqual(actual, await f.records.fetchRecords(TABLES.clients.id));
  assert.equal(actual[0].client_name, 'Изменено');
  assert.equal((actual[0].rel_clients_primary_stack as { name: string }).name, 'Python');
});
test('empty pages, repeated cursors and duplicated records cannot masquerade as a complete table', async () => {
  assert.deepEqual(await readPages(async () => ({ records: [], nextKey: null })), []);
  await assert.rejects(readPages(async () => ({ records: [], nextKey: ['1'] })), /invalid_page_cursor/);
  await assert.rejects(readPages(async () => ({ records: [record(1)], nextKey: ['2'] })), /invalid_page_cursor/);
  await assert.rejects(readPages(async () => ({ records: [record(1)], nextKey: ['1'] })), /duplicate_record/);
  await assert.rejects(readPages(async () => ({ records: [record(1), record(1)], nextKey: null })), /duplicate_record/);
});
test('unexpected tables and missing relation metadata fail closed', async () => {
  const f = makeFixture(), source = createPostgresRecordSource(async () => f.reader);
  await assert.rejects(source.fetchRecords('CRM'), /appdb_table_not_allowed/);
  assert.equal(f.requests.length, 0);
  f.tables.find(t => t.id === TABLES.clients.id)!.columns = [];
  await assert.rejects(source.fetchRecords(TABLES.clients.id), /appdb_relation_required/);
});
test('read failures and mismatched identifiers cannot return partial records', async () => {
  const f = makeFixture(), failure = new Error('read_failed');
  const reader = { ...f.reader, async listRecords() { throw failure; } };
  await assert.rejects(createPostgresRecordSource(async () => reader).fetchRecords(TABLES.clients.id), e => e === failure);
  f.reader.listRecords = async () => ({ records: [{ ...record(1), data: { Id: 2 } }], nextKey: null });
  await assert.rejects(createPostgresRecordSource(async () => f.reader).fetchRecords(TABLES.clients.id), /appdb_record_id_mismatch/);
});
