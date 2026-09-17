import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSqlTestConsole } from './test-app.mts';
import type { ConsoleSql } from './contracts.mts';
test('test console rejects every external workflow before service dispatch', async () => {
  const db = { listTables: () => [] } as unknown as ConsoleSql;
  const app = createSqlTestConsole(db);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const url of ['/api/telegram/send', '/api/dolphin/lease/acquire', '/api/admin/hh-responses/start',
      '/api/admin/linkedin/accounts/1/profile-generations', '/api/admin/linkedin/post-runs',
      '/api/bot/telegram/chats/1/resume/status']) {
      for (const method of ['GET', 'POST']) {
        const response = await fetch(base + url, { method }); assert.equal(response.status, 403);
        assert.equal((await response.json()).error, 'sql_test_operation_disabled');
      }
    }
    assert.equal((await fetch(base + '/api/client/me')).status, 401);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
