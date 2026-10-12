import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { workflowEnv } from './workflow-scenario.mts';
import { resumeWorkflowRevision } from '../../../../integrations/telegram/resume-workflow-state.ts';
const require = createRequire(import.meta.url);
const bot = require('../../../../integrations/telegram/resume-workflow.ts');
const support = require('../../../../integrations/telegram/support-bot.ts');
const kira = { userId: '9002', chatId: '9002', chatType: 'private' };
const yulia = { userId: '9003', chatId: '9003', chatType: 'private' };
const polina = { userId: '9004', chatId: '9004', chatType: 'private' };
const student = { userId: '9001', username: 'sql_student', chatId: '-7007', chatType: 'supergroup' };
const reason = 'Нужно исправить описание последнего места работы.';

for (const mode of ['legacy', 'sql'] as const) {
  test(`${mode}: unknown statuses stay unchanged without writes or reset`, async () => {
    const restore = workflowEnv([7]);
    try {
      const f = workflowFixture('Ru'), repo = f[mode];
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      for (const status of ['finished', 'unexpected process', 'unexpected Kira']) {
        await repo.patchResumeWorkflow(initial!.id, { status, ruVersionUrl: 'https://example.invalid/final', rejectionHistory: 'old history' });
        const before = await repo.getResumeWorkflowById(initial!.id), count = f.count();
        await assert.rejects(bot.resumeWorkflowById(initial!.id, repo, { actor: student }), { code: 'resume_workflow_unknown_status' });
        assert.deepEqual(await repo.getResumeWorkflowById(initial!.id), before);
        assert.equal(f.count(), count);
        const result = await bot.getResumeStatus('-7007', repo);
        assert.match(result.message, /неизвестный статус/i);
      }
    } finally { restore(); }
  });

  for (const market of ['Ru', 'En', 'both']) test(`${mode}/${market}: bad RU URLs cannot be saved or advanced from storage`, async () => {
    const restore = workflowEnv([7]);
    try {
      const f = workflowFixture(market), repo = f[mode];
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      const owner = market === 'Ru' ? yulia : polina;
      const status = 'Russian version in process';
      await repo.patchResumeWorkflow(initial!.id, { status, ruVersionUrl: '' });
      for (const url of ['https://', 'https://?x=1', 'https://bad host/cv', 'https://example.invalid/cv another', 'https://[bad', 'javascript:alert(1)']) {
        const before = f.count();
        await bot.saveProviderLinkFromChat(repo, owner, url, { workflowId: initial!.id, expectedStatus: status });
        assert.equal(f.count(), before, url);
      }
      for (const status of ['Russian version in process', 'Russian version in approve by Kira', 'Russian version in approve by student']) {
        await repo.patchResumeWorkflow(initial!.id, { status, ruVersionUrl: 'https://' });
        const actor = status.endsWith('Kira') ? kira : status.endsWith('student') ? student : owner;
        const result = await bot.resumeWorkflowById(initial!.id, repo, { actor });
        assert.equal(result.workflow.status, status);
        assert.deepEqual(result.transitions, []);
      }
      const good = 'https://docs.google.com/document/d/test/edit?usp=sharing&x=1#heading';
      await repo.patchResumeWorkflow(initial!.id, { status, ruVersionUrl: '' });
      await bot.saveProviderLinkFromChat(repo, owner, good, { workflowId: initial!.id });
      assert.equal((await repo.getResumeWorkflowById(initial!.id))!.ruVersionUrl, good);
    } finally { restore(); }
  });

  for (const market of ['Ru', 'En', 'both']) for (const reviewer of ['Kira', 'student']) {
    test(`${mode}/${market}/${reviewer}: obsolete and legacy buttons cannot approve or reject a resubmission`, async () => {
      const restore = workflowEnv([7]);
      try {
        const f = workflowFixture(market), repo = f[mode];
        const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
        const actor = reviewer === 'Kira' ? kira : student, owner = market === 'Ru' ? yulia : polina;
        const status = `Russian version in approve by ${reviewer}`;
        const url = 'https://example.invalid/ru';
        const first = await repo.patchResumeWorkflow(initial!.id, { status, ruVersionUrl: url });
        const oldRevision = resumeWorkflowRevision(first);
        await bot.rejectResumeWorkflowById(initial!.id, repo, { actor, expectedStatus: status, expectedRevision: oldRevision, rejectionComment: reason });
        // Same document URL is common when the provider edits in place.
        await bot.saveProviderLinkFromChat(repo, owner, url, { workflowId: initial!.id });
        await bot.resumeWorkflowById(initial!.id, repo, { actor: owner });
        if (reviewer === 'student') {
          const toStudent = await bot.resumeWorkflowById(initial!.id, repo, { actor: kira });
          const buttons = toStudent.notifications[0].replyMarkup.inline_keyboard.flat();
          for (const button of buttons) assert.equal(button.callback_data.split(':')[4], resumeWorkflowRevision(toStudent.workflow));
        }
        const current = await repo.getResumeWorkflowById(initial!.id);
        const count = f.count();
        for (const expectedRevision of [oldRevision, '']) {
          await assert.rejects(bot.resumeWorkflowById(initial!.id, repo, { actor, expectedStatus: status, expectedRevision }), { code: 'resume_workflow_stale_revision' });
          await assert.rejects(bot.rejectResumeWorkflowById(initial!.id, repo, { actor, expectedStatus: status, expectedRevision, rejectionComment: reason }), { code: 'resume_workflow_stale_revision' });
        }
        assert.equal(f.count(), count);
        assert.notEqual(resumeWorkflowRevision(current!), oldRevision);
        const revision = resumeWorkflowRevision(JSON.parse(JSON.stringify(current)));
        const callback = bot.callbackData('advance', initial!.id, status, revision);
        assert.ok(Buffer.byteLength(callback) <= 64);
        const result = await support.handleSupportBotCallback({ data: callback, from: { id: Number(actor.userId), username: 'sql_student' },
          message: { chat: { id: Number(actor.chatId), type: actor.chatType } } }, {
          advanceWorkflow: (id: number, expectedStatus: string, actor: unknown, expectedRevision?: string) =>
            bot.resumeWorkflowById(id, repo, { expectedStatus, actor, expectedRevision })
        });
        assert.ok(result);
        assert.notEqual((await repo.getResumeWorkflowById(initial!.id))!.status, status);
      } finally { restore(); }
    });
  }

  test(`${mode}: overlapping returns commit once and preserve all prior history`, async () => {
    const restore = workflowEnv([7]);
    try {
      const f = workflowFixture('Ru'), repo = f[mode];
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      const status = 'Russian version in approve by Kira';
      const snapshot = await repo.patchResumeWorkflow(initial!.id, { status, ruVersionUrl: 'https://example.invalid/ru', rejectionHistory: 'old history\n' });
      let readers = 0, release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const racing = { ...repo, async getResumeWorkflowById() {
        if (++readers === 2) release();
        await barrier;
        return structuredClone(snapshot);
      } };
      const results = await Promise.allSettled([reason, reason + ' Второй запрос.'].map(rejectionComment =>
        bot.rejectResumeWorkflowById(initial!.id, racing, { actor: kira, expectedStatus: status, rejectionComment })));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
      assert.equal(failed.reason.code, 'resume_workflow_stale_revision');
      const final = await repo.getResumeWorkflowById(initial!.id);
      assert.ok(final!.rejectionHistory.startsWith('old history\n'));
      assert.equal(final!.rejectionHistory.trim().split('\n').length, 2);
      const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>;
      assert.equal(final!.lastRejectionComment, winner.value.workflow.lastRejectionComment);
      assert.equal(winner.value.notifications.length, 1);
    } finally { restore(); }
  });
}
