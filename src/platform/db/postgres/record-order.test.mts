import test from 'node:test';
import assert from 'node:assert/strict';
import { nocoRecordOrder } from './record-order.mts';
import { createPostgresRecordSource } from './record-source.mts';
import { makeFixture, TABLES } from './test-fixture.mts';

test('Noco order retains precise decimals, negatives, numeric IDs and nulls without mutating input', () => {
  const rows = [{ Id: 100, nc_order: null }, { Id: 10, nc_order: '1.00000000000000000002' },
    { Id: 9, nc_order: '1.00000000000000000001' }, { Id: 11, nc_order: '-0.00000000000000000001' },
    { Id: 5, nc_order: 0 }, { Id: 7, nc_order: '1.00000000000000000001' }];
  const copy = structuredClone(rows);
  assert.deepEqual(nocoRecordOrder(rows).map(r => r.Id), [11, 5, 7, 9, 10, 100]);
  assert.deepEqual(rows, copy);
  assert.deepEqual(nocoRecordOrder([{ Id: 100 }, { Id: 10 }, { Id: 2 }]).map(r => r.Id), [2, 10, 100]);
  assert.throws(() => nocoRecordOrder([{ Id: 1, nc_order: 'broken' }]), /appdb_order_invalid/);
});
test('SQL page keys do not change HH target and relation order after complete pagination', async () => {
  const f = makeFixture();
  f.data.hhAutoresponses = [9, 10, 100].map(Id => ({ ...f.data.hhAutoresponses[0], Id, nc_order: Id }));
  f.data.companies = [9, 10, 100].map(Id => ({ Id, company_name: `Company ${Id}`, nc_order: Id }));
  const source = createPostgresRecordSource(async () => f.reader);
  assert.deepEqual(await source.fetchRecords(TABLES.hhAutoresponses.id), await f.records.fetchRecords(TABLES.hhAutoresponses.id));
  assert.deepEqual(await source.fetchRecords(TABLES.restrictions.id), await f.records.fetchRecords(TABLES.restrictions.id));
});
