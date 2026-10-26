import {test} from 'node:test';
import assert from 'node:assert/strict';
import {postgresStore} from './postgres-store.mts';
import {sqlTestPool} from './sql-test-pool.mts';
import {memoryStore} from './memory-store.mts';
import {emptyState} from './types.mts';
import type {Store} from './types.mts';
import {fixtureClient,START} from './test-fixtures.mts';
import {enroll} from './schedule.mts';
import {createMentorService} from './service.mts';
import {deliver} from './delivery.mts';
import {enqueue} from './messages.mts';
for(const kind of ['memory','sql-protocol'] as const){
  test(kind+': store contract atomically commits business data, audit and delivery; abort keeps all old values',async()=>{
    const fake=sqlTestPool();
    const store:Store=kind==='memory'?memoryStore(emptyState([fixtureClient()])):
      postgresStore(fake.pool,{database:'mentor_bot_test',environment:'local-test'});
    await store.transaction(s=>enroll(s,'1',START));
    await assert.rejects(store.transaction(s=>{
      s.learners['1'].ready=true;s.clients['1'].softMentor='@changed';s.operations.partial={at:START};
      throw Error('abort');
    }));
    assert.equal(await store.transaction(s=>s.learners['1'].ready),undefined);
    assert.equal(await store.transaction(s=>s.clients['1'].softMentor),'@softmentor');
    assert.equal(await store.transaction(s=>s.operations.partial),undefined);
    await store.transaction(s=>{s.learners['1'].ready=true;s.operations.whole={at:START};
      s.history.whole={id:'whole',clientId:'1',actor:'mentor',at:START,action:'ready',before:null,after:true};});
    assert.equal(await store.transaction(s=>s.learners['1'].ready),true);
    assert.equal(await store.transaction(s=>Object.keys(s.history).length),1);
    await assert.rejects(store.transaction(s=>{s.history.whole.actor='otherstaff';}));
    await assert.rejects(store.transaction(s=>{delete s.history.whole;}));
    assert.equal(await store.transaction(s=>s.history.whole.actor),'mentor');
    await assert.rejects(store.transaction(s=>{
      s.checkins.partial={id:'partial',clientId:'1',start:0,end:1,closesAt:2,state:'open',version:0,
        result:{recruiters:true} as never};
    }));
    assert.equal(await store.transaction(s=>s.checkins.partial),undefined);
  });
}
test('SQL protocol: lost COMMIT reply is reconciled by update id after reopening the adapter',async()=>{
  const f=sqlTestPool(),gate={database:'mentor_bot_test',environment:'local-test' as const};
  let store=postgresStore(f.pool,gate);
  await store.transaction(s=>enroll(s,'1',START));
  const service=()=>createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>START,id:()=> 'session'});
  await service().handle({username:'mentor',userId:2,chatId:'-100',updateId:1,text:'/hard_done'});
  await deliver({store,now:()=>START,send:async input=>({kind:'telegram-response',response:{ok:true,result:{
    message_id:7,date:1,chat:{id:-100,type:'group',title:'Synthetic group'},text:input.text}}})});
  const session=await store.transaction(s=>s.sessions.session);
  const confirm={username:'mentor',userId:2,chatId:'-100',updateId:2,messageId:7,callback:'m:session:'+session.revision+':confirm'};
  f.fault.loseCommitReply=true;
  const uncertain=await service().handle(confirm);
  assert.equal(uncertain.code,'unavailable');assert.equal(uncertain.error,'saveUncertain');
  store=postgresStore(f.pool,gate);
  assert.equal((await service().handle(confirm)).code,'duplicate');
  assert.equal(await store.transaction(s=>Object.keys(s.history).length),1);
  assert.equal(await store.transaction(s=>s.learners['1'].hardCompletedAt),START);
  assert.equal(await store.transaction(s=>Object.values(s.deliveries).filter(d=>d.kind==='report').length),1);
});

test('SQL protocol: a rolled back confirmation returns the static save failure without business messages',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  await store.transaction(s=>enroll(s,'1',START));
  const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>START,id:()=> 'session'});
  await service.handle({username:'mentor',userId:2,chatId:'-100',updateId:1,text:'/hard_done'});
  await store.transaction(s=>{s.sessions.session.messageId=7;});
  const session=await store.transaction(s=>s.sessions.session);
  f.fault.beforeWrite=true;
  const result=await service.handle({username:'mentor',userId:2,chatId:'-100',updateId:2,messageId:7,
    callback:'m:session:'+session.revision+':confirm'});
  assert.equal(result.error,'saveFailed');
  assert.equal(await store.transaction(s=>s.learners['1'].hardCompletedAt),undefined);
  assert.equal(await store.transaction(s=>Object.keys(s.history).length),0);
  assert.equal(await store.transaction(s=>Object.values(s.deliveries).filter(d=>['report','instruction'].includes(d.kind)).length),0);
});

test('SQL delivery renders checkin screens with the session checkin and current mentor instructions',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  const now=Date.parse('2026-10-22T14:00:00Z');
  await store.transaction(s=>{s.clients['1'].status='on ru market';enroll(s,'1',START);});
  const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>now,id:()=> 'session'});
  const sent:string[]=[];
  const send=async(input:Parameters<import('./types.mts').Sender>[0])=>{
    sent.push(input.text);return {kind:'telegram-response' as const,response:{ok:true as const,result:{
      message_id:7,date:1,chat:{id:-100,type:'group' as const,title:'Synthetic'},text:input.text}}};
  };
  await service.handle({username:'alice',userId:1,chatId:'-100',updateId:1,text:'/menu'});
  await deliver({store,now:()=>now,send});
  const session=await store.transaction(s=>s.sessions.session);
  await service.handle({username:'alice',userId:1,chatId:'-100',updateId:2,messageId:7,
    callback:'m:session:'+session.revision+':checkin'});
  await deliver({store,now:()=>now,send});
  assert.ok(sent.some(text=>text.includes('Писали рекрутеры за этот период?')));
  await store.transaction(s=>enqueue(s,{id:'instruction',clientId:'1',kind:'instruction',
    template:{type:'hard-instruction'},input:{chatId:'-100',text:''}},now));
  await store.transaction(s=>{s.clients['1'].softMentor='@replacement';});
  await deliver({store,now:()=>now,send});
  assert.match(sent.at(-1)!,/@replacement/);assert.doesNotMatch(sent.at(-1)!,/@softmentor/);
});

test('SQL delivery retries static feedback without a student binding or loading client data',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  await store.transaction(s=>enqueue(s,{id:'feedback',kind:'feedback',input:{chatId:'-999',text:'static error'}},START));
  const start=f.queries.length,sent:string[]=[];
  await deliver({store,now:()=>START,send:async input=>{
    sent.push(input.chatId);return {kind:'telegram-response',response:{ok:true,result:{message_id:1,date:1,
      chat:{id:-999,type:'group',title:'Synthetic'},text:input.text}}};
  }});
  assert.deepEqual(sent,['-999']);
  assert.equal(f.queries.slice(start).some(q=>q.startsWith('SELECT c.id')||q.startsWith('SELECT id FROM noco.clients')),false);
  assert.equal(await store.transaction(s=>s.deliveries.feedback.state),'sent');
});
test('SQL protocol: storage failure rolls back and database identity mismatch blocks access',async()=>{
  const f=sqlTestPool();
  const store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  await store.transaction(s=>enroll(s,'1',START));
  f.fault.beforeCommit=true;
  await assert.rejects(store.transaction(s=>{s.clients['1'].softMentor='@changed';s.learners['1'].ready=true;}));
  assert.equal(await store.transaction(s=>s.clients['1'].softMentor),'@softmentor');
  assert.equal(await store.transaction(s=>s.learners['1'].ready),undefined);
  const wrong=postgresStore(f.pool,{database:'working_database',environment:'release'});
  await assert.rejects(wrong.transaction(()=>{}));
  assert.equal(f.snapshot().tables.history && Object.keys(f.snapshot().tables.history).length,0);
});

test('SQL updates only changed client columns; audit inserts do not require UPDATE grants',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  await store.transaction(s=>enroll(s,'1',START));
  await store.transaction(s=>{
    s.clients['1'].status='hh_ru process';
    s.history['audit']={id:'audit',clientId:'1',actor:'mentor',at:START,action:'market',before:'studying',after:'hh_ru process'};
  });
  const update=f.queries.find(q=>q.startsWith('UPDATE noco.clients'))!;
  assert.match(update,/SET client_status=\$2 WHERE/);
  assert.doesNotMatch(update,/tg_hard_mentor|tg_soft_mentor|market_id/);
  const audit=f.queries.find(q=>q.startsWith('INSERT INTO mentor_bot.history'))!;
  assert.doesNotMatch(audit,/UPDATE|ON CONFLICT/);
});

test('SQL cursor operations are monotonic and do not load business collections or lock clients',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  assert.ok(store.cursor);
  const start=f.queries.length;
  assert.equal(await store.cursor.read(),0);
  await store.cursor.advance(12);await store.cursor.advance(7);
  assert.equal(await store.cursor.read(),12);
  await assert.rejects(store.cursor.advance(-1));
  assert.equal(f.queries.slice(start).some(q=>/SELECT key,payload|noco\.clients|client_status_history/.test(q)),false);
});

test('SQL saves market and stage in one client update and rolls both back on failure',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  await store.transaction(s=>enroll(s,'1',START));
  await store.transaction(s=>{s.clients['1'].market='en';s.clients['1'].status='hh_en process';});
  assert.equal(f.snapshot().clients[0].market_id,2);
  assert.equal(f.snapshot().clients[0].client_status,'hh_en process');
  assert.match(f.queries.find(q=>q.startsWith('UPDATE noco.clients'))!,/client_status=.*market_id=/);
  f.fault.beforeCommit=true;
  await assert.rejects(store.transaction(s=>{s.clients['1'].market='ru';s.clients['1'].status='hh_ru process';}));
  assert.equal(f.snapshot().clients[0].market_id,2);
  assert.equal(f.snapshot().clients[0].client_status,'hh_en process');
});

test('SQL delivery loads only due jobs and their dependencies, preserving historical records',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  await store.transaction(s=>{
    enroll(s,'1',START);
    for(let i=0;i<120;i++){
      enqueue(s,{id:'old:'+i,clientId:'1',kind:'notice',input:{chatId:'-100',text:'historical'}},START);
      s.deliveries['old:'+i].state='sent';
      s.history['old:'+i]={id:'old:'+i,clientId:'1',actor:'mentor',at:START,action:'ready',before:null,after:true};
    }
    enqueue(s,{id:'due',clientId:'1',kind:'notice',input:{chatId:'-100',text:'due'}},START);
    enqueue(s,{id:'future',clientId:'1',kind:'notice',input:{chatId:'-100',text:'future'}},START+60_000);
  });
  assert.ok(store.deliveryTransaction);
  const start=f.queries.length,sent:string[]=[];
  assert.equal(await deliver({store,now:()=>START,send:async input=>{
    sent.push(input.text);return {kind:'telegram-response',response:{ok:true,result:{message_id:1,date:1,
      chat:{id:-100,type:'group',title:'Synthetic'},text:input.text}}};
  }}),1);
  assert.deepEqual(sent,['due']);
  const queries=f.queries.slice(start);
  assert.equal(queries.some(q=>/FROM mentor_bot\.(history|operations)|client_status_history|update_offset/.test(q)),false);
  assert.equal(queries.some(q=>q==='SELECT key,payload FROM mentor_bot.deliveries'),false);
  const snapshot=f.snapshot();
  assert.equal(Object.keys(snapshot.tables.history).length,120);
  assert.equal((snapshot.tables.deliveries.future as {state:string}).state,'pending');
});

test('SQL delivery does not let a quarantined reminder backlog hide an actionable notice',async()=>{
  const f=sqlTestPool(),store=postgresStore(f.pool,{database:'mentor_bot_test',environment:'local-test'});
  await store.transaction(s=>{
    enroll(s,'1',START);s.learners['1'].syncError='status-history-missing';
    s.learners['1'].hardCompletedAt=START-7*86400000;
    for(let i=0;i<101;i++)enqueue(s,{id:'deferred:'+i,clientId:'1',kind:'reminder',relevance:'pitch',
      expiresAt:START+86400000,input:{chatId:'-100',text:'deferred'}},START);
    enqueue(s,{id:'support',clientId:'1',kind:'notice',input:{chatId:'-100',text:'actionable'}},START);
  });
  const sent:string[]=[];
  await deliver({store,now:()=>START,send:async input=>{
    sent.push(input.text);return {kind:'telegram-response',response:{ok:true,result:{message_id:9,date:1,
      chat:{id:-100,type:'group',title:'Synthetic'},text:input.text}}};
  }});
  assert.deepEqual(sent,['actionable']);
  assert.equal(Object.values(f.snapshot().tables.deliveries).filter(d=>(d as {state:string}).state==='pending').length,101);
});
