import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {InlineKeyboardMarkup} from '@grammyjs/types';
import type {Session} from './types.mts';
import {harness} from './test-harness.mts';
import {fixtureClient,START} from './test-fixtures.mts';
import {allowed,clientVersion,EXCLUDED} from './policy.mts';
import {enqueue} from './messages.mts';
import {WELCOME_MESSAGE} from './welcome-message.mts';
import {postgresStore} from './postgres-store.mts';
import {sqlTestPool} from './sql-test-pool.mts';
import {enroll} from './schedule.mts';
import {createMentorService} from './service.mts';

test('menus and staff screens never expose the retired offer action for either role',async()=>{
  for(const status of ['onboarding','studying','hh_both process','on ru market','on en market','graduated']){
    const h=harness([fixtureClient({status})]);
    for(const actor of ['alice','mentor']){
      await h.command('/start',actor);
      const buttons=(h.sent.at(-1)!.replyMarkup as InlineKeyboardMarkup).inline_keyboard.flat();
      assert.ok(buttons.every(b=>!('callback_data' in b&&b.callback_data.endsWith(':offer'))&&!/оффер/i.test(b.text)));
      assert.equal(allowed(actor==='alice'?'student':'staff','offer',h.store.snapshot().clients['1']),false);
    }
    await h.command('/change_mentor','mentor');
    assert.doesNotMatch(h.sent.at(-1)!.text,/оффер|выпуск/i);
  }
  assert.doesNotMatch(WELCOME_MESSAGE,/оффер|выпуск/i);
});

test('old shared, menu and confirmation callbacks cannot graduate a student or alter saved progress',async()=>{
  for(const actor of ['alice','mentor']){
    const h=harness([fixtureClient({status:'on en market',market:'both'})]);
    await h.command('/menu',actor);const menu=h.session(actor);
    const before=h.store.snapshot();
    for(const [index,callback] of ['mentor:offer','m:'+menu.id+':'+menu.revision+':offer'].entries())
      assert.notEqual((await h.service.handle({username:actor,userId:2,chatId:'-100',updateId:100+index,messageId:menu.messageId,callback})).code,'ok');
    await h.store.transaction(s=>{s.sessions.legacy={id:'legacy',clientId:'1',chatId:'-100',owner:actor,
      role:actor==='alice'?'student':'staff',action:'offer',step:'confirm',revision:1,messageId:7,
      expectedVersion:s.learners['1'].version,expectedClient:clientVersion(s.clients['1']),createdAt:START} as unknown as Session;});
    assert.notEqual((await h.service.handle({username:actor,userId:2,chatId:'-100',updateId:102,messageId:7,
      callback:'m:legacy:1:confirm'})).code,'ok');
    const saved=h.store.snapshot();
    for(const key of ['clients','learners','checkins','history'] as const)assert.deepEqual(saved[key],before[key]);
    await h.flush();assert.ok(h.sent.every(m=>!m.text.includes('Поздравляем с принятым оффером!')));
  }
});

test('pending legacy congratulations and removed-action screens are cancelled while other notices are delivered',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);
  await h.store.transaction(s=>{
    s.sessions.legacy={id:'legacy',clientId:'1',chatId:'-100',owner:'mentor',role:'staff',action:'offer',
      step:'confirm',revision:1,expectedVersion:0,expectedClient:clientVersion(s.clients['1']),createdAt:START} as unknown as Session;
    enqueue(s,{id:'legacy-template',clientId:'1',kind:'notice',template:{type:'notice',text:'Поздравляем с принятым оффером! Твой этап — выпуск.'},
      input:{chatId:'-100',text:''}},h.now());
    enqueue(s,{id:'legacy-literal',clientId:'1',kind:'notice',input:{chatId:'-100',text:'Тестовый ученик, Поздравляем с принятым оффером!'}},h.now());
    enqueue(s,{id:'legacy-screen',clientId:'1',kind:'screen',sessionId:'legacy',sessionRevision:1,template:{type:'screen'},
      input:{chatId:'-100',text:''}},h.now());
    enqueue(s,{id:'current',clientId:'1',kind:'notice',input:{chatId:'-100',text:'Актуальное сообщение.'}},h.now());
  });
  await h.flush();
  assert.deepEqual(h.sent.map(m=>m.text),['Актуальное сообщение.']);
  for(const id of ['legacy-template','legacy-literal','legacy-screen'])assert.equal(h.store.snapshot().deliveries[id].state,'cancelled');
});

test('SQL rejects retired callbacks without client writes and preserves historical graduation records',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  await store.transaction(s=>{
    s.clients['1'].status='on en market';enroll(s,'1',START);
    s.history.historical={id:'historical',clientId:'1',actor:'alice',at:START-1000,action:'offer',before:'on ru market',after:'graduated'};
    s.sessions.legacy={id:'legacy',clientId:'1',chatId:'-100',owner:'mentor',role:'staff',action:'offer',step:'confirm',
      revision:1,messageId:7,expectedVersion:s.learners['1'].version,expectedClient:clientVersion(s.clients['1']),createdAt:START} as unknown as Session;
  });
  const before=f.snapshot(),queryCount=f.queries.length;
  const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>START});
  for(const [index,callback] of ['mentor:offer','m:legacy:1:confirm'].entries())
    assert.notEqual((await service.handle({username:'mentor',userId:2,chatId:'-100',updateId:index+1,messageId:7,callback})).code,'ok');
  const saved=f.snapshot();
  assert.deepEqual(saved.clients,before.clients);assert.deepEqual(saved.tables.history,before.tables.history);
  assert.equal(f.queries.slice(queryCount).some(q=>q.startsWith('UPDATE noco.clients')),false);
  assert.equal(EXCLUDED.has('graduated'),true);
});
