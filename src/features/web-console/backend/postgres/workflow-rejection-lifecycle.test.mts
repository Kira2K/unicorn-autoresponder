import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { workflowEnv, engine } from './workflow-scenario.mts';
const { getProviderTaskById, statusInstruction } = createRequire(import.meta.url)('../../../../integrations/telegram/resume-workflow.ts');

const kira = { userId: '9002', chatId: '9002', chatType: 'private' };
const student = { userId: '9001', username: 'sql_student', chatId: '-7007', chatType: 'supergroup' };
const reason = 'Нужно уточнить даты и обязанности на последнем месте работы.';
const comments = 'Исходные рекомендации Киры';

for (const mode of ['legacy', 'sql'] as const) {
  for (const market of ['Ru', 'En', 'both']) {
    for (const stage of ['Draft', 'English version', 'Russian version']) {
      if (market === 'Ru' && stage === 'English version') continue;
      test(`${mode}/${market}/${stage}: resolved rejection does not follow the next stage`, async () => {
        const f = workflowFixture(market), repo = f[mode], restore = workflowEnv([7]);
        try {
          const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
          const id = initial!.id, status = `${stage} in approve by Kira`;
          await repo.patchResumeWorkflow(id, { status, kirasComments: comments,
            cvDraftUrl: 'https://example.invalid/draft', enVersionUrl: 'https://example.invalid/en',
            ruVersionUrl: 'https://example.invalid/ru' });
          const rejected = await engine.rejectResumeWorkflow('-7007', repo, {
            actor: kira, expectedStatus: status, rejectionComment: reason
          });
          const history = rejected.workflow.rejectionHistory;
          const ownerId = stage === 'Russian version' && market !== 'Ru' ? '9004' : '9003';
          const owner = { userId: ownerId, chatId: ownerId, chatType: 'private' };
          const card = await getProviderTaskById(id, repo, owner);
          assert.ok(card.message.includes(`Комментарий возврата: ${reason}`));
          const field = stage === 'Draft' ? 'cvDraftUrl' : stage === 'English version' ? 'enVersionUrl' : 'ruVersionUrl';
          await repo.patchResumeWorkflow(id, { [field]: 'https://example.invalid/revised' });
          await engine.resumeWorkflow('-7007', repo, { actor: owner });
          const reviewed = await engine.resumeWorkflow('-7007', repo, { actor: kira });
          assert.equal(reviewed.workflow.lastRejectionComment, reason, 'reviewers retain the current reason');
          const approved = await engine.resumeWorkflow('-7007', repo, { actor: student });
          const saved = await repo.getResumeWorkflowById(id);
          assert.equal(saved?.lastRejectionComment, '', 'a completed stage must clear its active return comment');
          assert.equal(saved?.rejectionHistory, history, 'the complete audit history stays intact');
          assert.equal(saved?.kirasComments, comments, 'initial recommendations stay intact');
          assert.equal(approved.transitions?.length, 1);
          if (stage !== 'Russian version') {
            const nextOwnerId = stage === 'English version' ? '9004' : '9003';
            const nextCard = await getProviderTaskById(id, repo, {
              userId: nextOwnerId, chatId: nextOwnerId, chatType: 'private'
            });
            assert.doesNotMatch(nextCard.message, /Комментарий возврата:/);
          }
        } finally { restore(); }
      });
    }
    if (market !== 'Ru') {
      test(`${mode}/${market}: RU rejection without a saved link still notifies Polina of rework`, async () => {
        const f = workflowFixture(market), repo = f[mode], restore = workflowEnv([7]);
        try {
          const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
          await repo.patchResumeWorkflow(initial!.id, { status: 'Russian version in approve by Kira',
            ruVersionUrl: '', enVersionUrl: 'https://example.invalid/en' });
          const result = await engine.rejectResumeWorkflow('-7007', repo, { actor: kira, rejectionComment: reason }) as
            Awaited<ReturnType<typeof engine.rejectResumeWorkflow>> & { notifications: Array<{ chatId: string; text: string }> };
          assert.equal(result.notifications.length, 1);
          assert.equal(result.notifications[0].chatId, '9004');
          assert.ok(result.notifications[0].text.includes(`Причина возврата: ${reason}`));
          assert.match(result.notifications[0].text, /доработай русскую версию/);
          assert.match(result.notifications[0].text, /EN: https:\/\/example.invalid\/en/);
        } finally { restore(); }
      });
    }
  }
}

for (const market of ['Ru', 'ru', ' РУ ', 'En', 'both']) {
  for (const status of ['moved to filling', 'filled']) {
    test(`${market}/${status}: final student message only includes relevant market links`, () => {
      const record = { clientName: 'Fixture', clientMarket: market, status,
        enVersionUrl: 'https://example.invalid/old-en', ruVersionUrl: 'https://example.invalid/ru' };
      const before = structuredClone(record);
      const text = statusInstruction(record);
      assert.match(text, /Русская версия: https:\/\/example.invalid\/ru/);
      assert.equal(text.includes(record.enVersionUrl), market === 'En' || market === 'both');
      assert.deepEqual(record, before, 'hiding an irrelevant link must not erase stored data');
    });
  }
}
