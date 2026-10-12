import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { workflowEnv } from './workflow-scenario.mts';
import { resumeWorkflowRevision } from '../../../../integrations/telegram/resume-workflow-state.ts';
const bot = createRequire(import.meta.url)('../../../../integrations/telegram/resume-workflow.ts');
const kira = { userId: '9002', chatId: '9002', chatType: 'private' };
const yulia = { userId: '9003', chatId: '9003', chatType: 'private' };
const polina = { userId: '9004', chatId: '9004', chatType: 'private' };
const student = { userId: '9001', username: 'sql_student', chatId: '-7007', chatType: 'supergroup' };
const stages = [
  { name: 'Draft', field: 'cvDraftUrl', process: 'Draft in process' },
  { name: 'English version', field: 'enVersionUrl', process: 'English version in progress' },
  { name: 'Russian version', field: 'ruVersionUrl', process: 'Russian version in process' }
] as const;
const reason = 'Пожалуйста, уточни результаты на последнем месте работы.';

for (const mode of ['legacy', 'sql'] as const) for (const market of ['Ru', 'En', 'both']) {
  for (const stage of stages.filter(s => market !== 'Ru' || s.name !== 'English version')) {
    for (const reviewer of ['Kira', 'student']) {
      test(`${mode}/${market}/${stage.name}/${reviewer}: current buttons complete rework, preserve staff context and clear it only after student approval`, async () => {
        const restore = workflowEnv([7]);
        try {
          const f = workflowFixture(market), repo = f[mode];
          const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
          const status = `${stage.name} in approve by ${reviewer}`;
          const original = 'https://example.invalid/returned?file=exact&version=1';
          const corrected = 'https://example.invalid/corrected?file=exact&version=2';
          const actor = reviewer === 'Kira' ? kira : student;
          const provider = stage.name === 'Russian version' && market !== 'Ru' ? polina : yulia;
          const before = await repo.patchResumeWorkflow(initial!.id, { status,
            cvDraftUrl: 'https://example.invalid/draft', enVersionUrl: 'https://example.invalid/en',
            ruVersionUrl: 'https://example.invalid/ru', [stage.field]: original,
            kirasComments: 'Исходное задание Киры', rejectionHistory: 'old text history' });
          const returned = await bot.rejectResumeWorkflowById(before.id, repo, {
            actor, expectedStatus: status, expectedRevision: resumeWorkflowRevision(before), rejectionComment: reason
          });
          assert.equal(returned.workflow.status, stage.process);
          assert.equal(returned.workflow[stage.field], '');
          assert.ok(returned.notifications[0].text.includes(reason));
          assert.ok(returned.notifications[0].text.includes(original.replaceAll('&', returned.notifications[0].parseMode === 'HTML' ? '&amp;' : '&')));
          const card = await bot.getProviderTaskById(before.id, repo, provider);
          assert.ok(card.message.includes(reason));
          assert.ok(card.message.includes(original.replaceAll('&', card.parseMode === 'HTML' ? '&amp;' : '&')));
          const list = await bot.getProviderTasks(repo, provider);
          assert.ok(!list.message.includes(reason));
          const saved = await bot.saveProviderLinkFromChat(repo, provider, corrected, { workflowId: before.id, expectedStatus: stage.process });
          assert.ok(!saved.message.includes(reason));
          assert.equal(saved.workflow.lastRejectionComment, reason);
          const next = saved.replyMarkup.inline_keyboard.flat().find((b: any) => b.text === 'Перейти к следующему шагу');
          assert.ok(next);
          const revision = next.callback_data.split(':')[4];
          assert.equal(revision, resumeWorkflowRevision(saved.workflow));
          // Notification warnings and readback must not invalidate the contractor's fresh button.
          await repo.patchResumeWorkflow(before.id, { lastWorkflowError: 'Test notification warning' });
          const toKira = await bot.resumeWorkflowById(before.id, repo, { actor: provider, expectedStatus: stage.process, expectedRevision: revision });
          assert.equal(toKira.workflow.status, `${stage.name} in approve by Kira`);
          assert.equal(toKira.workflow.lastRejectionComment, reason);
          const kiraCard = await bot.getProviderTaskById(before.id, repo, kira);
          assert.ok(kiraCard.message.includes(reason));
          const approval = kiraCard.replyMarkup.inline_keyboard.flat().find((b: any) => b.text === 'Согласовать');
          const toStudent = await bot.resumeWorkflowById(before.id, repo, { actor: kira,
            expectedStatus: toKira.workflow.status, expectedRevision: approval.callback_data.split(':')[4] });
          assert.equal(toStudent.workflow.lastRejectionComment, reason);
          assert.ok(toStudent.notifications[0].text.includes(corrected));
          assert.ok(!toStudent.notifications[0].text.includes(reason));
          const studentApproval = toStudent.notifications[0].replyMarkup.inline_keyboard.flat().find((b: any) => b.text === 'Согласовать');
          const approved = await bot.resumeWorkflowById(before.id, repo, { actor: student,
            expectedStatus: toStudent.workflow.status, expectedRevision: studentApproval.callback_data.split(':')[4] });
          assert.equal(approved.workflow.lastRejectionComment, '');
          assert.equal(approved.workflow.rejectionHistory, returned.workflow.rejectionHistory);
          assert.ok(!approved.message.includes(reason));
          assert.ok(!(await bot.getResumeStatus('-7007', repo)).message.includes(reason));
          if (market === 'Ru' && stage.name === 'Russian version') {
            assert.ok(!approved.message.includes('https://example.invalid/en'));
            assert.ok(approved.message.includes(corrected));
          }
        } finally { restore(); }
      });
    }
  }
}
