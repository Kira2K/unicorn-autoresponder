import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './test-harness.mts';
import {prepareGroupWelcome} from './group-welcome.mts';
import {createMentorWorker} from './worker.mts';
import {memoryLock,run} from './runtime.mts';
import type {Store} from './types.mts';
import {readTestConfig} from './test-config.mts';
import {scopeTestTransport} from './test-transport.mts';

const approved = 'Привет! Я ментор-бот VEU 👋\n\n' +
  'Помогу следить за обучением и поиском работы:\n\n' +
  '📍 Посмотреть текущий этап и следующий шаг.\n' +
  '🎤 Отметить готовность к самопрезентации.\n' +
  '📋 Пройти еженедельный чекин.\n\n' +
  'Менторы могут отмечать завершение хард-подготовки, выход на рынок и запуск откликов.\n\n' +
  'Для начала открой главное меню → /menu@veumentorbot';
const join = (id:number,oldStatus='left',status='member',chatId=-100,bot='veumentorbot') => ({
  update_id:id,my_chat_member:{chat:{id:chatId,type:'supergroup'},
    from:{id:77,is_bot:false,username:'notlisted'},date:1,
    old_chat_member:{status:oldStatus,user:{id:42,is_bot:true,username:bot}},
    new_chat_member:{status,user:{id:42,is_bot:true,username:bot}}}
});

test('joining queues the exact approved welcome once; rejoining welcomes again without resetting progress',async()=>{
  const h=harness(),before=h.store.snapshot();
  for(const update of [join(1),join(1),join(2,'member','administrator'),join(3,'administrator','left'),
    join(4,'left','administrator')])
    await prepareGroupWelcome(h.store,update,'veumentorbot',h.now());
  const saved=h.store.snapshot();
  assert.deepEqual(saved.clients,before.clients);
  assert.deepEqual(saved.learners,before.learners);
  assert.deepEqual(saved.history,{});
  assert.equal(Object.keys(saved.deliveries).length,2);
  assert.equal(h.sent.length,0);
  await h.flush();
  // Group rate limiting is injected in the real worker, not this direct delivery harness.
  assert.deepEqual(h.sent.map(m=>({text:m.text,chatId:m.chatId})),
    [{text:approved,chatId:'-100'},{text:approved,chatId:'-100'}]);
  await prepareGroupWelcome(h.store,join(4,'left','administrator'),'veumentorbot',h.now());
  await h.flush();assert.equal(h.sent.length,2);
});

test('foreign bots, unlinked groups, private chats and malformed updates cannot queue a welcome',async()=>{
  const h=harness();
  const privateJoin=join(3);privateJoin.my_chat_member.chat.type='private';
  const human=join(4);human.my_chat_member.new_chat_member.user.is_bot=false;
  const wrongId=join(5);wrongId.my_chat_member.old_chat_member.user.id=99;
  for(const update of [null,{},join(1,'left','member',-200),join(2,'left','member',-100,'otherbot'),
    privateJoin,human,wrongId,join(-1),join(6,'member','member')])
    await prepareGroupWelcome(h.store,update,'veumentorbot',h.now());
  assert.deepEqual(h.store.snapshot().deliveries,{});
  assert.deepEqual(h.store.snapshot().operations,{});
});

test('pilot polling accepts its bot joining from an unlisted adder, ignores promotion and another group',async()=>{
  const config=readTestConfig({MENTOR_BOT_API_KEY:'synthetic',MENTOR_BOT_USERNAME:'veumentorbot',
    MENTOR_BOT_TEST_CHAT_USERNAME:'mentorbotqa',MENTOR_BOT_TEST_CLIENT_ID:'1',MENTOR_BOT_REPORT_CHAT_ID:'-900',
    MENTOR_BOT_TEST_STUDENT_USERNAME:'alice',MENTOR_BOT_TEST_ADMIN_USERNAME:'mentor'});
  const h=harness(),stop=new AbortController();let polls=0;
  const allowed:string[][]=[];
  const scoped=scopeTestTransport({send:h.sender,member:async()=>{throw Error('no actor lookup for joining');},
    api:{async getUpdates(_offset,_timeout,updates){
      allowed.push(updates??[]);
      if(polls++){stop.abort();return [];}
      return [join(1),join(2,'member','administrator'),join(3,'left','member',-200),join(4)];
    },async answerCallbackQuery(){throw Error('no callback');}}},config,'-100');
  await createMentorWorker({...scoped,store:h.store,lock:memoryLock(),botUsername:'veumentorbot',
    reportChatId:'-900',now:h.now,log(){}}).start(stop.signal);
  assert.ok(allowed.every(types=>types.includes('my_chat_member')));
  // Duplicate addition updates for the same membership transition are separate Telegram events;
  // this scenario supplies one real addition and one subsequent re-addition.
  assert.ok(h.sent.some(m=>m.text===approved&&m.chatId==='-100'));
  assert.equal(h.store.snapshot().offset,5);
  assert.equal(Object.keys(h.store.snapshot().sessions).length,0);
  assert.equal(Object.keys(h.store.snapshot().deliveries).length,2);
});

test('a rolled-back welcome is retried before advancing the cursor and is delivered once',async()=>{
  const h=harness(),stop=new AbortController(),offsets:(number|undefined)[]=[];
  let fail=true;
  const store:Store={transaction:operation=>h.store.transaction(s=>{
    const result=operation(s);
    if(fail&&s.operations['welcome:update:1']){fail=false;throw Error('save_failed');}
    return result;
  })};
  await run({store,send:h.sender,lock:memoryLock(),signal:stop.signal,wait:async()=>{},
    handle:async()=>{throw Error('membership event is not an actor command');},
    handleGroupUpdate:update=>prepareGroupWelcome(store,update,'veumentorbot',h.now()),
    maintenance:async()=>{await h.flush();},
    api:{async getUpdates(offset){
      offsets.push(offset);
      if(offset===2){stop.abort();return [];}
      return [join(1)];
    },async answerCallbackQuery(){throw Error('no callback');}}});
  assert.deepEqual(offsets,[undefined,undefined,2]);
  assert.equal(h.store.snapshot().offset,2);
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].text,approved);
});
