import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pilotStaffAllowed} from './pilot-staff-access.mts';
import {scopeTestTransport} from './test-transport.mts';
import {createMentorService} from './service.mts';
import {createMentorWorker} from './worker.mts';
import {memoryLock} from './runtime.mts';
import {harness} from './test-harness.mts';
import {fixtureClient} from './test-fixtures.mts';
import type {TestConfig} from './test-config.mts';

const config:TestConfig={token:'fixture',botUsername:'mentor_test_bot',chatUsername:'mentorqa',chatId:'-100',
  reportChatId:'-900',clientId:'1',studentUsername:'alice',adminUsername:'mentor',hardMentorUsername:'oldhard',
  softMentorUsername:'oldsoft',staffUsernames:['mentor','oldhard','oldsoft']};
const update=(id:number,actor:string,chatId=-100)=>({update_id:id,message:{message_id:id,date:1,
  chat:{id:chatId,type:'supergroup'},from:{id:3,is_bot:false,username:actor},text:'/start@mentor_test_bot'}});

test('SQL pilot staff access includes current mentors and configured staff, rejects outsiders and student conflicts',()=>{
  const client=fixtureClient({hardMentor:'@newhard',softMentor:'@newsoft'});
  for(const actor of ['mentor','oldhard','oldsoft','NEWHARD','@newsoft'])assert.equal(pilotStaffAllowed(config,client,actor),true);
  for(const actor of ['alice','stranger','','bad name','mentor_test_bot'])assert.equal(pilotStaffAllowed(config,client,actor),false);
  assert.equal(pilotStaffAllowed(config,{...client,hardMentor:'@alice'},'alice'),false);
  assert.equal(pilotStaffAllowed(config,undefined,'mentor'),false);
  assert.equal(pilotStaffAllowed(config,{...client,hardMentor:'@replacement'},'newhard'),false);
});

test('transport refreshes current mentor access between polls and never consults other chats',async()=>{
  const h=harness();let current='newhard';const checked:string[]=[];
  const scoped=scopeTestTransport({api:{async getUpdates(){return [update(1,'newhard'),update(2,'newhard'),
    update(3,'newsoft'),update(4,'stranger'),update(5,'otherchat',-200),update(6,'alice')];},async answerCallbackQuery(){}},
    member:async()=>true,send:h.sender},config,'-100',async actor=>{checked.push(actor);return actor===current;});
  const first=await scoped.api.getUpdates();
  assert.ok('message' in (first[0] as object));assert.deepEqual(first[2],{update_id:3});assert.deepEqual(first[4],{update_id:5});
  assert.deepEqual(checked,['newhard','newsoft','stranger']);
  current='newsoft';checked.length=0;
  const second=await scoped.api.getUpdates();
  assert.deepEqual(second[0],{update_id:1});assert.ok('message' in (second[2] as object));
});

test('current assignment is rechecked before an accepted mentor can confirm; membership remains required',async()=>{
  const h=harness([fixtureClient({hardMentor:'@newhard'})]);
  const staffAllowed=(client:Parameters<typeof pilotStaffAllowed>[1],actor:string)=>pilotStaffAllowed(config,client,actor);
  const service=createMentorService({store:h.store,member:async()=>true,staffAllowed,reportChatId:'-900',now:h.now,id:()=> 'newhard'});
  const actor={username:'newhard',userId:3,chatId:'-100'};
  assert.equal((await service.handle({...actor,updateId:100,text:'/start'})).code,'ok');
  await h.store.transaction(s=>{s.sessions.newhard.messageId=7;});
  let session=h.store.snapshot().sessions.newhard;
  assert.equal((await service.handle({...actor,updateId:101,messageId:7,callback:'m:newhard:'+session.revision+':hard'})).code,'ok');
  session=h.store.snapshot().sessions.newhard;
  await h.store.transaction(s=>{s.clients['1'].hardMentor='@replacement';});
  assert.equal((await service.handle({...actor,updateId:102,messageId:7,callback:'m:newhard:'+session.revision+':confirm'})).code,'denied');
  assert.deepEqual(h.store.snapshot().history,{});assert.equal(h.store.snapshot().learners['1'].hardCompletedAt,undefined);
  const absent=createMentorService({store:h.store,member:async()=>false,staffAllowed,reportChatId:'-900',now:h.now});
  assert.equal((await absent.handle({...actor,username:'replacement',updateId:103,text:'/menu'})).code,'denied');
});

test('a new mentor can launch a staff action from another menu but cannot confirm another actor draft',async()=>{
  const h=harness([fixtureClient({hardMentor:'@newhard'})]);
  await h.command('/menu','mentor');const menu=h.session('mentor');
  const service=createMentorService({store:h.store,member:async()=>true,
    staffAllowed:(c,a)=>pilotStaffAllowed(config,c,a),reportChatId:'-900',now:h.now,id:()=> 'newhard'});
  assert.equal((await service.handle({username:'newhard',userId:3,chatId:'-100',updateId:100,messageId:menu.messageId,
    callback:'m:'+menu.id+':'+menu.revision+':hard'})).code,'ok');
  assert.equal(h.store.snapshot().sessions.newhard.owner,'newhard');assert.equal(h.store.snapshot().sessions.newhard.action,'hard');
  assert.deepEqual(h.store.snapshot().sessions[menu.id],menu);
  await h.command('/hard_done','mentor');const draft=h.session('mentor');
  assert.equal((await service.handle({username:'newhard',userId:3,chatId:'-100',updateId:101,messageId:draft.messageId,
    callback:'m:'+draft.id+':'+draft.revision+':confirm'})).code,'denied');
  assert.deepEqual(h.store.snapshot().history,{});
});

test('assembled SQL-style worker processes a newly assigned mentor and keeps outsiders and other groups filtered',async()=>{
  const h=harness([fixtureClient({softMentor:'@newsoft'})]),stop=new AbortController();let polls=0;
  const staffAllowed=(c:Parameters<typeof pilotStaffAllowed>[1],a:string)=>pilotStaffAllowed(config,c,a);
  const scoped=scopeTestTransport({api:{async getUpdates(){if(polls++){stop.abort();return [];}
    return [update(100,'newsoft'),update(101,'stranger'),update(102,'newsoft',-200)];},async answerCallbackQuery(){}},
    member:async()=>true,send:h.sender},config,'-100',actor=>h.store.transaction(s=>staffAllowed(s.clients['1'],actor)));
  await createMentorWorker({...scoped,store:h.store,staffAllowed,lock:memoryLock(),reportChatId:'-900',
    botUsername:config.botUsername,now:h.now,log(){}}).start(stop.signal);
  const saved=h.store.snapshot();
  assert.deepEqual(Object.values(saved.sessions).map(s=>s.owner),['newsoft']);assert.equal(saved.offset,103);
  assert.ok(h.sent.length>0);assert.ok(h.sent.every(m=>m.chatId==='-100'));
});

test('a failed assignment lookup cannot consume a new mentor update',async()=>{
  const h=harness();
  const scoped=scopeTestTransport({api:{async getUpdates(){return [update(1,'newhard')];},async answerCallbackQuery(){}},
    member:async()=>true,send:h.sender},config,'-100',async()=>{throw Error('database_unavailable');});
  await assert.rejects(scoped.api.getUpdates(),/database_unavailable/);
  assert.equal(h.store.snapshot().offset,0);assert.deepEqual(h.store.snapshot().history,{});
});
