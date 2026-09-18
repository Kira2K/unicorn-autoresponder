import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { engine, workflowEnv, workflowScenario } from './workflow-scenario.mts';
import { tableIds as t } from './tables.mts';
for (const market of ['Ru', 'En']) test(`complete ${market} workflow retains legacy transitions and role rules`, async () => {
  const restore = workflowEnv([7]);
  try {
    const original = workflowFixture(market), sql = workflowFixture(market);
    assert.deepEqual(await workflowScenario(sql.sql, market), await workflowScenario(original.legacy, market));
  } finally { restore(); }
});
test('parallel fields, double ensure and failures match the original adapter', async () => {
  const restore = workflowEnv([7]);
  try {
    const outcomes = [];
    for (const mode of ['legacy', 'sql'] as const) {
      const f = workflowFixture(), repo = f[mode];
      const initial = await Promise.all([repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true }),
        repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true })]);
      const id = initial[0]!.id;
      await Promise.all([repo.patchResumeWorkflow(id, { cvDraftUrl: 'draft' }), repo.patchResumeWorkflow(id, { kirasComments: 'comments' })]);
      const row = await repo.getResumeWorkflowById(id);
      assert.equal(row?.cvDraftUrl, 'draft'); assert.equal(row.kirasComments, 'comments');
      f.failWrite(); const before = f.count();
      await assert.rejects(repo.patchResumeWorkflow(id, { status: 'bad' }), /write failed/); assert.equal(f.count(), before + 1);
      f.failWrite(false); f.failRead(); await assert.rejects(engine.getResumeStatus('-7007', repo));
      outcomes.push(f.rows.get(t.cv)?.size);
    }
    assert.deepEqual(outcomes, [2, 2], 'old concurrent ensure is not atomic; do not claim new deduplication');
  } finally { restore(); }
});
