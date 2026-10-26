import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {InlineKeyboardMarkup} from '@grammyjs/types';
import type {Delivery,Learner} from './types.mts';
import {harness} from './test-harness.mts';
import {fixtureClient,START} from './test-fixtures.mts';
import {allowed} from './policy.mts';
import {createMentorService} from './service.mts';
import {postgresStore} from './postgres-store.mts';
import {sqlTestPool} from './sql-test-pool.mts';
import {enroll} from './schedule.mts';

const label='✅ Завершить онбординг';
const button=(markup:unknown)=>(markup as InlineKeyboardMarkup).inline_keyboard.flat().find(b=>b.text===label);

test('onboarding completion is visible to every staff actor only during onboarding and never to students',async()=>{
  for(const status of ['onboarding','studying','paused','hh_both process','on en market','graduated']){
    const h=harness([fixtureClient({status})]);
    for(const actor of ['alice','mentor','support','otherstaff']){
      await h.command('/menu',actor);
      assert.equal(!!button(h.sent.at(-1)!.replyMarkup),actor!=='alice'&&status==='onboarding',actor+': '+status);
    }
  }
});

test('staff completion requires confirmation, can be cancelled and changes only status once',async()=>{
  const h=harness([fixtureClient({status:'onboarding',market:'both'})]);
  const original=h.store.snapshot().clients['1'];
  await h.command('/menu','support');
  await h.click('onboarding','support');
  assert.equal(h.session('support').step,'confirm');
  assert.match(h.sent.at(-1)!.text,/Новый этап: Обучение: хард-скиллы/);
  assert.equal(h.store.snapshot().clients['1'].status,'onboarding');assert.deepEqual(h.store.snapshot().history,{});
  await h.click('cancel','support');
  assert.equal(h.session('support').action,'menu');assert.equal(h.store.snapshot().clients['1'].status,'onboarding');
  await h.click('onboarding','support');
  const session=h.session('support');
  const input={username:'support',userId:3,chatId:'-100',updateId:100,messageId:session.messageId,
    callback:'m:'+session.id+':'+session.revision+':confirm'};
  assert.equal((await h.service.handle(input)).code,'ok');
  assert.equal((await h.service.handle(input)).code,'duplicate');
  assert.notEqual((await h.service.handle({...input,updateId:101})).code,'ok');
  await h.flush();
  const saved=h.store.snapshot();
  assert.deepEqual(saved.clients['1'],{...original,status:'studying'});
  assert.equal(saved.learners['1'].status,'studying');assert.equal(saved.learners['1'].active,false);
  assert.equal(saved.learners['1'].hardCompletedAt,undefined);assert.deepEqual(saved.checkins,{});
  assert.deepEqual(Object.values(saved.history).map(a=>({actor:a.actor,action:a.action,before:a.before,after:a.after})),
    [{actor:'support',action:'onboarding',before:'onboarding',after:'studying'}]);
  assert.equal(button(h.sent.at(-1)!.replyMarkup),undefined);
  const notices=h.sent.filter(m=>m.text.includes(': онбординг завершён.'));
  assert.equal(notices.length,1);assert.match(notices[0].text,/Тестовый ученик @alice/);
});

test('a student cannot forge an onboarding action or confirm a staff draft',async()=>{
  const h=harness([fixtureClient({status:'onboarding'})]);
  await h.command('/menu');
  assert.equal(allowed('student','onboarding',h.store.snapshot().clients['1']),false);
  assert.equal((await h.click('onboarding')).code,'denied');
  await h.command('/menu','mentor');await h.click('onboarding','mentor');
  const session=h.session('mentor');
  assert.equal((await h.service.handle({username:'alice',userId:1,chatId:'-100',updateId:100,messageId:session.messageId,
    callback:'m:'+session.id+':'+session.revision+':confirm'})).code,'denied');
  assert.equal(h.store.snapshot().clients['1'].status,'onboarding');assert.deepEqual(h.store.snapshot().history,{});
});

test('onboarding starts hard skills despite an old completion marker; cancelling preserves it and history survives',async()=>{
  const h=harness([fixtureClient({status:'onboarding'})]),oldHardAt=START-1000;
  await h.store.transaction(s=>{
    s.learners['1'].hardCompletedAt=oldHardAt;
    s.history.oldHard={id:'oldHard',clientId:'1',actor:'mentor',at:oldHardAt,action:'hard',before:null,after:oldHardAt};
  });
  const oldAudit=h.store.snapshot().history.oldHard;
  await h.command('/menu','mentor');await h.click('onboarding','mentor');
  assert.match(h.sent.at(-1)!.text,/Новый этап: Обучение: хард-скиллы/);
  assert.equal(h.store.snapshot().learners['1'].hardCompletedAt,oldHardAt);
  await h.click('cancel','mentor');
  assert.equal(h.store.snapshot().learners['1'].hardCompletedAt,oldHardAt);
  await h.click('onboarding','mentor');await h.click('confirm','mentor');
  assert.equal(h.store.snapshot().clients['1'].status,'studying');
  assert.equal(h.store.snapshot().learners['1'].hardCompletedAt,undefined);
  assert.deepEqual(h.store.snapshot().history.oldHard,oldAudit);
  assert.ok(h.sent.some(m=>m.text.includes('онбординг завершён. Твой этап — обучение: хард-скиллы.')));
  await h.command('/what_my_stage');
  assert.match(h.sent.at(-1)!.text,/текущий этап: Обучение: хард-скиллы/);
  assert.match(h.sent.at(-1)!.text,/Вопросы по этапу — @hardmentor/);
  await h.command('/hard_done','mentor');await h.click('confirm','mentor');
  await h.command('/what_my_stage');
  assert.equal(h.store.snapshot().clients['1'].status,'studying');
  assert.match(h.sent.at(-1)!.text,/текущий этап: Обучение: софт-скиллы/);
});

test('staff cannot use onboarding completion at another status or after access or source data changes',async()=>{
  for(const status of ['studying','paused','hh_both process','on en market','graduated']){
    const h=harness([fixtureClient({status})]);
    await h.command('/menu','mentor');
    assert.equal((await h.click('onboarding','mentor')).code,'denied');
    assert.equal(h.store.snapshot().clients['1'].status,status);assert.deepEqual(h.store.snapshot().history,{});
  }
  const h=harness([fixtureClient({status:'onboarding'})]);
  await h.command('/menu','mentor');await h.click('onboarding','mentor');
  const session=h.session('mentor');
  const input={username:'mentor',userId:2,chatId:'-100',updateId:100,messageId:session.messageId,
    callback:'m:'+session.id+':'+session.revision+':confirm'};
  const denied=createMentorService({store:h.store,member:async()=>false,reportChatId:'-900',now:h.now});
  assert.equal((await denied.handle(input)).code,'denied');
  assert.equal(h.store.snapshot().clients['1'].status,'onboarding');
  await h.store.transaction(s=>{s.clients['1'].status='paused';s.sourceEvents.push({id:'external',clientId:'1',
    oldStatus:'onboarding',newStatus:'paused',at:h.now()});});
  assert.notEqual((await h.service.handle(input)).code,'ok');
  assert.equal(h.store.snapshot().clients['1'].status,'paused');assert.deepEqual(h.store.snapshot().history,{});
});

for(const failure of ['none','beforeWrite','missingStatusHistory','loseCommitReply'] as const){
  test('SQL pilot: onboarding changes one client with atomic audit and notice; failure='+failure,async()=>{
    const pilot={clientId:'1',binding:'onboarding-fixture',studentUsername:'alice',chatId:'-100',reportChatId:'-900',
      hardMentor:'@hardmentor',softMentor:'@softmentor'};
    const f=sqlTestPool({pilot,extraClients:[{id:'2',client_name:'Untouched',client_status:'paused',market_id:2}]}),
      gate={database:'mentor_bot_test',environment:'local-test' as const,pilot},store=postgresStore(f.pool,gate);
    await store.transaction(s=>{s.clients['1'].status='onboarding';enroll(s,'1',START);s.learners['1'].hardCompletedAt=START-1000;});
    const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>START,id:()=> 'onboard'});
    assert.equal((await service.handle({username:'mentor',userId:2,chatId:'-100',updateId:1,text:'/menu'})).code,'ok');
    let session=await store.transaction(s=>{s.sessions.onboard.messageId=7;return s.sessions.onboard;});
    assert.equal((await service.handle({username:'mentor',userId:2,chatId:'-100',updateId:2,messageId:7,
      callback:'m:'+session.id+':'+session.revision+':onboarding'})).code,'ok');
    session=await store.transaction(s=>s.sessions.onboard);
    const before=f.snapshot(),queryCount=f.queries.length;
    if(failure!=='none')f.fault[failure]=true;
    const input={username:'mentor',userId:2,chatId:'-100',updateId:3,messageId:7,
      callback:'m:'+session.id+':'+session.revision+':confirm'};
    const result=await service.handle(input),saved=f.snapshot();
    if(failure==='beforeWrite'||failure==='missingStatusHistory'){
      assert.equal(result.error,'saveFailed');assert.deepEqual(saved,before);
    }else{
      assert.equal(result.code,failure==='none'?'ok':'unavailable');
      if(failure==='loseCommitReply')assert.equal(result.error,'saveUncertain');
      assert.deepEqual(saved.clients,[{...before.clients[0],client_status:'studying'},before.clients[1]]);
      assert.equal((saved.tables.learners['1'] as Learner).hardCompletedAt,undefined);
      assert.equal(Object.keys(saved.tables.history).length,1);assert.equal(saved.events.length,before.events.length+1);
      assert.equal((Object.values(saved.tables.deliveries) as Delivery[]).filter(d=>d.kind==='notice').length,1);
      assert.deepEqual(f.queries.slice(queryCount).filter(q=>q.startsWith('UPDATE noco.clients')),
        ['UPDATE noco.clients SET client_status=$2 WHERE id=$1 AND NOT COALESCE(__nc_deleted,false) RETURNING id']);
      const reopened=createMentorService({store:postgresStore(f.pool,gate),member:async()=>true,reportChatId:'-900',now:()=>START});
      assert.equal((await reopened.handle(input)).code,'duplicate');
    }
  });
}
