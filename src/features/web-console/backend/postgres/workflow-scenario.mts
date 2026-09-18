import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { WebConsoleRepository, ResumeWorkflowRecord } from '../types.ts';
export type Actor = { userId: string; username?: string; chatId: string; chatType: string };
export type WorkflowResult = { workflow: ResumeWorkflowRecord; transitions?: string[]; completed?: boolean };
type Options = { actor: Actor; expectedStatus?: string; rejectionComment?: string };
export const engine = createRequire(import.meta.url)('../../../../integrations/telegram/resume-workflow.ts') as {
  getResumeStatus(chat: string, repo: WebConsoleRepository): Promise<WorkflowResult>;
  resumeWorkflow(chat: string, repo: WebConsoleRepository, options: Options): Promise<WorkflowResult>;
  rejectResumeWorkflow(chat: string, repo: WebConsoleRepository, options: Options): Promise<WorkflowResult>;
};
export function workflowEnv(clientIds: number[]) {
  const values: Record<string, string> = { WEB_CONSOLE_BOT_API_TOKEN: 'sql-test-only', RESUME_WORKFLOW_TEST_MODE: 'true',
    RESUME_WORKFLOW_FAKE_DATA_MODE: 'false', RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS: '9002',
    RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS: '9003', RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS: '9004',
    RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID: '9002', RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID: '9003',
    RESUME_WORKFLOW_RUS_TRANSLATOR_NOTIFY_CHAT_ID: '9004', RESUME_WORKFLOW_LINKEDIN_READY_CHAT_ID: '-9005',
    RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS: clientIds.map(id => `${id}:1`).join(',') };
  const before = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]])); Object.assign(process.env, values);
  return () => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}
export type WorkflowAction = (action: 'status' | 'advance' | 'reject', options?: Options) => Promise<WorkflowResult>;
export async function workflowScenario(repo: WebConsoleRepository, market: string, chat = '-7007', supplied?: WorkflowAction) {
  const action: WorkflowAction = supplied ?? ((op, options) => op === 'status' ? engine.getResumeStatus(chat, repo)
    : (op === 'reject' ? engine.rejectResumeWorkflow : engine.resumeWorkflow)(chat, repo, options!));
  const actor = (id: string): Actor => ({ userId: id, username: id === '9001' ? 'sql_student' : 'test_actor',
    chatId: id === '9001' ? chat : id, chatType: id === '9001' ? 'supergroup' : 'private' });
  let w = (await action('status')).workflow;
  assert.equal(w.status, "collection student's data");
  assert.equal((await action('advance', { actor: actor('9001') })).transitions?.length, 0);
  await assert.rejects(action('advance', { actor: actor('9003') }), { code: 'forbidden' });
  w = await repo.patchResumeWorkflow(w.id, { studentDataFolderUrl: 'https://example.invalid/source',
    kirasComments: 'Test comments', cvDraftUrl: 'https://example.invalid/draft',
    enVersionUrl: market === 'Ru' ? '' : 'https://example.invalid/en', ruVersionUrl: 'https://example.invalid/ru' });
  const states = ["collection student's data", "collection Kira's comments", 'Draft in process', 'Draft in approve by Kira',
    'Draft in approve by student', ...(market === 'Ru' ? [] : ['English version in progress', 'English version in approve by Kira',
      'English version in approve by student']), 'Russian version in process', 'Russian version in approve by Kira',
    'Russian version in approve by student', 'moved to filling'];
  const owner = (status: string) => status === "collection student's data" || status.includes('by student') ? '9001'
    : status.includes('Kira') ? '9002' : status === 'Russian version in process' && market !== 'Ru' ? '9004' : '9003';
  for (let i = 0; i < states.length - 1; i++) {
    assert.equal(w.status, states[i]);
    if (i === 3) {
      w = (await action('reject', { actor: actor('9002'), expectedStatus: w.status, rejectionComment: 'оставил комменты в резюме' })).workflow;
      assert.equal(w.status, 'Draft in process'); assert.equal(w.cvDraftUrl, ''); assert.ok(w.rejectionHistory);
      await repo.patchResumeWorkflow(w.id, { cvDraftUrl: 'https://example.invalid/revised' });
      w = (await action('advance', { actor: actor('9003'), expectedStatus: w.status })).workflow;
    }
    const result = await action('advance', { actor: actor(owner(w.status)), expectedStatus: w.status });
    assert.equal(result.transitions?.length, 1); w = result.workflow; assert.equal(w.status, states[i + 1]);
    await assert.rejects(action('advance', { actor: actor(owner(states[i])), expectedStatus: states[i] }), { code: 'resume_workflow_stale_status' });
  }
  await assert.rejects(action('advance', { actor: actor('9002') }), { code: 'resume_workflow_noop' });
  // The bot stops at moved to filling. An external filler owns the eventual filled status.
  await repo.patchResumeWorkflow(w.id, { status: 'filled' });
  const final = await action('status'); assert.equal(final.completed, true);
  assert.equal(final.workflow.ruVersionUrl, 'https://example.invalid/ru');
  assert.equal(final.workflow.enVersionUrl, market === 'Ru' ? '' : 'https://example.invalid/en');
  return { market, states, workflowId: w.id, rejection: true, completedReadback: true };
}
