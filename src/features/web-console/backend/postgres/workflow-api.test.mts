import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createTelegramIntegration } from '../../../../integrations/telegram/integration.ts';
import { workflowFixture } from './workflow-fixture.mts';
import { workflowEnv, workflowScenario, type WorkflowResult } from './workflow-scenario.mts';
import { createSqlTestConsole } from './test-app.mts';
import { serveTestApp, workflowHttp } from './workflow-http.mts';
import { tableIds as t } from './tables.mts';
import type { TestNotification } from './workflow-test-services.mts';
import { workflowTestServices } from './workflow-test-services.mts';
import { workflowScope } from './workflow-scope.mts';
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

test('return API sends the rejected link only after persistence, with no duplicate on a second click', async () => {
  const f = workflowFixture(), notifications: TestNotification[] = [], restore = workflowEnv([7]);
  const server = await serveTestApp(createSqlTestConsole(f.db, f.grant, { notifications }));
  try {
    const action = workflowHttp(server.base, '-7007');
    const initial = (await action('status')).workflow;
    const status = 'Draft in approve by Kira', url = 'https://example.invalid/returned-draft';
    const options = { actor: { userId: '9002', chatId: '9002', chatType: 'private' },
      expectedStatus: status, rejectionComment: 'оставь комментарии в резюме' };
    await f.sql.patchResumeWorkflow(initial.id, { status, cvDraftUrl: url });
    await assert.rejects(action('reject', { ...options, actor: { ...options.actor, userId: '9999' } }), { code: 'forbidden' });
    f.failWrite();
    await assert.rejects(action('reject', options));
    assert.equal(notifications.length, 0);
    f.failWrite(false);
    assert.equal((await f.sql.getResumeWorkflowById(initial.id))?.cvDraftUrl, url);
    const result = await action('reject', options) as WorkflowResult & { message: string };
    assert.equal(result.workflow.cvDraftUrl, '');
    assert.ok(result.message.includes(`Возвращённое резюме: ${url}`));
    assert.equal(notifications.length, 1); assert.equal(notifications[0].chatId, '9003');
    for (const row of ['Студент: SQL fixture', 'Стек: Go', 'Образование: Test University',
      `Файл на доработку: ${url}`, 'Комментарий: оставь комментарии в резюме'])
      assert.ok(notifications[0].text.split('\n').includes(row), row);
    await assert.rejects(action('reject', options), { code: 'resume_workflow_stale_status' });
    await action('status'); assert.equal(notifications.length, 1);
    await f.sql.patchResumeWorkflow(initial.id, { status, cvDraftUrl: url });
    f.failAfterWrite(); const writes = f.count();
    await assert.rejects(action('reject', options));
    assert.equal(f.count(), writes + 1, 'uncertain write must not be repeated');
    assert.equal(notifications.length, 1, 'uncertain save must not send a return notification');
  } finally { await server.close(); restore(); }
});

test('return API accepts a native Rich Message acknowledgement without warning or a second send', async () => {
  const { createWebConsoleApp } = createRequire(import.meta.url)('../app.ts');
  const f = workflowFixture(), restore = workflowEnv([7]);
  const calls: Array<{ url: string; body: Record<string, any> }> = [];
  const telegramIntegration = createTelegramIntegration({ token: 'test-only', logger() {},
    regularErrorChatId: '', summaryLogsChatId: '', requester: async (url, options) => {
      const body = JSON.parse(String(options.body)); calls.push({ url, body });
      return { ok: true, status: 200, async json() { return { ok: true, result: {
        message_id: 1, date: 1, chat: { id: Number(body.chat_id), type: 'private', first_name: 'Fixture' },
        rich_message: { blocks: [{ type: 'paragraph', text: 'Native Rich acknowledgement' }] }
      } }; } };
    } });
  const server = await serveTestApp(createWebConsoleApp({ useMockData: true,
    repository: workflowScope(f.sql, f.grant.clientIds), ...workflowTestServices([]), telegramIntegration }));
  try {
    const action = workflowHttp(server.base, '-7007'), initial = (await action('status')).workflow;
    const status = 'Draft in approve by Kira', url = 'https://example.invalid/returned-rich';
    await f.sql.patchResumeWorkflow(initial.id, { status, cvDraftUrl: url });
    const comment = 'Исправить описание опыта и сохранить все детали. '.repeat(100).trim();
    const options = { actor: { userId: '9002', chatId: '9002', chatType: 'private' },
      expectedStatus: status, rejectionComment: comment };
    const before = f.count();
    const result = await action('reject', options) as WorkflowResult & { notificationWarnings: string[] };
    assert.equal(result.workflow.status, 'Draft in process');
    assert.equal(result.workflow.cvDraftUrl, '');
    assert.equal(result.workflow.lastRejectionComment, comment);
    assert.deepEqual(result.notificationWarnings, []);
    assert.equal(f.count(), before + 1, 'successful Rich delivery must not write an error or repeat the transition');
    assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith('/sendRichMessage'));
    assert.equal(calls[0].body.chat_id, '9003');
    assert.ok(calls[0].body.rich_message.html.includes(url));
    assert.ok(calls[0].body.rich_message.html.includes(comment));
    await assert.rejects(action('reject', options), { code: 'resume_workflow_stale_status' });
    await action('status'); assert.equal(calls.length, 1);
  } finally { await server.close(); restore(); }
});
