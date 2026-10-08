import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { engine, workflowEnv, type WorkflowResult } from './workflow-scenario.mts';
type RejectionResult = WorkflowResult & { message: string; parseMode?: string;
  notifications: Array<{ kind: string; text: string; parseMode?: string; chatIds?: string[] }> };
const versions = [
  ['Draft', 'Draft in process', 'cvDraftUrl'],
  ['English version', 'English version in progress', 'enVersionUrl'],
  ['Russian version', 'Russian version in process', 'ruVersionUrl']
] as const;
for (const mode of ['legacy', 'sql'] as const) for (const market of ['Ru', 'En']) {
  for (const [version, target, field] of versions) for (const reviewer of ['Kira', 'student']) {
    if (market === 'Ru' && version === 'English version') continue;
    test(`${mode}/${market}: ${reviewer} rejection preserves the stage link and provider notification`, async () => {
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
        const notification = result.notifications[0];
        if (recipient === '9003') {
          assert.equal(notification.parseMode, 'HTML');
          for (const row of ['Студент: SQL fixture', 'Стек: Go', 'Реальный возраст: 25',
            'Реальная локация: Test city', 'Желаемая локация: Remote', 'Уровень английского: B2',
            'Образование: Test University', 'Ready for interview in English in 2 months: Yes',
            `Файл на доработку: ${links[field].replaceAll('&', '&amp;')}`,
            'Комментарий: Исправить описание опыта работы &lt;проверка&gt;'])
            assert.ok(notification.text.split('\n').includes(row), row);
          for (const label of ['Email EN', 'Telegram EN', 'Phone EN', 'LinkedIn', 'GitHub',
            'Корневая папка', 'Исходные данные', 'Комментарии Киры'])
            assert.ok(notification.text.split('\n').some(row => row.startsWith(`${label}: `)), label);
        } else {
          // The translator's existing message contract is outside the Yulia change.
          assert.ok(notification.text.includes('Причина возврата: Исправить описание опыта работы <проверка>'));
          assert.ok(notification.text.includes(`EN: ${links.enVersionUrl}`));
        }
        for (const other of Object.keys(links) as Array<keyof typeof links>)
          if (other !== field) assert.equal(result.workflow[other], links[other]);
        const saved = await repo.getResumeWorkflowById(initial!.id);
        assert.equal(saved?.status, target); assert.equal(saved?.[field], '');
        await repo.patchResumeWorkflow(initial!.id, { status, ...links, [field]: '' });
        const missing = await engine.rejectResumeWorkflow('-7007', repo, {
          actor, expectedStatus: status, rejectionComment: 'оставил комменты в резюме' }) as RejectionResult;
        assert.ok(!missing.message.includes('Возвращённое резюме:'));
        assert.ok(!missing.notifications[0].text.includes('Возвращённое резюме:'), 'never substitute another version');
        if (recipient === '9003') {
          assert.ok(missing.notifications[0].text.split('\n').includes('Файл на доработку: empty'));
          assert.ok(!missing.notifications[0].text.includes('Юля, резюме для'), 'still a rejection, not a new task');
        }
      } finally { restore(); }
    });
  }
}
