const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { test } = require('node:test') as typeof import('node:test');
const { resumeWorkflowRevision } = require('./resume-workflow-state.ts') as typeof import('./resume-workflow-state.ts');
const { isResumeUrl } = require('./resume-url.ts') as typeof import('./resume-url.ts');
const { handleSupportBotCallback, handleSupportBotMessage, clearActiveTaskContextsForTest } = require('./support-bot.ts');

test('URLs preserve valid HTTP links and reject malformed URLs and pasted prose', () => {
  for (const value of ['https://docs.google.com/document/d/file/edit?usp=sharing&x=1#header', 'http://example.invalid/cv', 'https://example.invalid/русский']) assert.equal(isResumeUrl(value), true, value);
  for (const value of ['', 'https://', 'https://?q=1', 'https://[oops', 'https://bad host', 'https://example.invalid/\ncv', 'https://example.invalid/ok пояснение', 'https://example.invalid\\cv', 'ftp://example.invalid/file']) assert.equal(isResumeUrl(value), false, value);
});

test('revision is stable on reload and notifications but changes on URL, return and cycle changes', () => {
  const state = { id: 1, clientId: 7, status: 'Russian version in approve by student', ruVersionUrl: 'https://example.invalid/ru', workflowTrace: 'one' };
  const revision = resumeWorkflowRevision(state);
  assert.equal(resumeWorkflowRevision(structuredClone(state)), revision);
  assert.equal(resumeWorkflowRevision({ ...state, ...{ lastWorkflowError: 'notification warning' } }), revision);
  for (const change of [{ ruVersionUrl: state.ruVersionUrl + '2' }, { workflowTrace: 'one\ntwo' }, { rejectionHistory: 'return' }, { clientId: 8 }]) assert.notEqual(resumeWorkflowRevision({ ...state, ...change }), revision);
});

test('support bot forwards revisions from approval and reject buttons, including legacy empty tokens', async () => {
  clearActiveTaskContextsForTest();
  const requests: unknown[][] = [];
  const api = { async advanceWorkflow(...args: unknown[]) { requests.push(args); return { found: true, message: 'ok' }; },
    async rejectWorkflow(...args: unknown[]) { requests.push(args); return { found: true, message: 'returned' }; } };
  const message = { chat: { id: 9002, type: 'private' }, from: { id: 9002 } };
  for (const revision of ['new-revision', '']) {
    await handleSupportBotCallback({ data: `resume:advance:1:rak${revision ? ':' + revision : ''}`, message, from: message.from }, api);
    assert.equal(requests.at(-1)![3], revision);
    await handleSupportBotCallback({ data: `resume:reject:1:rak${revision ? ':' + revision : ''}`, message, from: message.from }, api);
    await handleSupportBotMessage({ ...message, text: 'Нужно исправить описание последнего места работы.' }, api);
    assert.equal(requests.at(-1)![4], revision);
  }
  clearActiveTaskContextsForTest();
});

test('stale rejection context is cleared; a short comment keeps the current rejection pending', async () => {
  const message = { chat: { id: -7007, type: 'supergroup' }, from: { id: 9001, username: 'sql_student' } };
  for (const code of ['resume_workflow_stale_revision', 'resume_reject_comment_too_short']) {
    clearActiveTaskContextsForTest();
    let rejects = 0;
    const api = { async rejectWorkflow() { rejects++; throw Object.assign(new Error('expected test error'), { code }); } };
    await handleSupportBotCallback({ data: 'resume:reject:1:ras:revision', message, from: message.from }, api);
    await assert.rejects(handleSupportBotMessage({ ...message, text: 'Комментарий' }, api), { code });
    if (code === 'resume_workflow_stale_revision') {
      assert.equal(await handleSupportBotMessage({ ...message, text: 'обычное сообщение в группе' }, api), null);
      assert.equal(rejects, 1);
    } else {
      await assert.rejects(handleSupportBotMessage({ ...message, text: 'Нужно исправить описание последнего места работы.' }, api), { code });
      assert.equal(rejects, 2);
    }
  }
  clearActiveTaskContextsForTest();
});
