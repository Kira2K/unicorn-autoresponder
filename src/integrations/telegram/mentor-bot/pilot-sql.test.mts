import {test} from 'node:test';
import assert from 'node:assert/strict';
import {postgresStore} from './postgres-store.mts';
import {sqlTestPool} from './sql-test-pool.mts';
import {assertPilotState,pilotSchema} from './pilot-scope.mts';
import type {PilotScope} from './pilot-scope.mts';
import {emptyState} from './types.mts';
import {enroll} from './schedule.mts';
import {fixtureClient,START} from './test-fixtures.mts';
import {createMentorService} from './service.mts';

const pilot:PilotScope={clientId:'1',binding:'test-binding',studentUsername:'teststudent',chatId:'-100',reportChatId:'-900',
  hardMentor:'@testhard',softMentor:'@testsoft'};
const gate={database:'mentor_bot_test',environment:'local-test' as const,pilot};
const fixture=()=>sqlTestPool({pilot,extraClients:[{id:'2',client_name:'Untouched',client_status:'studying',
  telegram_general_chat_id:'-200',telegram_personal_chat_id:'@someone',market_id:2}]});

test('pilot namespace rejects arbitrary SQL identifiers and state cannot escape its client or chat',()=>{
  assert.equal(pilotSchema(pilot),'mentor_bot_pilot_1');
  assert.throws(()=>pilotSchema({...pilot,clientId:'1;DROP SCHEMA noco'}));
  const s=emptyState([fixtureClient({username:'@teststudent'})]);
  assertPilotState(s,pilot);
  s.clients['2']=fixtureClient({id:'2'});assert.throws(()=>assertPilotState(s,pilot),/client_scope/);
  delete s.clients['2'];s.clients['1'].chatId='-200';assert.throws(()=>assertPilotState(s,pilot),/binding/);
  assert.throws(()=>assertPilotState(s,{...pilot,useTestChat:true}),/binding/);
  s.clients['1'].chatId='-100';
  s.deliveries.bad={id:'bad',kind:'feedback',input:{chatId:'-200',text:'deny'},state:'pending',attempts:0,retryAt:0};
  assert.throws(()=>assertPilotState(s,pilot),/destination/);
});

test('pilot mentor edits persist in canonical SQL columns and read back after reopening',async()=>{
  const f=fixture(),store=postgresStore(f.pool,gate);
  await store.transaction(s=>{assert.equal(s.clients['1'].softMentor,'@softmentor');s.clients['1'].softMentor='@replacement';});
  assert.equal(await postgresStore(f.pool,gate).transaction(s=>s.clients['1'].softMentor),'@replacement');
  assert.equal(f.snapshot().clients[0].tg_soft_mentor,'@replacement');
  assert.equal(f.snapshot().clients[0].tg_hard_mentor,'@hardmentor');
  assert.equal(f.queries.some(q=>q.includes('SET mentor_overrides=')),false);
});

test('SQL pilot reads, locks and updates only its selected client and uses an isolated namespace',async()=>{
  const f=fixture(),store=postgresStore(f.pool,gate);
  await store.transaction(s=>{
    assert.deepEqual(Object.keys(s.clients),['1']);
    assert.equal(s.clients['1'].username,'@teststudent');
    enroll(s,'1',START);
    s.clients['1'].status='hh_en process';s.clients['1'].market='both';
  });
  const saved=f.snapshot();
  assert.equal(saved.clients[0].client_status,'hh_en process');assert.equal(saved.clients[0].market_id,3);
  assert.equal(saved.clients[0].telegram_personal_chat_id,'@alice');
  assert.equal(saved.clients[1].client_status,'studying');assert.equal(saved.clients[1].market_id,2);
  assert.ok(f.queries.some(q=>q.includes('mentor_bot_pilot_1.learners')));
  assert.equal(f.queries.some(q=>q.includes('mentor_bot.')),false);
  assert.ok(f.queries.filter(q=>q.startsWith('SELECT c.id')).every(q=>q.includes('AND c.id=$1')));
  await assert.rejects(store.transaction(s=>{s.clients['2']=fixtureClient({id:'2'});}),/mentor_transaction_failed/);
  assert.equal(f.snapshot().clients[1].client_status,'studying');
});

test('SQL pilot binding mismatch or a foreign loaded learner aborts before mutations',async()=>{
  const f=fixture();
  await assert.rejects(postgresStore(f.pool,{...gate,pilot:{...pilot,binding:'changed'}}).transaction(()=>{}));
  const store=postgresStore(f.pool,gate);
  await assert.rejects(store.transaction(s=>{s.learners['2']={clientId:'2',enabledAt:0,status:'studying',
    version:0,active:false,recruiterMisses:0,interviewMisses:0};}));
  assert.deepEqual(f.snapshot().tables.learners,{});
});

test('SQL pilot status transition commits atomically and reconciles an unknown COMMIT without replay',async()=>{
  const f=fixture(),store=postgresStore(f.pool,gate);
  await store.transaction(s=>enroll(s,'1',START));
  const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>START,id:()=> 'session'});
  await service.handle({username:'mentor',userId:2,chatId:'-100',updateId:1,text:'/market_ru'});
  await store.transaction(s=>{s.sessions.session.messageId=7;});
  const revision=await store.transaction(s=>s.sessions.session.revision);
  f.fault.loseCommitReply=true;
  const input={username:'mentor',userId:2,chatId:'-100',updateId:2,messageId:7,callback:'m:session:'+revision+':confirm'};
  const uncertain=await service.handle(input);
  assert.equal(uncertain.code,'unavailable');assert.equal(uncertain.error,'saveUncertain');
  assert.equal(f.snapshot().clients[0].client_status,'hh_ru process');
  assert.equal((await service.handle(input)).code,'duplicate');
  assert.equal(Object.keys(f.snapshot().tables.history).length,1);
  assert.equal(f.snapshot().events.length,1);
  f.fault.beforeCommit=true;
  await assert.rejects(store.transaction(s=>{s.clients['1'].status='graduated';s.clients['1'].market='both';}));
  assert.equal(f.snapshot().clients[0].client_status,'hh_ru process');assert.equal(f.snapshot().clients[0].market_id,1);
});

test('SQL pilot rolls a status write back if its transactional history entry is missing',async()=>{
  const f=fixture(),store=postgresStore(f.pool,gate);
  f.fault.missingStatusHistory=true;
  await assert.rejects(store.transaction(s=>{s.clients['1'].status='hh_ru process';s.clients['1'].market='both';}));
  assert.equal(f.snapshot().clients[0].client_status,'studying');assert.equal(f.snapshot().clients[0].market_id,1);
  assert.equal(f.snapshot().events.length,0);
});
