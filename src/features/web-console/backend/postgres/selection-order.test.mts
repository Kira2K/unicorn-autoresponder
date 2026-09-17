import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { tableIds } from './tables.mts';
import { consoleRecords } from './records.mts';

test('duplicate chats keep Noco order; duplicate emails follow the current login policy', async () => {
  const f = workflowFixture(), rows = f.rows.get(tableIds.clients)!;
  const first = { ...rows.get('7')!, nc_order: '2.00000000000000000001' };
  rows.clear();
  f.set(tableIds.clients, 8, { ...first, Id: 8, nc_order: '2.00000000000000000000' });
  rows.set('7', first); // Independent API fixture order is 8,7; not a SQL ordering helper.
  f.grant.clientIds = new Set([7, 8]);
  const emailResult = await f.legacy.findClientByCalendarEmail('sql-fixture@example.invalid');
  for (const repo of [f.legacy, f.sql]) {
    assert.equal((await repo.findClientByTelegramChatId('-7007.0'))?.id, 8);
    assert.deepEqual(await repo.findClientByCalendarEmail('sql-fixture@example.invalid'), emailResult);
    await repo.updateGoogleFolderByTelegramChatId('-7007', 'https://example.invalid/new');
    assert.equal(rows.get('8')!.google_folder, 'https://example.invalid/new');
    assert.equal(rows.get('7')!.google_folder, 'https://example.invalid/root');
    rows.get('8')!.google_folder = 'https://example.invalid/root';
  }
});

test('console preserves order, NULL/empty values and does not mutate source rows', async () => {
  const f = workflowFixture(), rows = f.rows.get(tableIds.clients)!;
  rows.clear();
  f.set(tableIds.clients, 3, { nc_order: '1', client_name: 'Юникод', google_folder: '' });
  f.set(tableIds.clients, 2, { nc_order: '2', client_name: '', google_folder: null });
  f.set(tableIds.clients, 1, { nc_order: null });
  const before = structuredClone(rows);
  const actual = await consoleRecords(f.db).fetchRecords(tableIds.clients);
  assert.deepEqual(actual.map(r => r.Id), [3, 2, 1]);
  assert.equal(actual[0].google_folder, ''); assert.equal(actual[1].google_folder, null);
  assert.equal(actual[0].client_name, 'Юникод'); assert.deepEqual(rows, before);
});
