import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowFixture } from '../../web-console/backend/postgres/workflow-fixture.mts';
import { createSqlConsoleRepository } from '../../web-console/backend/postgres/repository.mts';
import { workflowEnv, workflowScenario, engine } from '../../web-console/backend/postgres/workflow-scenario.mts';

for (const market of ['En', 'Ru']) test(`LinkLab preserves the complete ${market} CV path`, async () => {
  const f = workflowFixture(market), restore = workflowEnv([7]);
  const approvals: unknown[] = [];
  f.sql.approveEnglishResumeWorkflow = async (before, patch) => {
    approvals.push({ before: before.status, url: before.enVersionUrl });
    return f.sql.patchResumeWorkflow(before.id, patch);
  };
  try {
    await workflowScenario(f.sql, market);
    assert.equal(approvals.length, market === 'Ru' ? 0 : 1);
    if (market === 'En') assert.deepEqual(approvals, [{ before: 'English version in approve by student', url: 'https://example.invalid/en' }]);
  } finally { restore(); }
});

test('wrong role, failed approval and repeated click do not advance or notify', async () => {
  const f = workflowFixture(), restore = workflowEnv([7]);
  try {
    const w = (await engine.getResumeStatus('-7007', f.sql)).workflow;
    await f.sql.patchResumeWorkflow(w.id, { status: 'English version in approve by student', enVersionUrl: 'https://example.invalid/en' });
    let called = 0;
    f.sql.approveEnglishResumeWorkflow = async () => { called++; throw Error('fixture approval failure'); };
    const actor = { userId: '9001', username: 'sql_student', chatId: '-7007', chatType: 'supergroup' };
    const options = { actor, expectedStatus: 'English version in approve by student' };
    await assert.rejects(engine.resumeWorkflow('-7007', f.sql, { ...options, actor: { ...actor, username: 'stranger', userId: '9999' } }), { code: 'forbidden' });
    assert.equal(called, 0);
    await assert.rejects(engine.resumeWorkflow('-7007', f.sql, options), /fixture approval/);
    assert.equal((await f.sql.getResumeWorkflowById(w.id))!.status, options.expectedStatus);
    f.sql.approveEnglishResumeWorkflow = (before, patch) => f.sql.patchResumeWorkflow(before.id, patch);
    assert.equal((await engine.resumeWorkflow('-7007', f.sql, options)).workflow.status, 'Russian version in process');
    await assert.rejects(engine.resumeWorkflow('-7007', f.sql, options), { code: 'resume_workflow_stale_status' });
  } finally { restore(); }
});

test('SQL adapter uses the same serializer, restricts test students, and is opt-in', async () => {
  const f = workflowFixture(), restore = workflowEnv([7]);
  let approval: unknown;
  const repo = createSqlConsoleRepository(f.db, { ...f.grant, linklab: {
    account: () => { throw Error('not used'); },
    englishApproval: async (before, patch) => { approval = patch; await f.db.patchRecord('mhiysd8l0f33bny', [String(before.id)], patch); }
  } });
  try {
    assert.equal(f.sql.approveEnglishResumeWorkflow, undefined);
    const w = (await engine.getResumeStatus('-7007', repo)).workflow;
    await assert.rejects(repo.approveEnglishResumeWorkflow!({ ...w, clientId: 8 }, {}), { code: 'forbidden' });
    await repo.approveEnglishResumeWorkflow!(w, { status: 'Russian version in process', workflowTrace: 'history', lastResponsible: 'provider', lastWorkflowError: '' });
    assert.deepEqual(approval, { status: 'Russian version in process', workflow_trace: 'history', last_responsible: 'provider', last_workflow_error: '' });
  } finally { restore(); }
});
