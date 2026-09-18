import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consoleWrites } from './writes.mts';
import { tableIds } from './tables.mts';
import type { ConsoleSql } from './contracts.mts';
test('writes are restricted to selected artificial clients, errors are never retried', async () => {
  let calls = 0;
  const db = { listTables: () => [{ id: tableIds.accounts, columns: [{ dataKey: 'platform' }] }],
    async getRecord() { return { data: { clients_id: 7 } }; },
    async patchRecord() { calls++; throw Error('uncertain'); }, async deleteRecord() { calls++; return true; },
    async transaction(fn: (tx: unknown) => unknown) { return fn({}); } } as unknown as ConsoleSql;
  const writes = { clientIds: new Set([7]), async create() { calls++; throw Error('create uncertain'); } };
  await assert.rejects(consoleWrites(db).patchRecord(tableIds.clients, 7, {}), { code: 'forbidden' });
  const port = consoleWrites(db, writes);
  await assert.rejects(port.patchRecord(tableIds.clients, 8, {}), { code: 'forbidden' });
  await assert.rejects(port.patchRecord(tableIds.accounts, 1, { clients_id: 8 }), /owner_immutable/);
  assert.equal(calls, 0);
  await assert.rejects(port.patchRecord(tableIds.accounts, 1, { login: 'x' }), /uncertain/); assert.equal(calls, 1);
  await assert.rejects(port.createRecord(tableIds.accounts, { clients_id: 7 }), /create uncertain/); assert.equal(calls, 2);
  await assert.rejects(port.createRecord(tableIds.accounts, { clients_id: 8 }), { code: 'forbidden' });
  assert.equal(calls, 2); assert.equal(await port.deleteRecord(tableIds.accounts, 1), true);
});
