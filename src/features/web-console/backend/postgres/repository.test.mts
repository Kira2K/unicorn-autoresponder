import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSqlConsoleRepository } from './repository.mts';
import { consoleWrites } from './writes.mts';
import { tableIds } from './tables.mts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
test('current SQL schema persists platform FK instead of the obsolete label column', async () => {
  let sent: Record<string, unknown> | undefined;
  const db = { listTables: () => [{ id: tableIds.accounts, columns: [{ dataKey: 'platforms_id' }] }],
    transaction: async (fn: (tx: object) => Promise<unknown>) => fn({}) } as unknown as ConsoleSql;
  const grant: ConsoleWrites = { clientIds: new Set([7]), async create(_tx, _table, data) {
    sent = { ...data }; return { key: ['1'], data: { Id: 1, ...data }, sourceJson: '{}' };
  } };
  await consoleWrites(db, grant).createRecord(tableIds.accounts, { clients_id: 7, platforms_id: 25, platform: 'email_en', login: 'sample' });
  assert.deepEqual(sent, { clients_id: 7, platforms_id: 25, login: 'sample' });
});
test('Dolphin binding uses a text provider ID and one insert transaction without a second link write', async () => {
  let transactions = 0, sent: Record<string, unknown> | undefined;
  const db = { listTables: () => [], transaction: async (fn: (tx: object) => Promise<unknown>) => { transactions++; return fn({}); },
    linkRecord: async () => { throw Error('second write forbidden'); } } as unknown as ConsoleSql;
  const grant: ConsoleWrites = { clientIds: new Set([7]), async create(_tx, table, data) {
    assert.equal(table, tableIds.profiles); sent = { ...data };
    return { key: ['5'], data: { Id: 5, ...data }, sourceJson: '{}' };
  } };
  await createSqlConsoleRepository(db, grant).createDolphinProfileBinding({ clientId: 7, clientName: 'Test', locale: 'en', dolphinProfileId: 123 });
  assert.equal(transactions, 1);
  assert.deepEqual(sent, { clients_id: 7, client_name: 'Test', locale: 'en', dolphin_profile_id: '123' });
});
test('clearing a SQL date preserves empty text and the original input', async () => {
  let sent: Readonly<Record<string, unknown>> | undefined;
  const db = { listTables: () => [{ id: tableIds.clients, columns: [{ dataKey: 'birth_date', sqlType: 'date' }] }],
    getRecord: async () => ({ key: ['7'], data: { Id: 7 } }),
    patchRecord: async (_table: string, _key: string[], data: Record<string, unknown>) => {
      sent = data; return { key: ['7'], data: { Id: 7, ...data }, sourceJson: '{}' };
    } } as unknown as ConsoleSql;
  const input = Object.freeze({ birth_date: '', first_name: '' });
  const grant: ConsoleWrites = { clientIds: new Set([7]), create: async () => { throw Error('not used'); } };
  await consoleWrites(db, grant).patchRecord(tableIds.clients, 7, input);
  assert.deepEqual(sent, { birth_date: null, first_name: '' });
  assert.deepEqual(input, { birth_date: '', first_name: '' });
});
test('SQL failure retains a safe 503 and does not retry or fall back to Noco', async () => {
  let calls = 0;
  const db = { listTables: () => [{ id: tableIds.clients, columns: [] }],
    findRecords: async () => { calls++; throw new PostgresReadError('sql_unavailable'); },
    listRecords: async () => { calls++; throw new PostgresReadError('sql_unavailable'); } } as unknown as ConsoleSql;
  await assert.rejects(createSqlConsoleRepository(db).findClientByCalendarEmail('test@example.invalid'), {
    message: 'SQL data service unavailable', code: 'sql_unavailable', response: { status: 503 }
  });
  assert.equal(calls, 1);
});
