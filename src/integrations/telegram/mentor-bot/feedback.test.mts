import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './test-harness.mts';
import { fixtureClient } from './test-fixtures.mts';
import { createMentorService } from './service.mts';
import { run, memoryLock } from './runtime.mts';
import { ERROR_TEXTS } from './error-texts.mts';
import { homeMarkup } from './messages.mts';

test('agreed error copy stays static and immutable', () => {
  assert.deepEqual(ERROR_TEXTS, {
    studentUnresolved: 'Не удалось однозначно определить ученика этого чата. Обратись к @veu_support.',
    accessDenied: 'Это действие недоступно для твоей роли.',
    accessUnavailable: 'Сейчас не удалось проверить доступ. Попробуй чуть позже.',
    studentUsernameInvalid: 'В карточке ученика не указан корректный Telegram username. Обратись к @veu_support. Изменения недоступны.',
    saveFailed: 'Не удалось сохранить изменения. Попробуй ещё раз.',
    saveUncertain: 'Не удалось проверить, сохранились ли изменения. Открой действие заново и проверь текущие данные.',
    dataChanged: 'Данные изменились. Открой действие заново и подтверди выбор.',
    screenStale: 'Этот экран устарел. Открой действие через главное меню.',
    backgroundFailed: 'Не удалось выполнить фоновую проверку. Бот продолжает обработку новых сообщений. Обратись к @veu_support.'
  });
  assert.equal(Object.isFrozen(ERROR_TEXTS), true);
});

test('missing/ambiguous chat bindings differ from a foreign student denial', async () => {
  for (const clients of [[], [fixtureClient(), fixtureClient({ id: '2', username: '@bobbb' })]]) {
    const h = harness(clients);
    const result = await h.service.handle({ updateId: 1, chatId: '-100', username: 'mentor', userId: 2, text: '/menu' });
    assert.equal(result.error, 'studentUnresolved');
    assert.deepEqual(h.store.snapshot().history, {});
  }
  const h = harness([fixtureClient(), fixtureClient({ id: '2', chatId: '-200', username: '@bobbb' })]);
  assert.equal((await h.service.handle({ updateId: 1, chatId: '-100', username: 'bobbb', userId: 2, text: '/menu' })).error, 'accessDenied');
});

test('invalid card username is reported only to reports, including when opening the menu', async () => {
  for (const username of ['', 'not a username']) {
    const h = harness([fixtureClient({ username })]);
    await h.command('/menu', 'mentor');
    await h.command('/hard_done', 'mentor');
    const reports = h.sent.filter(m => m.chatId === '-900');
    assert.ok(reports.length > 0);
    assert.ok(reports.every(m => m.text === ERROR_TEXTS.studentUsernameInvalid));
    assert.ok(h.sent.filter(m => m.chatId === '-100').every(m => !m.text.includes('username')));
    assert.deepEqual(h.store.snapshot().history, {});
    assert.equal(h.store.snapshot().learners['1'].hardCompletedAt, undefined);
  }
});

test('runtime acknowledges a button before handling and sends errors independently of storage', async () => {
  for (const callback of [false, true]) {
    const h = harness(), stop = new AbortController(), order: string[] = [];
    const broken = createMentorService({ store: { async transaction() { throw Error('SQL_SECRET'); } },
      now: h.now, member: async () => true, reportChatId: '-900' });
    await run({ store: h.store, lock: memoryLock(), signal: stop.signal, maintenance: async () => {},
      wait: async () => { stop.abort(); }, send: async input => { order.push('send'); return h.sender(input); },
      async handle(input) { order.push('handle'); return broken.handle(input); }, api: {
        async getUpdates(offset) { if(offset===2){stop.abort();return [];}return [{ update_id: 1, ...(callback ? { callback_query: {
          id: 'cb', data: 'mentor:home', from: { id: 1, username: 'alice', is_bot: false },
          message: { message_id: 1, chat: { id: -100, type: 'group' } }
        } } : { message: { message_id: 1, chat: { id: -100, type: 'group' },
          from: { id: 1, username: 'alice', is_bot: false }, text: '/menu' } }) }]; },
        async answerCallbackQuery(input) { assert.deepEqual(input, { callbackQueryId: 'cb' }); order.push('ack'); }
      } });
    assert.deepEqual(order, callback ? ['ack', 'handle', 'send'] : ['handle', 'send']);
    assert.equal(h.sent[0].text, '@alice ' + ERROR_TEXTS.accessUnavailable);
    assert.deepEqual(h.sent[0].replyMarkup, homeMarkup);
    assert.equal(h.store.snapshot().offset, 2);
  }
});

test('unknown commands and ordinary unbound chat messages do not receive binding errors', async () => {
  const h = harness([]);
  for (const text of ['hello', '/unrelated', '/menu@other_bot', '/start@other_bot']) {
    const result = await h.service.handle({ updateId: 1, chatId: '-100', username: 'mentor', userId: 2, text });
    assert.equal(result.error, undefined);
  }
});

test('runtime sends the binding error to the incoming chat when no client exists',async()=>{
  const h=harness([]),stop=new AbortController();
  await run({store:h.store,send:h.sender,lock:memoryLock(),signal:stop.signal,maintenance:async()=>{},handle:h.service.handle,
    api:{async getUpdates(offset){if(offset===2){stop.abort();return [];}return [{update_id:1,message:{
      message_id:1,chat:{id:-100,type:'group'},from:{id:1,username:'alice',is_bot:false},text:'/menu'}}];},
      async answerCallbackQuery(){}}});
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].chatId,'-100');
  assert.equal(h.sent[0].text,'@alice '+ERROR_TEXTS.studentUnresolved);
  assert.deepEqual(h.sent[0].replyMarkup,homeMarkup);
});

test('failed error delivery does not replay a handled action, and callback acknowledgement failure does not block handling',async()=>{
  const h=harness(),stop=new AbortController();let handles=0,sends=0;
  await run({store:h.store,lock:memoryLock(),signal:stop.signal,maintenance:async()=>{},
    send:async()=>{sends++;throw Error('SECRET');},async handle(){handles++;return {code:'denied',error:'accessDenied'};},
    api:{async getUpdates(offset){if(offset===2){stop.abort();return [];}return [{update_id:1,callback_query:{
      id:'cb',data:'mentor:home',from:{id:1,username:'alice',is_bot:false},message:{message_id:1,chat:{id:-100,type:'group'}}}}];},
      async answerCallbackQuery(){throw Error('expired');}}});
  assert.equal(handles,1);assert.equal(sends,1);assert.equal(h.store.snapshot().offset,2);
});

test('a temporary action failure posts one error and advances the incoming offset',async()=>{
  const h=harness(),stop=new AbortController();let handles=0;
  await run({store:h.store,send:h.sender,lock:memoryLock(),signal:stop.signal,maintenance:async()=>{},wait:async()=>{},
    async handle(){handles++;return handles<3?{code:'unavailable',error:'accessUnavailable'}:{code:'ok'};},
    api:{async getUpdates(offset){if(offset===2){stop.abort();return [];}return [{update_id:1,message:{
      message_id:1,chat:{id:-100,type:'group'},from:{id:1,username:'alice',is_bot:false},text:'/menu'}}];},
      async answerCallbackQuery(){}}});
  assert.equal(handles,1);assert.equal(h.sent.length,1);assert.equal(h.sent[0].text,'@alice '+ERROR_TEXTS.accessUnavailable);
});

test('a later uncertain save is explained for the next request after an access outage',async()=>{
  const h=harness(),stop=new AbortController();let handles=0;
  await run({store:h.store,send:h.sender,lock:memoryLock(),signal:stop.signal,maintenance:async()=>{},wait:async()=>{},
    async handle(){handles++;return handles===1?{code:'unavailable',error:'accessUnavailable'}:
      {code:'unavailable',error:'saveUncertain'};},
    api:{async getUpdates(offset){if(offset===3){stop.abort();return [];}return [{update_id:offset??1,message:{
      message_id:1,chat:{id:-100,type:'group'},from:{id:1,username:'alice',is_bot:false},text:'/menu'}}];},
      async answerCallbackQuery(){}}});
  assert.deepEqual(h.sent.map(m=>m.text),['@alice '+ERROR_TEXTS.accessUnavailable,'@alice '+ERROR_TEXTS.saveUncertain]);
});
