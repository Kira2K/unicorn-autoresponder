import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './test-harness.mts';
import { fixtureClient } from './test-fixtures.mts';
import { run, memoryLock } from './runtime.mts';
import { tick } from './schedule.mts';
import { WEEK } from './calendar.mts';
import { enqueue } from './messages.mts';
import { deliver } from './delivery.mts';
import { ERROR_TEXTS } from './error-texts.mts';
import { createTelegramThrottle } from './telegram-throttle.mts';
import { createMentorWorker } from './worker.mts';
import { changeStatus } from './schedule.mts';

const OPEN=Date.parse('2026-10-22T14:00:00Z');
const update=(id:number,chatId=-100)=>({update_id:id,message:{message_id:id,chat:{id:chatId,type:'group'},
  from:{id,username:'mentor',is_bot:false},text:'/menu'}});

test('current paused card cancels pending reports and checkins even before status reconciliation',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);h.setNow(OPEN+WEEK);
  await tick(h.store,h.now(),'-900');
  await h.service.handle({username:'alice',userId:1,chatId:'-100',updateId:1,text:'/menu'});
  await h.flush();h.sent.length=0;
  const s=h.session();
  await h.service.handle({username:'alice',userId:1,chatId:'-100',updateId:2,messageId:s.messageId,
    callback:'m:'+s.id+':'+s.revision+':checkin'});
  await h.store.transaction(s=>{
    enqueue(s,{id:'pending-report',clientId:'1',kind:'report',input:{chatId:'-900',text:'historical report'}},h.now());
    enqueue(s,{id:'pending-reminder',clientId:'1',kind:'reminder',input:{chatId:'-100',text:'checkin'}},h.now());
    s.clients['1'].status='paused';
  });
  await h.flush();
  assert.deepEqual(h.sent,[]);
  for(const d of Object.values(h.store.snapshot().deliveries).filter(d=>d.state!=='sent'))assert.equal(d.state,'cancelled');
});

test('maintenance failure reports an error and still polls and handles new messages',async()=>{
  const h=harness(),stop=new AbortController();let handled=0;
  await run({store:h.store,send:h.sender,reportChatId:'-900',now:h.now,lock:memoryLock(),signal:stop.signal,
    maintenance:async()=>{throw Error('SECRET');},async handle(){handled++;return {code:'ok'};},
    api:{async getUpdates(offset){if(offset===2){stop.abort();return [];}return [update(1)];},async answerCallbackQuery(){}},
    wait:async()=>{stop.abort();}});
  assert.equal(handled,1);assert.equal(h.store.snapshot().offset,2);
  assert.ok(h.sent.some(m=>m.chatId==='-900'&&m.text===ERROR_TEXTS.backgroundFailed));
  assert.ok(h.sent.every(m=>!m.text.includes('SECRET')));
});

test('an unavailable or throwing first chat never blocks the next chat and is not automatically replayed',async()=>{
  for(const throwing of [false,true]){
    const h=harness(),stop=new AbortController(),handled:string[]=[];
    await run({store:h.store,send:h.sender,lock:memoryLock(),signal:stop.signal,maintenance:async()=>{},
      async handle(input){handled.push(input.chatId);if(input.chatId==='-100'){
        if(throwing)throw Error('SECRET');return {code:'unavailable',error:'accessUnavailable'};
      }return {code:'ok'};},
      api:{async getUpdates(offset){if(offset===3){stop.abort();return [];}return [update(1),update(2,-200)];},async answerCallbackQuery(){}},
      wait:async()=>{stop.abort();}});
    assert.deepEqual(handled,['-100','-200']);assert.equal(h.store.snapshot().offset,3);
    assert.ok(h.sent.some(m=>m.chatId==='-100'));
  }
});

test('cursor persistence outage does not stop the current batch or polling with the in-memory offset',async()=>{
  const h=harness(),stop=new AbortController();const handled:number[]=[],offsets:(number|undefined)[]=[];
  const store={...h.store,cursor:{async read(){throw Error('db');},async advance(){throw Error('db');}}};
  await run({store,send:h.sender,lock:memoryLock(),signal:stop.signal,maintenance:async()=>{},
    async handle(input){handled.push(input.updateId);return {code:'unavailable',error:'accessUnavailable'};},
    api:{async getUpdates(offset){offsets.push(offset);if(offset===3){stop.abort();return [];}return [update(1),update(2,-200)];},
      async answerCallbackQuery(){}},wait:async()=>{stop.abort();}});
  assert.deepEqual(handled,[1,2]);assert.deepEqual(offsets,[undefined,3]);
});

test('send FloodWait defers other deliveries, preserves native result, and resumes without business replay',async()=>{
  const h=harness();let calls=0;
  const response={kind:'telegram-response' as const,response:{ok:false as const,error_code:429,description:'slow',parameters:{retry_after:90}}};
  const transport=createTelegramThrottle({now:h.now,member:async()=>true,
    api:{async getUpdates(){return [];},async answerCallbackQuery(){}},send:async input=>{calls++;return calls===1?response:h.sender(input);}});
  await h.store.transaction(s=>{for(const [id,chatId] of [['a','-100'],['b','-200']])
    enqueue(s,{id,clientId:'1',kind:'report',input:{chatId,text:'mock'}},h.now());});
  await deliver({store:h.store,send:transport.send,now:h.now});
  assert.equal(calls,1);
  assert.ok(Object.values(h.store.snapshot().deliveries).every(d=>d.retryAt>=h.now()+90_000&&d.state==='pending'));
  h.setNow(h.now()+89_999);await deliver({store:h.store,send:transport.send,now:h.now});assert.equal(calls,1);
  h.setNow(h.now()+1);await deliver({store:h.store,send:transport.send,now:h.now});assert.equal(calls,3);
  assert.deepEqual(h.store.snapshot().history,{});
});

test('polling respects native retry_after instead of retrying after a fixed five seconds',async()=>{
  const h=harness(),stop=new AbortController();let calls=0;const waits:number[]=[];
  await run({store:h.store,send:h.sender,lock:memoryLock(),signal:stop.signal,maintenance:async()=>{},async handle(){return {code:'ok'};},
    wait:async ms=>{waits.push(ms);},api:{async getUpdates(){calls++;if(calls===1)throw {
      details:{data:{error_code:429,parameters:{retry_after:120}}}};stop.abort();return [];},async answerCallbackQuery(){}}});
  assert.deepEqual(waits,[120_000]);assert.equal(calls,2);
});

test('proactive send limits defer one busy group while allowing other groups',async()=>{
  const h=harness();const transport=createTelegramThrottle({now:h.now,send:h.sender,member:async()=>true,
    api:{async getUpdates(){return [];},async answerCallbackQuery(){}}});
  await transport.send({chatId:'-100',text:'first'});
  await assert.rejects(transport.send({chatId:'-100',text:'too fast'}));
  await transport.send({chatId:'-200',text:'other'});
  for(let i=1;i<20;i++){h.setNow(h.now()+1000);await transport.send({chatId:'-100',text:'next'});}
  h.setNow(h.now()+1000);await assert.rejects(transport.send({chatId:'-100',text:'over group limit'}));
  await transport.send({chatId:'-300',text:'still other'});
  assert.equal(h.sent.filter(m=>m.chatId==='-100').length,20);
});

test('pause cancels old queued reports permanently, including an abandoned send, after returning',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);h.setNow(OPEN+WEEK);
  await tick(h.store,h.now(),'-900');
  await h.store.transaction(s=>{
    for(const d of Object.values(s.deliveries)){d.state='sending';d.claimedAt=h.now()-120_001;}
    s.clients['1'].status='paused';changeStatus(s,s.learners['1'],'paused',h.now());
    s.clients['1'].status='on ru market';changeStatus(s,s.learners['1'],'on ru market',h.now()+1000);
  });
  await h.flush();assert.deepEqual(h.sent,[]);
  assert.ok(Object.values(h.store.snapshot().deliveries).every(d=>d.state==='cancelled'));
});

test('member and callback FloodWait preserve the native failure and skip HTTP until their deadlines',async()=>{
  const h=harness();let members=0,callbacks=0;
  const native={details:{data:{error_code:429,parameters:{retry_after:70}}}};
  const transport=createTelegramThrottle({now:h.now,send:h.sender,
    member:async()=>{if(++members===1)throw native;return true;},api:{async getUpdates(){return [];},
      async answerCallbackQuery(){if(++callbacks===1)throw native;}}});
  await assert.rejects(transport.member('-100',1),error=>error===native);
  await assert.rejects(transport.member('-200',2));assert.equal(members,1);
  await assert.rejects(transport.api.answerCallbackQuery({callbackQueryId:'a'}),error=>error===native);
  await assert.rejects(transport.api.answerCallbackQuery({callbackQueryId:'b'}));assert.equal(callbacks,1);
  await transport.send({chatId:'-100',text:'sending remains available'});
  h.setNow(h.now()+70_000);
  assert.equal(await transport.member('-200',2),true);
  await transport.api.answerCallbackQuery({callbackQueryId:'c'});assert.equal(callbacks,2);
});

test('global send budget limits distinct chats and missing retry_after uses a safe delay',async()=>{
  const h=harness();
  const transport=createTelegramThrottle({now:h.now,send:h.sender,member:async()=>true,
    api:{async getUpdates(){return [];},async answerCallbackQuery(){}}});
  for(let i=0;i<25;i++)await transport.send({chatId:String(1000+i),text:'batch'});
  await assert.rejects(transport.send({chatId:'2000',text:'over budget'}));
  h.setNow(h.now()+1000);await transport.send({chatId:'2000',text:'next window'});
  const limited=createTelegramThrottle({now:h.now,send:async()=>({kind:'telegram-response',response:{ok:false,error_code:429,description:'slow'}}),
    member:async()=>true,api:{async getUpdates(){return [];},async answerCallbackQuery(){}}});
  await limited.send({chatId:'-100',text:'native rate limit'});
  await assert.rejects(limited.send({chatId:'-200',text:'deferred'}),error=>(error as {retryAfterMs:number}).retryAfterMs===60_000);
});

test('a failed error reply is durably deferred during FloodWait while the next chat is processed',async()=>{
  const h=harness(),stop=new AbortController();const handled:number[]=[];
  await run({store:h.store,now:h.now,send:async()=>({kind:'telegram-response',response:{ok:false,error_code:429,description:'slow',parameters:{retry_after:80}}}),
    lock:memoryLock(),signal:stop.signal,maintenance:async()=>{},async handle(input){handled.push(input.updateId);return {code:'unavailable',error:'accessUnavailable'};},
    api:{async getUpdates(offset){if(offset===3){stop.abort();return [];}return [update(1),update(2,-200)];},async answerCallbackQuery(){}}});
  assert.deepEqual(handled,[1,2]);
  const jobs=Object.values(h.store.snapshot().deliveries);
  assert.equal(jobs.length,2);assert.ok(jobs.every(d=>d.kind==='feedback'&&!d.clientId&&d.retryAt===h.now()+80_000));
  h.setNow(h.now()+80_000);await h.flush();assert.equal(h.sent.length,2);
});

test('worker checkpoints a server send cooldown and restores it in a new worker',async()=>{
  const h=harness();let calls=0;
  async function once(send:typeof h.sender){
    const stop=new AbortController();
    const worker=createMentorWorker({store:h.store,now:h.now,member:async()=>true,send,reportChatId:'-900',botUsername:'mentor_test_bot',
      log(){},lock:memoryLock(),api:{async getUpdates(){stop.abort();return [];},async answerCallbackQuery(){}}});
    await worker.start(stop.signal);
  }
  await h.store.transaction(s=>enqueue(s,{id:'job-a',clientId:'1',kind:'notice',input:{chatId:'-100',text:'a'}},h.now()));
  await once(async()=>{calls++;return {kind:'telegram-response',response:{ok:false,error_code:429,description:'slow',parameters:{retry_after:90}}};});
  assert.equal(h.store.snapshot().operations['telegram:cooldown:send'].at,h.now()+90_000);
  await h.store.transaction(s=>enqueue(s,{id:'job-b',clientId:'1',kind:'report',input:{chatId:'-900',text:'b'}},h.now()));
  await once(async input=>{calls++;return h.sender(input);});assert.equal(calls,1);
  h.setNow(h.now()+90_000);await once(async input=>{calls++;return h.sender(input);});assert.equal(calls,3);
});

test('a broken screen job cannot poison delivery of the following chat',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);
  await h.command('/menu');
  await h.store.transaction(s=>{
    const session=Object.values(s.sessions)[0];session.action='checkin';session.checkinId='missing';
    enqueue(s,{id:'broken',clientId:'1',kind:'screen',sessionId:session.id,sessionRevision:session.revision,
      template:{type:'screen'},input:{chatId:'-100',text:''}},h.now());
    enqueue(s,{id:'good',clientId:'1',kind:'report',input:{chatId:'-200',text:'other chat'}},h.now());
  });
  await h.flush();
  assert.equal(h.store.snapshot().deliveries.broken.state,'blocked');
  assert.ok(h.sent.some(m=>m.chatId==='-200'&&m.text==='other chat'));
});
