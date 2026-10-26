import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InlineKeyboardMarkup } from '@grammyjs/types';
import { harness } from './test-harness.mts';
import { fixtureClient } from './test-fixtures.mts';
import { renderDelivery, type MessageTemplate } from './message-templates.mts';
import { deliver } from './delivery.mts';

const HH_LINK = '<a href="https://melodic-firewall-a6d.notion.site/hh-ru">Вот ссылка на инструкцию по созданию hh</a> (это безопасная ссылка, несмотря на предупреждение от Notion)';

test('preparation stages link the hh instruction immediately after the current task and escape card text', async () => {
  for (const status of ['hh_ru process', 'hh_en process', 'hh_both process']) {
    const h = harness([fixtureClient({ status, name: 'Ученик <тест> & имя' })]);
    await h.command('/what_my_stage');
    const message = h.sent.at(-1)!;
    assert.equal(message.parseMode, 'HTML');
    const currentTask = status === 'hh_en process'
      ? 'Создай второй профиль hh.ru с иностранными номером и почтой и внеси доступы в личный кабинет.'
      : 'Создай профиль hh.ru по инструкции и внеси доступы в личный кабинет.';
    assert.ok(message.text.includes('Сейчас: ' + currentTask + '\n' + HH_LINK + '\n\nСледующий этап:'));
    assert.match(message.text, /Ученик &lt;тест&gt; &amp; имя @alice/);
    assert.match(message.text, /@alice/);
  }
  const h = harness();
  await h.command('/what_my_stage');
  assert.ok(!h.sent.at(-1)!.text.includes('notion.site'));
});

test('every student-facing template includes the current student tag', () => {
  const h = harness(), state = h.store.snapshot();
  state.clients['1'].username = '@renamed';
  const templates: MessageTemplate[] = [
    { type: 'onboarding-notice' }, { type: 'hard-instruction' }, { type: 'ready-notice' },
    { type: 'ready-revoked', actor: 'mentor' }, { type: 'mentor-notice', mentorType: 'soft' },
    { type: 'market-notice', status: 'hh_ru process' }, { type: 'responses-notice', market: 'РУ' },
    { type: 'checkin-reminder', start: h.now(), end: h.now() }, { type: 'pitch-reminder' },
    { type: 'sync-error' }, { type: 'responses-unavailable' }, { type: 'checkin-excluded', status: 'paused' },
    { type: 'notice', text: 'Следующий чекин будет доступен в четверг в 17:00 МСК.' }
  ];
  for (const template of templates) {
    const message = renderDelivery(state, { id: 'test', clientId: '1', kind: 'notice', template,
      input: { chatId: '-100', text: '' }, state: 'pending', attempts: 0, retryAt: h.now() });
    assert.ok(message.text.includes(state.clients['1'].name + ' @renamed'), template.type);
    assert.equal(message.text.match(/@renamed\b/g)?.length, 1, template.type);
    assert.doesNotMatch(message.text, /@alice\b/);
  }
});

test('student screens and business feedback keep the tag throughout both confirmation flows', async () => {
  const h = harness([fixtureClient({ status: 'on ru market' })]);
  h.setNow(Date.parse('2026-10-22T14:00:00Z'));
  await h.command('/ready_pitch'); await h.click('yes'); await h.click('confirm');
  await h.click('edit'); await h.click('no'); await h.click('confirm');
  await h.command('/menu'); await h.click('stage');
  await h.command('/menu'); await h.click('checkin'); await h.click('yes');
  await h.click('confirm'); await h.click('no'); await h.click('confirm'); await h.click('edit');
  await h.command('/hard_done');
  assert.ok(h.sent.filter(m => m.chatId === '-100').every(m => m.text.includes('Тестовый ученик @alice')));
});

test('market stages omit the removed offer step and retain their tasks and mentor contacts', async () => {
  for (const actor of ['alice', 'mentor']) {
    const h = harness([fixtureClient({ status: 'on en market', market: 'en' })]);
    await h.command('/what_my_stage', actor);
    const message = h.sent.at(-1)!;
    assert.ok(message.text.includes('Тестовый ученик @alice'));
    assert.match(message.text, /текущий этап: Отклики на ВУ рынке/);
    assert.match(message.text, /Следи за приглашениями, отвечай рекрутерам, ходи на собеседования/);
    assert.doesNotMatch(message.text, /оффер|выпуск|Следующий этап:/i);
    assert.doesNotMatch(message.text, /Для перехода:/);
    assert.match(message.text, /Вопросы по этапу — @softmentor/);
    assert.match(message.text, /Организационные вопросы — @veu_support/);
  }
  const h = harness([fixtureClient({ status: 'on ru market', market: 'ru' })]);
  await h.command('/what_my_stage');
  assert.doesNotMatch(h.sent.at(-1)!.text, /оффер|выпуск|Следующий этап:/i);
  const both=harness([fixtureClient({status:'on ru market',market:'both'})]);
  await both.command('/what_my_stage');
  assert.match(both.sent.at(-1)!.text,/Следующий этап: Выход на ВУ рынок/);
});

test('a name matching ordinary message words only receives a tag in the explicit student label', async () => {
  const h = harness([fixtureClient({ name: 'этап' })]);
  await h.command('/what_my_stage');
  const message = h.sent.at(-1)!;
  assert.match(message.text, /📍 этап @alice, текущий этап:/);
  assert.match(message.text, /Следующий этап:/);
  assert.equal(message.text.match(/@alice\b/g)?.length, 1);
});

test('retry renders a changed student tag once without changing historical report facts', async () => {
  const h = harness();
  await h.command('/hard_done', 'mentor');
  const s = h.session('mentor');
  await h.service.handle({ updateId: 900, username: 'mentor', userId: 2, chatId: '-100',
    messageId: s.messageId, callback: `m:${s.id}:${s.revision}:confirm` });
  await deliver({ store: h.store, now: h.now, send: async () => ({ kind: 'telegram-response',
    response: { ok: false, error_code: 429, description: 'slow', parameters: { retry_after: 2 } } }) });
  await h.store.transaction(state => { state.clients['1'].username = '@renamed'; });
  h.setNow(h.now() + 2000); await h.flush();
  const instruction = h.sent.find(m => m.text.includes('с хардами'))!;
  assert.equal(instruction.text.match(/@renamed\b/g)?.length, 1);
  assert.doesNotMatch(instruction.text, /@alice\b/);
});

test('student entry buttons on staff menus and confirmation screens open an independent student dialogue', async () => {
  for (const command of ['/menu', '/hard_done', '/ready_pitch', '/market_en', '/change_mentor']) {
    for (const action of ['stage', 'ready', 'checkin']) {
      const h = harness([fixtureClient({ status: 'on ru market' })]);
      h.setNow(Date.parse('2026-10-22T14:00:00Z'));
      await h.command(command, 'mentor');
      const staff = h.session('mentor');
      const message = h.sent.at(-1)!;
      const button = (message.replyMarkup as InlineKeyboardMarkup).inline_keyboard.flat()
        .find(b => 'callback_data' in b && (b.callback_data === 'mentor:' + action || b.callback_data.endsWith(':' + action)));
      assert.ok(button && 'callback_data' in button, `${command}: ${action}`);
      const input = { updateId: 900, username: 'alice', userId: 1, chatId: '-100',
        messageId: staff.messageId, callback: button.callback_data };
      assert.equal((await h.service.handle(input)).code, 'ok', `${command}: ${action}`);
      assert.equal((await h.service.handle(input)).code, 'duplicate');
      await h.flush();
      assert.equal(h.session().action, action);
      assert.equal(h.session().owner, 'alice');
      assert.notEqual(h.session().messageId, staff.messageId);
      assert.deepEqual(h.session('mentor'), staff);
      assert.deepEqual(h.store.snapshot().history, {});
      if (action === 'ready') {
        await h.click('yes'); await h.click('confirm');
        assert.equal(h.store.snapshot().learners['1'].readyActor, 'alice');
      }
    }
  }
});

test('legacy staff menu entry buttons work for the student without exposing staff actions or confirmations', async () => {
  const h = harness();
  await h.command('/menu', 'mentor');
  const menu = h.session('mentor');
  assert.equal((await h.service.handle({ updateId: 900, username: 'alice', userId: 1, chatId: '-100',
    messageId: menu.messageId, callback: `m:${menu.id}:${menu.revision}:ready` })).code, 'ok');
  await h.flush();
  assert.equal(h.session().action, 'ready');
  assert.equal((await h.service.handle({ updateId: 901, username: 'alice', userId: 1, chatId: '-100',
    messageId: menu.messageId, callback: `m:${menu.id}:${menu.revision}:hard` })).code, 'denied');
  await h.command('/hard_done', 'mentor');
  const confirmation = h.session('mentor');
  assert.equal((await h.service.handle({ updateId: 902, username: 'alice', userId: 1, chatId: '-100',
    messageId: confirmation.messageId, callback: `m:${confirmation.id}:${confirmation.revision}:confirm` })).code, 'denied');
  assert.deepEqual(h.store.snapshot().history, {});
});
