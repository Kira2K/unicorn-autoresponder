import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { workflowEnv } from './workflow-scenario.mts';
import { serveTestApp } from './workflow-http.mts';
import { createSqlTestConsole } from './test-app.mts';
import type { TestNotification } from './workflow-test-services.mts';
import { resumeWorkflowRevision } from '../../../../integrations/telegram/resume-workflow-state.ts';
const { createSupportBotApiClient, handleSupportBotCallback, handleSupportBotMessage, clearActiveTaskContextsForTest } =
  createRequire(import.meta.url)('../../../../integrations/telegram/support-bot.ts');

test('Telegram -> protected HTTP -> SQL preserves callback revision and rejects stale/unknown state without sends', async () => {
  const restore = workflowEnv([7]), f = workflowFixture('Ru'), notifications: TestNotification[] = [];
  const server = await serveTestApp(createSqlTestConsole(f.db, f.grant, { notifications }));
  try {
    const api = createSupportBotApiClient({ baseUrl: server.base, token: 'sql-test-only' });
    const initial = await f.sql.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
    const first = await f.sql.patchResumeWorkflow(initial!.id, { status: 'Russian version in approve by Kira', ruVersionUrl: 'https://example.invalid/old' });
    const firstRevision = resumeWorkflowRevision(first);
    const current = await f.sql.patchResumeWorkflow(first.id, { ruVersionUrl: 'https://example.invalid/new' });
    const actor = { userId: '9002', chatId: '9002', chatType: 'private' };
    const from = { id: 9002 }, message = { chat: { id: 9002, type: 'private' } };
    const click = (data: string) => handleSupportBotCallback({ data, from, message }, api);
    const count = f.count();
    for (const suffix of [':' + firstRevision, '']) {
      await assert.rejects(click(`resume:advance:${first.id}:rak${suffix}`), { code: 'resume_workflow_stale_revision', status: 409 });
      await click(`resume:reject:${first.id}:rak${suffix}`);
      await assert.rejects(handleSupportBotMessage({ ...message, from, text: '/resume_reject Нужно исправить описание последнего места работы.' }, api),
        { code: 'resume_workflow_stale_revision', status: 409 });
      clearActiveTaskContextsForTest();
    }
    assert.equal(f.count(), count);
    assert.equal(notifications.length, 0);
    const card = await api.providerTask(first.id, actor);
    const advance = card.replyMarkup.inline_keyboard.flat().find((b: any) => b.text === 'Согласовать');
    assert.equal(advance.callback_data.split(':')[4], resumeWorkflowRevision(current));
    await click(advance.callback_data);
    assert.equal((await f.sql.getResumeWorkflowById(first.id))!.status, 'Russian version in approve by student');
    assert.equal(notifications.length, 1);
    assert.ok(notifications[0].text.includes(current.ruVersionUrl));
    await f.sql.patchResumeWorkflow(first.id, { status: 'finished' });
    const after = f.count();
    await assert.rejects(api.resume('-7007', { userId: '9001', username: 'sql_student', chatId: '-7007', chatType: 'supergroup' }),
      { code: 'resume_workflow_unknown_status', status: 409 });
    assert.equal(f.count(), after);
    assert.equal(notifications.length, 1);
  } finally { clearActiveTaskContextsForTest(); await server.close(); restore(); }
});
