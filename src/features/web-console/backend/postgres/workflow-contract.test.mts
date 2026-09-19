import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { engine, workflowEnv, workflowScenario } from './workflow-scenario.mts';
import { tableIds as t } from './tables.mts';
for (const mode of ['legacy', 'sql'] as const) test(`${mode}: Telegram contacts prefer nicknames without changing logins or identity`, async () => {
  const f = workflowFixture(), repo = f[mode], accounts = f.rows.get(t.accounts)!;
  const statusColumn = { id: 'test-status', title: 'client_status', dataKey: 'client_status', sqlName: 'client_status', sqlType: 'text',
    colOptions: { options: [{ id: 'studying-option', title: 'studying' }] } };
  f.db.listTables().find(table => table.id === t.clients)!.columns.push(statusColumn);
  const account = (id: number, data: Record<string, unknown>) => f.set(t.accounts, id, { ...accounts.get(String(id)), ...data });
  account(22, { login: 'ru@example.invalid', nickname: ' @student_ru ' });
  account(23, { login: 'en@example.invalid', nickname: '@student_en' });
  f.set(t.platforms, 30, { platform: 'phone_en' });
  f.set(t.accounts, 24, { clients_id: 7, platforms_id: 30, login: '+15550100', nickname: 'not-a-phone' });
  await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
  const before = structuredClone(accounts), writes = f.count();
  let workflow = await repo.getResumeWorkflowByTelegramChatId('-7007');
  assert.equal(workflow?.clientTelegramRu, '@student_ru');
  assert.equal(workflow?.clientTelegramEn, '@student_en');
  assert.equal(workflow?.clientTelegramUsername, '@sql_student', 'student authorization identity is unchanged');
  assert.equal(workflow?.clientPhoneEn, '+15550100', 'other platforms retain login-first display');
  const card = await repo.getProviderClientByIdForStatus(7, 'studying');
  assert.equal(card?.telegramRu, '@student_ru'); assert.equal(card?.telegramEn, '@student_en');
  assert.deepEqual(accounts, before); assert.equal(f.count(), writes, 'display must not write account data');
  for (const nickname of ['', '   ', null]) {
    account(22, { nickname });
    workflow = await repo.getResumeWorkflowByTelegramChatId('-7007');
    assert.equal(workflow?.clientTelegramRu, 'ru@example.invalid');
    assert.equal(workflow?.clientTelegramEn, '@student_en');
  }
});

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
