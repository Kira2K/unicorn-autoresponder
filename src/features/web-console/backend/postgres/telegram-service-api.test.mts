import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workflowFixture } from './workflow-fixture.mts';
import { serviceHttpFixture } from './service-http-fixture.mts';
import { tableIds as t } from './tables.mts';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
const require = createRequire(import.meta.url);
const { createTelegramService } = require('../telegram-service.ts');
const { createFakeTdlibAdapter } = require('../../../../integrations/telegram/tdlib-client.ts');
test('Telegram API uses SQL ownership/status/history; fake send, reload and read outage are isolated', async () => {
  const f = workflowFixture(), root = mkdtempSync(join(tmpdir(), 'sql-telegram-api-'));
  const oldRoot = process.env.TELEGRAM_TDLIB_ROOT; process.env.TELEGRAM_TDLIB_ROOT = root;
  f.rows.get(t.accounts)!.get('22')!.phone = '+79990000000';
  const adapter = createFakeTdlibAdapter(); let sends = 0;
  const originalSend = adapter.send.bind(adapter);
  adapter.send = async (input: unknown) => { sends++; return originalSend(input); };
  const build = () => serviceHttpFixture(f.sql, { telegramService: createTelegramService({
    repository: f.sql, adapter, proxyResolver: async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 }) }) });
  let server = await build();
  try {
    assert.equal((await server.request('/api/telegram/connect', 'POST')).status, 401);
    await server.login();
    const input = { targetClientId: 7, accountId: 22 };
    let response = await server.request('/api/telegram/connect', 'POST', input);
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'needs_code');
    response = await server.request('/api/telegram/connect', 'POST', { ...input, code: '12345' });
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'active');
    const stored = await f.sql.getTelegramPlatformAccountsForClient(7);
    assert.equal(stored.find(a => a.id === 22)?.telegramSessionStatus, 'active');
    assert.match(stored.find(a => a.id === 22)!.telegramTdlibDbPath!, /sql-telegram-api-/);
    assert.equal(f.rows.get(t.accounts)!.get('23')!.telegram_session_status, 'disconnected');
    response = await server.request('/api/telegram/connect', 'POST', { ...input, targetClientId: 8 });
    assert.notEqual(response.status, 200);
    const message = { ...input, chatId: 'reporting-chat', text: 'fake only' };
    assert.notEqual((await server.request('/api/telegram/send', 'POST', message)).status, 200);
    assert.equal(sends, 0);
    response = await server.request('/api/telegram/send', 'POST', { ...message, allowWrite: true });
    assert.equal(response.status, 200); assert.equal(sends, 1);
    const history = f.rows.get(t.accounts)!.get('22')!.telegram_event_log;
    await server.close(); server = await build(); await server.login();
    response = await server.request('/api/telegram/status?targetClientId=7&accountId=22');
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'active');
    assert.equal(sends, 1); assert.ok(history);
    f.failRead(true, new PostgresReadError('postgres_read_unavailable'));
    assert.equal((await server.request('/api/telegram/send', 'POST', { ...message, allowWrite: true })).status, 503);
    assert.equal(sends, 1); f.failRead(false);
    response = await server.request('/api/telegram/disconnect', 'DELETE', input);
    assert.equal(response.status, 200);
    assert.equal(f.rows.get(t.accounts)!.get('22')!.telegram_session_status, 'needs_reauth');
  } finally {
    await server.close();
    if (oldRoot === undefined) delete process.env.TELEGRAM_TDLIB_ROOT; else process.env.TELEGRAM_TDLIB_ROOT = oldRoot;
    rmSync(root, { recursive: true, force: true }); // Exact directory returned by mkdtemp, never a session root.
  }
});
