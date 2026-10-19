import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createTelegramIntegration } from '../../../../integrations/telegram/integration.ts';
import { workflowFixture } from './workflow-fixture.mts';
import { workflowEnv } from './workflow-scenario.mts';
import { workflowTestServices } from './workflow-test-services.mts';
import { serveTestApp, workflowHttp } from './workflow-http.mts';
import { tableIds } from './tables.mts';
import type { ResumeWorkflowRecord } from '../types.ts';

const { createWebConsoleApp } = createRequire(import.meta.url)('../app.ts');
const { toResumeWorkflow } = createRequire(import.meta.url)('../repository.ts') as {
  toResumeWorkflow(record: Record<string, unknown>, client: Record<string, unknown>): ResumeWorkflowRecord;
};

test('CV mapping keeps its DTO fallback and secured priority', () => {
  assert.equal(toResumeWorkflow({ Id: 1 }, { commonChatId: '-56' }).commonChatId, '-56');
  assert.equal(toResumeWorkflow({ Id: 1 }, { commonChatId: '-56', secured_general_chat_id: '-78' }).commonChatId, '-78');
});

for (const outcome of ['success', 'api-error', 'uncertain'] as const) {
  test(`CV notification ${outcome}: one transition, secured destination only, no legacy retry`, async () => {
    const f = workflowFixture(), restore = workflowEnv([7]), sent: string[] = [];
    f.rows.get(tableIds.clients)!.get('7')!.secured_general_chat_id = '-10070';
    const telegramIntegration = createTelegramIntegration({ token: 'test-only', logger() {}, regularErrorChatId: '',
      summaryLogsChatId: '', requester: async (_url, options) => {
        const body = JSON.parse(String(options.body)); sent.push(body.chat_id);
        if (outcome === 'uncertain') throw Error('mock transport failure');
        return { ok: outcome === 'success', status: outcome === 'success' ? 200 : 403,
          async json() { return outcome === 'success'
            ? { ok: true, result: { message_id: 1, date: 1, chat: { id: Number(body.chat_id), type: 'supergroup' }, text: body.text } }
            : { ok: false, error_code: 403, description: 'mock forbidden' }; } };
      } });
    const server = await serveTestApp(createWebConsoleApp({ useMockData: true, repository: f.sql,
      ...workflowTestServices([]), telegramIntegration }));
    try {
      const action = workflowHttp(server.base, '-10070');
      const initial = (await action('status')).workflow;
      const status = 'Draft in approve by Kira';
      await f.sql.patchResumeWorkflow(initial.id, { status, cvDraftUrl: 'https://example.invalid/draft' });
      const transitions: string[] = [], patch = f.sql.patchResumeWorkflow;
      f.sql.patchResumeWorkflow = async (...args) => {
        if (args[1].status) transitions.push(args[1].status);
        return patch(...args);
      };
      const options = { actor: { userId: '9002', chatId: '9002', chatType: 'private' }, expectedStatus: status };
      const result = await action('advance', options);
      assert.equal(result.workflow.status, 'Draft in approve by student');
      assert.deepEqual(transitions, ['Draft in approve by student'], 'warning persistence must not repeat the transition');
      assert.deepEqual(sent, ['-10070']);
      await assert.rejects(action('advance', options), { code: 'resume_workflow_stale_status' });
      await action('status');
      assert.deepEqual(sent, ['-10070'], 'no duplicate delivery after reload/repeated action');
      const writes = f.count();
      await assert.rejects(workflowHttp(server.base, '-7007')('status'), { status: 404 });
      assert.equal(f.count(), writes);
    } finally { await server.close(); restore(); }
  });
}
