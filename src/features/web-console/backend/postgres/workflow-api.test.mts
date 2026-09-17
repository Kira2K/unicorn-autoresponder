import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { workflowEnv, workflowScenario } from './workflow-scenario.mts';
import { createSqlTestConsole } from './test-app.mts';
import { serveTestApp, workflowHttp } from './workflow-http.mts';
import { tableIds as t } from './tables.mts';
import type { TestNotification } from './workflow-test-services.mts';
test('protected CV API uses SQL; messages stay in memory and reload does not resend', async () => {
  const f = workflowFixture(), notifications: TestNotification[] = [], restore = workflowEnv([7]);
  let server = await serveTestApp(createSqlTestConsole(f.db, f.grant, { notifications }));
  try {
    const action = workflowHttp(server.base, '-7007');
    assert.equal((await fetch(server.base + '/api/bot/telegram/chats/-7007/resume/status')).status, 401);
    const scenario = await workflowScenario(f.sql, 'En', '-7007', action);
    assert.ok(notifications.some(n => n.channel === 'summary'));
    const count = notifications.length;
    await server.close(); server = await serveTestApp(createSqlTestConsole(f.db, f.grant, { notifications }));
    assert.equal((await workflowHttp(server.base, '-7007')('status')).completed, true);
    assert.equal(notifications.length, count);
    f.set(t.clients, 8, { client_name: 'Other', telegram_general_chat_id: '-8008' });
    await assert.rejects(workflowHttp(server.base, '-8008')('status'), { code: 'forbidden' });
    assert.equal(f.rows.get(t.cv)?.size, 1);
    await f.sql.patchResumeWorkflow(scenario.workflowId, { status: 'Draft in process' });
    f.failWrite();
    await assert.rejects(workflowHttp(server.base, '-7007')('advance', {
      actor: { userId: '9003', chatId: '9003', chatType: 'private' }, expectedStatus: 'Draft in process' }));
    assert.equal(notifications.length, count);
    f.failWrite(false); f.failAfterWrite(); const before = f.count();
    await assert.rejects(workflowHttp(server.base, '-7007')('advance', {
      actor: { userId: '9003', chatId: '9003', chatType: 'private' }, expectedStatus: 'Draft in process' }));
    assert.equal(f.count(), before + 1, 'uncertain write must not be repeated');
    assert.equal(notifications.length, count, 'uncertain persistence must not send notifications');
    assert.equal((await f.sql.getResumeWorkflowById(scenario.workflowId))?.status, 'Draft in approve by Kira');
  } finally { await server.close(); restore(); }
});
