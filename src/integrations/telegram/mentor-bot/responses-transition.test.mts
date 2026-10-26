import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {InlineKeyboardMarkup} from '@grammyjs/types';
import {harness} from './test-harness.mts';
import {fixtureClient,START} from './test-fixtures.mts';
import {stage} from './stage.mts';
import {postgresStore} from './postgres-store.mts';
import {sqlTestPool} from './sql-test-pool.mts';
import {enroll} from './schedule.mts';
import {createMentorService} from './service.mts';

const labels=(markup:unknown)=>(markup as InlineKeyboardMarkup).inline_keyboard.flat().map(b=>b.text);

test('RU+EN keeps the existing buttons, draft and confirmation before entering EN with both markets',async()=>{
  const h=harness();
  await h.command('/menu','mentor');
  const menuLabels=labels(h.sent.at(-1)!.replyMarkup);
  assert.deepEqual(menuLabels,['📍 Мой этап','🎤 Готовность к самопрезентации','📋 Еженедельный чекин',
    '✅ Завершить харды','🚀 Выход на рынок','📨 Подтвердить запуск откликов','👤 Выбор ментора','🏠 Главное меню']);
  await h.click('market','mentor');await h.click('both','mentor');
  assert.equal(h.store.snapshot().clients['1'].status,'studying');assert.deepEqual(h.store.snapshot().history,{});
  await h.click('confirm','mentor');
  const prepared=h.store.snapshot();
  assert.equal(prepared.clients['1'].status,'hh_both process');assert.equal(prepared.clients['1'].market,'both');
  assert.deepEqual(labels(h.sent.at(-1)!.replyMarkup),menuLabels);
  assert.match(stage(prepared.clients['1'],prepared.learners['1']).text,/Следующий этап: Отклики на ВУ рынке/);
  await h.click('responses','mentor');
  assert.equal(h.store.snapshot().clients['1'].status,'hh_both process');
  assert.match(h.sent.at(-1)!.text,/Новый этап: Отклики на ВУ рынке/);
  assert.equal(h.sent.at(-1)!.text.includes('отклики на РУ рынке'),false);
  await h.click('cancel','mentor');
  assert.equal(h.store.snapshot().clients['1'].status,'hh_both process');
  await h.click('responses','mentor');
  const session=h.session('mentor');
  const input={username:'mentor',userId:2,chatId:'-100',updateId:100,messageId:session.messageId,
    callback:'m:'+session.id+':'+session.revision+':confirm'};
  assert.equal((await h.service.handle(input)).code,'ok');
  assert.equal((await h.service.handle(input)).code,'duplicate');
  await h.flush();
  const saved=h.store.snapshot();
  assert.equal(saved.clients['1'].status,'on en market');assert.equal(saved.clients['1'].market,'both');
  for(const key of ['active','activatedAt','nextOpenAt'] as const)
    assert.equal(saved.learners['1'][key],prepared.learners['1'][key]);
  assert.deepEqual(Object.values(saved.history).filter(a=>a.action==='responses').map(a=>({before:a.before,after:a.after})),
    [{before:{status:'hh_both process',market:'both'},after:{status:'on en market',market:'both'}}]);
  const reports=h.sent.filter(m=>m.chatId==='-900'&&m.text.includes('отклики на'));
  assert.equal(reports.length,1);assert.match(reports[0].text,/отклики на ВУ рынке запущены/);
  assert.ok(h.sent.some(m=>m.chatId==='-100'&&m.text.includes('мы начали откликать тебя на ВУ рынке')));
});

test('existing response commands keep RU and EN single-market transitions',async()=>{
  for(const [market,status,next,label] of [
    ['ru','hh_ru process','on ru market','РУ'],['en','hh_en process','on en market','ВУ']
  ] as const){
    const h=harness([fixtureClient({status,market})]);
    await h.command('/responses_started','mentor');
    assert.match(h.sent.at(-1)!.text,new RegExp('Новый этап: Отклики на '+label+' рынке'));
    assert.equal(h.store.snapshot().clients['1'].status,status);
    await h.click('confirm','mentor');
    assert.equal(h.store.snapshot().clients['1'].status,next);assert.equal(h.store.snapshot().clients['1'].market,market);
  }
});

for(const failure of ['none','beforeWrite','loseCommitReply'] as const){
  test('SQL protocol: existing RU+EN confirmation commits EN, audit and notices once; failure='+failure,async()=>{
    const f=sqlTestPool(),gate={database:'mentor_bot_test',environment:'local-test' as const};
    const store=postgresStore(f.pool,gate);
    await store.transaction(s=>{s.clients['1'].status='hh_both process';s.clients['1'].market='both';enroll(s,'1',START);});
    const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>START,id:()=> 'responses'});
    assert.equal((await service.handle({username:'mentor',userId:2,chatId:'-100',updateId:1,text:'/responses_started'})).code,'ok');
    const session=await store.transaction(s=>{const session=s.sessions.responses;session.messageId=7;return session;});
    const before=f.snapshot();
    if(failure!=='none')f.fault[failure]=true;
    const input={username:'mentor',userId:2,chatId:'-100',updateId:2,messageId:7,
      callback:'m:'+session.id+':'+session.revision+':confirm'};
    const result=await service.handle(input),saved=f.snapshot();
    if(failure==='beforeWrite'){
      assert.equal(result.error,'saveFailed');assert.deepEqual(saved,before);
    }else{
      assert.equal(result.code,failure==='none'?'ok':'unavailable');
      if(failure==='loseCommitReply')assert.equal(result.error,'saveUncertain');
      assert.equal(saved.clients[0].client_status,'on en market');assert.equal(saved.clients[0].market_id,3);
      assert.equal(Object.keys(saved.tables.history).length,1);assert.equal(saved.events.length,before.events.length+1);
      const reopened=createMentorService({store:postgresStore(f.pool,gate),member:async()=>true,reportChatId:'-900',now:()=>START});
      assert.equal((await reopened.handle(input)).code,'duplicate');
    }
  });
}
