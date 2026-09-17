import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPostgresAppDb } from './postgres-db.mts';
import { makeFixture, unusedSheets } from './test-fixture.mts';
import type { AppDb } from '../types.ts';
const { createNocoDb } = createRequire(import.meta.url)('../noco/noco-db.ts') as {
  createNocoDb(options: unknown): AppDb;
};
test('SQL AppDb preserves the four Noco read contracts and errors', async () => {
  const { reader, records } = makeFixture();
  const sql = createPostgresAppDb(async () => reader, unusedSheets), noco = createNocoDb({ nocoClient: records });
  assert.deepEqual(await sql.getAutomationTargets({ workWithRuOnly: false }), await noco.getAutomationTargets({ workWithRuOnly: false }));
  assert.deepEqual(await sql.getAutomationTargets({ market: 'En', clientNames: ['Fake'] }), await noco.getAutomationTargets({ market: 'En', clientNames: ['Fake'] }));
  assert.deepEqual(await sql.getAutomationTargetByName('Fake', 'En'), await noco.getAutomationTargetByName('Fake', 'En'));
  assert.deepEqual(await sql.getHHAuthCredentialsByClientName('Fake'), await noco.getHHAuthCredentialsByClientName('Fake'));
  assert.deepEqual(await sql.getHHAuthCredentialsByCommonChatId('-1', 'En'), await noco.getHHAuthCredentialsByCommonChatId('-1', 'En'));
  for (const db of [sql, noco]) await assert.rejects(db.getHHAuthCredentialsByClientName('Missing'), /not found/);
});
test('SQL source rejection is propagated, never interpreted as an empty table', async () => {
  const failure = new Error('postgres_read_failed');
  const db = createPostgresAppDb(async () => { throw failure; }, unusedSheets);
  await assert.rejects(db.getAutomationTargets(), error => error === failure);
  await assert.rejects(db.getHHAuthCredentialsByClientName('Fake'), error => error === failure);
});
test('SQL preserves existing missing/ambiguous record rules', async () => {
  for (const change of [
    (f: ReturnType<typeof makeFixture>) => f.data.dolphinProfiles.push({ ...f.data.dolphinProfiles[0], Id: 99 }),
    (f: ReturnType<typeof makeFixture>) => { f.data.dolphinProfiles = []; },
    (f: ReturnType<typeof makeFixture>) => { f.data.clients[0].stacks_id = null; },
    (f: ReturnType<typeof makeFixture>) => { f.data.clients[0].telegram_general_chat_id = ''; }
  ]) {
    const f = makeFixture(); change(f);
    const sql = createPostgresAppDb(async () => f.reader, unusedSheets), noco = createNocoDb({ nocoClient: f.records });
    const observe = async (db: AppDb) => {
      try { return await db.getAutomationTargets(); } catch (e) { return (e as Error).message; }
    };
    assert.deepEqual(await observe(sql), await observe(noco));
  }
});
test('SQL preserves account ownership, duplicate rejection and Noco cache lifetime', async () => {
  const f = makeFixture(); f.data.platformAccounts.push({ ...f.data.platformAccounts[0], Id: 99, clients_id: 2 });
  const db = createPostgresAppDb(async () => f.reader, unusedSheets);
  assert.equal((await db.getHHAuthCredentialsByClientName('Fake')).clientName, 'Fake');
  f.requests.length = 0;
  assert.equal((await db.getHHAuthCredentialsByCommonChatId('-1')).clientName, 'Fake');
  assert.deepEqual(f.requests, []);
  f.data.platformAccounts.push({ ...f.data.platformAccounts[0], Id: 100 });
  await assert.rejects(createPostgresAppDb(async () => f.reader, unusedSheets).getHHAuthCredentialsByClientName('Fake'), /ambiguous/);
});
test('Telegram and proxy reads stay in Sheets without loading SQL', async () => {
  let sqlCalls = 0;
  const markets: unknown[] = [], failure = new Error('sheets_failed');
  const db = createPostgresAppDb(async () => { sqlCalls++; throw new Error('sql_not_needed'); }, {
    async getStudentTelegramRecords() { return [{ commonChatId: '-1', name: 'Fake', market: 'Ru', telegram: '@fake', normalizedTelegram: 'fake' }]; },
    async getProxyRequiredClients(market) { markets.push(market); throw failure; }
  });
  assert.equal((await db.getStudentTelegramRecords())[0].telegram, '@fake');
  await assert.rejects(db.getProxyRequiredClients('Ru'), e => e === failure);
  await assert.rejects(db.getProxyRequiredClients(), e => e === failure);
  assert.deepEqual(markets, ['Ru', undefined]); assert.equal(sqlCalls, 0);
});
