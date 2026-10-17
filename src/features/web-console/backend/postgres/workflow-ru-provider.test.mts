import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { workflowEnv } from './workflow-scenario.mts';
import { tableIds as t } from './tables.mts';
import { createSqlTestConsole } from './test-app.mts';
import { serveTestApp } from './workflow-http.mts';
import type { TestNotification } from './workflow-test-services.mts';

const bot = createRequire(import.meta.url)('../../../../integrations/telegram/resume-workflow.ts');
const yulia = { userId: '9003', chatId: '9003', chatType: 'private' };
const kira = { userId: '9002', chatId: '9002', chatType: 'private' };
const student = { userId: '9001', username: 'sql_student', chatId: '-7007', chatType: 'supergroup' };
const stages = [
  { name: 'Draft', before: "collection Kira's comments", status: 'Draft in process', field: 'cvDraftUrl', actor: kira },
  { name: 'Russian version', before: 'Draft in approve by student', status: 'Russian version in process', field: 'ruVersionUrl', actor: student }
] as const;

function contacts(f: ReturnType<typeof workflowFixture>, hhPhone = '+79990000001') {
  for (const [id, platform, data] of [
    [70, 'email_ru', { login: 'ru+tag&test@example.invalid', email: 'wrong-email', nickname: 'wrong-email' }],
    [71, 'hh_ru', { phone: hhPhone, login: 'wrong-hh-login' }],
    [72, 'phone_ru', { login: '+79990000002' }],
    [73, 'email_en', { login: 'en@example.invalid' }],
    [74, 'phone_en', { login: '+15550000001' }]
  ] as const) {
    f.set(t.platforms, id, { platform });
    f.set(t.accounts, id, { clients_id: 7, platforms_id: id, password: 'never-show-secret', ...data });
  }
  const ru = f.rows.get(t.accounts)!.get('22')!;
  f.set(t.accounts, 22, { ...ru, nickname: ' @ru<&> ', login: 'wrong-telegram-login' });
}

for (const mode of ['legacy', 'sql'] as const) {
  for (const market of ['Ru', 'ru', ' РУ ']) test(`${mode}/${market}: Ru intake needs no LinkedIn or Telegram EN`, async () => {
    const restore = workflowEnv([7]), f = workflowFixture(market), repo = f[mode];
    try {
      f.rows.get(t.accounts)!.delete('21');
      f.rows.get(t.accounts)!.delete('23');
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      await repo.patchResumeWorkflow(initial!.id, { studentDataFolderUrl: 'https://example.invalid/source' });
      const current = await repo.getResumeWorkflowById(initial!.id);
      assert.deepEqual(bot.requiredClientDataIssues(current), []);
      const result = await bot.resumeWorkflowById(initial!.id, repo, { actor: student });
      assert.equal(result.workflow.status, "collection Kira's comments");
      assert.equal(result.transitions.length, 1);
      f.rows.get(t.accounts)!.delete('20');
      f.rows.get(t.accounts)!.delete('22');
      assert.deepEqual(bot.requiredClientDataIssues(await repo.getResumeWorkflowById(initial!.id)), ['Github', 'Telegram RU']);
    } finally { restore(); }
  });

  for (const market of ['En', 'both']) test(`${mode}/${market}: intake still requires LinkedIn and Telegram EN`, async () => {
    const restore = workflowEnv([7]), f = workflowFixture(market), repo = f[mode];
    try {
      f.rows.get(t.accounts)!.delete('21');
      f.rows.get(t.accounts)!.delete('23');
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      await repo.patchResumeWorkflow(initial!.id, { studentDataFolderUrl: 'https://example.invalid/source' });
      assert.deepEqual(bot.requiredClientDataIssues(await repo.getResumeWorkflowById(initial!.id)), ['LinkedIn', 'Telegram EN']);
      const result = await bot.resumeWorkflowById(initial!.id, repo, { actor: student });
      assert.equal(result.workflow.status, "collection student's data");
      assert.deepEqual(result.transitions, []);
      assert.deepEqual(result.notifications, []);
    } finally { restore(); }
  });

  for (const stage of stages) test(`${mode}/Ru/${stage.name}: notification and reopened card show full details and RU contacts`, async () => {
    const restore = workflowEnv([7]), f = workflowFixture('Ru'), repo = f[mode];
    try {
      contacts(f);
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      await repo.patchResumeWorkflow(initial!.id, { status: stage.before,
        cvDraftUrl: stage.name === 'Draft' ? '' : 'https://example.invalid/draft?a=1&b=2',
        kirasComments: 'Исходное <задание> & комментарии', studentDataFolderUrl: 'https://example.invalid/source' });
      const result = await bot.resumeWorkflowById(initial!.id, repo, { actor: stage.actor });
      assert.equal(result.workflow.status, stage.status);
      const count = f.count();
      const card = await bot.getProviderTaskById(initial!.id, repo, yulia);
      const notice = result.notifications.find((n: { kind: string }) => n.kind === 'private_provider');
      assert.equal(notice.text.split('\n\n').slice(1).join('\n\n'), card.message);
      assert.deepEqual(notice.chatIds, ['9003']);
      assert.equal(card.parseMode, 'HTML');
      for (const row of ['Стек: Go', 'Реальная локация: Test city', 'Желаемая локация: Remote',
        'Реальный возраст: 25', 'Уровень английского: B2', 'Образование: Test University',
        'Ready for interview in English in 2 months: Yes', 'Email RU: ru+tag&amp;test@example.invalid',
        'Telegram RU: @ru&lt;&amp;&gt;', 'Phone RU: +79990000001', 'Email EN: en@example.invalid',
        'Phone EN: +15550000001', 'Корневая папка: https://example.invalid/root',
        'Исходные данные: https://example.invalid/source', 'Комментарии Киры: Исходное &lt;задание&gt; &amp; комментарии']) {
        assert.equal(card.message.split('\n').filter((line: string) => line === row).length, 1, row);
      }
      for (const label of ['Telegram EN', 'LinkedIn', 'GitHub']) assert.ok(card.message.includes(label + ': '));
      assert.doesNotMatch(card.message, /wrong-|never-show-secret/);
      assert.equal(f.count(), count, 'opening a card never writes');
      assert.deepEqual(card.replyMarkup.inline_keyboard.flat().map((b: { text: string }) => b.text), ['Назад к задачам']);
      if (stage.name === 'Russian version') assert.ok(card.message.includes('Черновик: https://example.invalid/draft?a=1&amp;b=2'));
    } finally { restore(); }
  });

  for (const stage of stages) test(`${mode}/Ru/${stage.name}: phone falls back and missing contacts remain optional`, async () => {
    const restore = workflowEnv([7]), f = workflowFixture('Ru'), repo = f[mode];
    try {
      contacts(f, '   ');
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      await repo.patchResumeWorkflow(initial!.id, { status: stage.status });
      let card = await bot.getProviderTaskById(initial!.id, repo, yulia);
      assert.ok(card.message.includes('Phone RU: +79990000002'));
      const ru = f.rows.get(t.accounts)!.get('22')!;
      f.set(t.accounts, 22, { ...ru, nickname: '', login: '@fallback_ru' });
      card = await bot.getProviderTaskById(initial!.id, repo, yulia);
      assert.ok(card.message.includes('Telegram RU: @fallback_ru'));
      for (const id of ['70', '71', '72', '22']) f.rows.get(t.accounts)!.delete(id);
      card = await bot.getProviderTaskById(initial!.id, repo, yulia);
      for (const label of ['Email RU', 'Telegram RU', 'Phone RU']) assert.ok(card.message.includes(label + ': empty'));
      const saved = await bot.saveProviderLinkFromChat(repo, yulia, 'https://example.invalid/new', { workflowId: initial!.id, expectedStatus: stage.status });
      assert.equal(saved.workflow[stage.field], 'https://example.invalid/new');
      assert.ok(saved.replyMarkup.inline_keyboard.flat().some((b: { text: string }) => b.text === 'Перейти к следующему шагу'));
    } finally { restore(); }
  });

  for (const stage of stages) for (const reviewer of ['Kira', 'student']) test(`${mode}/Ru/${stage.name}/${reviewer}: full rework retains the exact rejected file`, async () => {
    const restore = workflowEnv([7]), f = workflowFixture('Ru'), repo = f[mode];
    try {
      contacts(f);
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      const original = `https://example.invalid/${stage.field}?v=1&returned=yes`, reason = 'Исправить <описание> & достижения в резюме.';
      await repo.patchResumeWorkflow(initial!.id, { status: `${stage.name} in approve by ${reviewer}`,
        cvDraftUrl: 'https://example.invalid/draft', ruVersionUrl: 'https://example.invalid/ru', [stage.field]: original });
      const returned = await bot.rejectResumeWorkflowById(initial!.id, repo, { actor: reviewer === 'Kira' ? kira : student, rejectionComment: reason });
      const notice = returned.notifications[0], card = await bot.getProviderTaskById(initial!.id, repo, yulia);
      for (const message of [notice.text, card.message]) {
        assert.ok(message.includes(`Файл на доработку: ${original.replaceAll('&', '&amp;')}`));
        assert.ok(message.includes('Email RU: ru+tag&amp;test@example.invalid'));
        assert.ok(message.includes('Telegram RU: @ru&lt;&amp;&gt;'));
        assert.ok(message.includes('Phone RU: +79990000001'));
        assert.ok(message.includes('Исправить &lt;описание&gt; &amp; достижения в резюме.'));
      }
      assert.equal(returned.workflow[stage.field], '');
      assert.equal(JSON.parse(returned.workflow.rejectionHistory.split('\n').at(-1)).returnedCvUrl, original);
      await bot.saveProviderLinkFromChat(repo, yulia, 'https://example.invalid/corrected', { workflowId: initial!.id, expectedStatus: stage.status });
      assert.ok((await bot.getProviderTaskById(initial!.id, repo, yulia)).message.includes(original.replaceAll('&', '&amp;')));
    } finally { restore(); }
  });

  for (const market of ['En', 'both']) test(`${mode}/${market}: Yulia and Polina keep their existing contact contracts`, async () => {
    const restore = workflowEnv([7]), f = workflowFixture(market), repo = f[mode];
    try {
      contacts(f, '');
      const initial = await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
      await repo.patchResumeWorkflow(initial!.id, { status: 'Draft in process' });
      assert.doesNotMatch((await bot.getProviderTaskById(initial!.id, repo, yulia)).message, /Email RU:|Telegram RU:|Phone RU:/);
      await repo.patchResumeWorkflow(initial!.id, { status: 'Russian version in process' });
      assert.equal((await bot.getProviderTaskById(initial!.id, repo, yulia)).tasks.length, 0);
      const polina = await bot.getProviderTaskById(initial!.id, repo, { userId: '9004', chatId: '9004', chatType: 'private' });
      assert.equal(polina.tasks.length, 1);
      assert.doesNotMatch(polina.message, /Phone RU:/, 'translator still uses HH RU phone only');
    } finally { restore(); }
  });
}

test('protected SQL API returns the full Ru card without writes or sends on reopening', async () => {
  const restore = workflowEnv([7]), f = workflowFixture('Ru'), notifications: TestNotification[] = [];
  contacts(f);
  const server = await serveTestApp(createSqlTestConsole(f.db, f.grant, { notifications }));
  try {
    const initial = await f.sql.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
    await f.sql.patchResumeWorkflow(initial!.id, { status: 'Russian version in process', cvDraftUrl: 'https://example.invalid/draft' });
    const writes = f.count();
    const headers = { 'X-Bot-Api-Token': 'sql-test-only', 'X-Telegram-User-Id': '9003', 'X-Telegram-Chat-Id': '9003', 'X-Telegram-Chat-Type': 'private' };
    const response = await fetch(`${server.base}/api/bot/telegram/resume/workflows/${initial!.id}`, { headers });
    assert.equal(response.status, 200);
    const card = await response.json();
    assert.equal(card.message, (await bot.getProviderTaskById(initial!.id, f.sql, yulia)).message);
    assert.ok(card.message.includes('Phone RU: +79990000001'));
    assert.ok(card.message.includes('Стек: Go'));
    assert.equal(f.count(), writes);
    assert.deepEqual(notifications, []);
  } finally { await server.close(); restore(); }
});
