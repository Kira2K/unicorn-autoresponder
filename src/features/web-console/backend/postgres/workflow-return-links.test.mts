import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { engine, workflowEnv, type WorkflowResult } from './workflow-scenario.mts';
type RejectionResult = WorkflowResult & { message: string; parseMode?: string;
  notifications: Array<{ kind: string; text: string; chatIds?: string[] }> };
const versions = [
  ['Draft', 'Draft in process', 'cvDraftUrl'],
  ['English version', 'English version in progress', 'enVersionUrl'],
  ['Russian version', 'Russian version in process', 'ruVersionUrl']
] as const;
for (const mode of ['legacy', 'sql'] as const) for (const market of ['Ru', 'En']) {
  for (const [version, target, field] of versions) for (const reviewer of ['Kira', 'student']) {
    if (market === 'Ru' && version === 'English version') continue;
    test(`${mode}/${market}: ${reviewer} returns the exact ${version} link to its author`, async () => {
      const restore = workflowEnv([7]);
      try {
        const f = workflowFixture(market), repo = f[mode];
        const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
        const status = `${version} in approve by ${reviewer}`;
        const links = { cvDraftUrl: 'https://example.invalid/draft?a=1&b=2',
          enVersionUrl: 'https://example.invalid/en?a=1&b=2', ruVersionUrl: 'https://example.invalid/ru?a=1&b=2' };
        const actor = reviewer === 'Kira' ? { userId: '9002', chatId: '9002', chatType: 'private' }
          : { userId: '9001', username: 'sql_student', chatId: '-7007', chatType: 'supergroup' };
        await repo.patchResumeWorkflow(initial!.id, { status, ...links });
        const result = await engine.rejectResumeWorkflow('-7007', repo, {
          actor, expectedStatus: status, rejectionComment: 'Исправить описание опыта работы <проверка>' }) as RejectionResult;
        assert.equal(result.workflow.status, target); assert.equal(result.workflow[field], '');
        assert.ok(result.workflow.rejectionHistory?.includes('Исправить описание опыта работы <проверка>'));
        const expectedUrl = reviewer === 'Kira' ? links[field].replaceAll('&', '&amp;') : links[field];
        assert.ok(result.message.includes(`Возвращённое резюме: ${expectedUrl}`));
        assert.equal(result.parseMode, reviewer === 'Kira' ? 'HTML' : undefined);
        const recipient = market === 'En' && field === 'ruVersionUrl' ? '9004' : '9003';
        assert.equal(result.notifications.length, 1);
        assert.deepEqual(result.notifications[0].chatIds, [recipient]);
        assert.ok(result.notifications[0].text.includes(`Возвращённое резюме: ${links[field]}`));
        assert.ok(result.notifications[0].text.includes('Исправить описание опыта работы <проверка>'));
        for (const other of Object.keys(links) as Array<keyof typeof links>)
          if (other !== field) assert.equal(result.workflow[other], links[other]);
        const saved = await repo.getResumeWorkflowById(initial!.id);
        assert.equal(saved?.status, target); assert.equal(saved?.[field], '');
        await repo.patchResumeWorkflow(initial!.id, { status, ...links, [field]: '' });
        const missing = await engine.rejectResumeWorkflow('-7007', repo, {
          actor, expectedStatus: status, rejectionComment: 'оставил комменты в резюме' }) as RejectionResult;
        assert.ok(!missing.message.includes('Возвращённое резюме:'));
        assert.ok(!missing.notifications[0].text.includes('Возвращённое резюме:'), 'never substitute another version');
      } finally { restore(); }
    });
  }
}
