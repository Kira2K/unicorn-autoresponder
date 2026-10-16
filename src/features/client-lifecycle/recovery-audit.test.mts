import { testMessageConfig } from "./message-config.test-helper.mts";
import { memoryProgress } from "./memory-progress.test-helper.mts";
/** Additional diagnostic contracts. Real code + in-memory adapters, no production or HTTP. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runLifecyclePass, type LifecycleStore } from './pass.mts';
import { createLifecycleRuntime } from './runtime.mts';
import { deliverPlan } from './worker.ts';
import { planStatusMessage, type Client } from './policy.ts';
const now=new Date('2026-10-14T16:00Z'),activatedAt=new Date('2026-09-01T00:00Z');
const prototype:Client={id:1,name:'Synthetic',status:'onboarding',role:'ученик',market:'en',tag:'@audit_student',chatId:'-1001111111111',hardMentor:'@audit_mentor',googleFolder:'https://example.invalid/folder',
  indicators:Object.fromEntries(['phone_en','phone_ru','hh_en','hh_ru','linkedin','telegram_en','telegram_ru','email_en','email_ru'].map(k=>[k,'заполнен'])) as Client['indicators'],missingPersonal:[],missingStopList:false};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(size:number){
  let cursor='0';const sent=new Set<number>(),attempts:number[]=[],taken=new Set<string>();
  const rows=Array.from({length:size},(_,i)=>({client:{...prototype,id:i+1},statusChangeId:String(i+1),statusChangedAt:now,lastSentAt:null,lastHHTransitionAt:null}));
  const progress=memoryProgress();
  const store:LifecycleStore={...progress,activation:async()=>({activatedAt,statusCursor:cursor}),clients:async()=>rows,
    changes:async(_cursor,at=now)=>progress.select(rows.map(r=>({id:r.statusChangeId,clientId:r.client.id,oldStatus:'studying',newStatus:r.client.status,at:now})),at),
    advanceCursor:async value=>{cursor=String(Math.max(Number(cursor),Number(value)))},
    delivery:{claim:async key=>{if(taken.has(key))return false;taken.add(key);return true},finish:async key=>{const id=Number(key.split(':')[1]);sent.add(id);attempts.push(id)}}};
  return {store,sent,attempts,rows,cursor:()=>cursor};
}
const options={now,apply:true,statuses:true,reminders:false,messageConfig: testMessageConfig, supportChatId:'999',send:async()=>({outcome:'sent' as const,messageId:1})};

test('2003 events without faults are drained in five batches, and reload cannot resend',async()=>{
  const f=fixture(2003);for(let i=0;i<5;i++)await runLifecyclePass({...options,...f});
  assert.equal(f.sent.size,2003);assert.equal(f.attempts.length,2003);assert.equal(f.cursor(),'2003');
  await runLifecyclePass({...options,...f});assert.equal(f.attempts.length,2003);
});
test('persistent error in first event must not starve students past the 500-event page',async()=>{
  const f=fixture(501),claim=f.store.delivery.claim;
  f.store.delivery.claim=async(...args)=>{if(args[0]==='status:1')throw Error('one student row remains locked');return claim(...args)};
  for(let i=0;i<3;i++)await runLifecyclePass({...options,...f});
  assert.equal(f.sent.has(501),true,'The 501st healthy student cannot wait forever for an unrelated locked row');
});
test('once the first locked row recovers, the backlog drains without duplicate successes',async()=>{
  const f=fixture(501),claim=f.store.delivery.claim;
  f.store.delivery.claim=async(...args)=>{if(args[0]==='status:1')throw Error('locked');return claim(...args)};
  await runLifecyclePass({...options,...f});assert.equal(f.sent.size,499);
  f.store.delivery.claim=claim;
  await runLifecyclePass({...options,...f,now:new Date(now.getTime()+61000)});await runLifecyclePass({...options,...f,now:new Date(now.getTime()+61000)});
  assert.equal(f.sent.size,501);assert.equal(f.attempts.length,501);assert.equal(f.cursor(),'501');
});
test('four concurrent passes and restart do not duplicate an event on a shared claim store',async()=>{
  const f=fixture(150);await Promise.all(Array.from({length:4},()=>runLifecyclePass({...options,...f})));
  await runLifecyclePass({...options,...f});assert.equal(f.attempts.length,150);assert.equal(f.sent.size,150);
});
test('lost informational cursor update cannot resend events already acknowledged individually',async()=>{
  const f=fixture(4),advance=f.store.advanceCursor;let first=true;
  f.store.advanceCursor=async cursor=>{if(first){first=false;throw Error('cursor result lost')}return advance(cursor)};
  await assert.rejects(runLifecyclePass({...options,...f}));await runLifecyclePass({...options,...f});
  assert.equal(f.attempts.length,4);assert.deepEqual(await f.store.changes('0',now),[]);
});
test('disabled delivery never touches DB/sender even for a queued valid event',async()=>{
  let calls=0;const p=planStatusMessage(prototype,{id:'1',oldStatus:'studying',newStatus:'onboarding',at:now},activatedAt);
  await deliverPlan({client:prototype,plan:p,now,enabled:false,store:{claim:async()=>{calls++;return true},finish:async()=>{calls++}},messageConfig: testMessageConfig, supportChatId:'999',send:async()=>{calls++;return {outcome:'sent',messageId:1}}});
  assert.equal(calls,0);
});
test('daily reminder time cannot be lost behind a slow status batch crossing the entire 19h window',async()=>{
  let clock=new Date('2026-10-14T15:59:59Z'),dailyChecks=0,first=true;
  const runtime=createLifecycleRuntime({enabled:true,intervalMs:1,now:()=>clock,report:()=>{},pass:async options=>{
    if(options.reminders)dailyChecks++;
    if(first){first=false;clock=new Date('2026-10-14T17:00:01Z')}
    return {counts:{errors:0}};
  }});
  try{await runtime.start();await delay(15)}finally{await runtime.stop()}
  assert.equal(dailyChecks,1,'A slow batch must not silently consume the whole daily reminder opportunity');
});
test('overlapping start -> stop -> start cannot leave a second timer running after final stop',async()=>{
  let release!:()=>void,calls=0;const gate=new Promise<void>(resolve=>{release=resolve});
  const runtime=createLifecycleRuntime({enabled:true,intervalMs:8,report:()=>{},pass:async()=>{calls++;if(calls===1)await gate;return {counts:{errors:0}}}});
  const firstStart=runtime.start();await delay(1);const stopping=runtime.stop();const secondStart=runtime.start();release();
  await Promise.all([firstStart,stopping,secondStart]);await runtime.stop();const atStop=calls;
  await delay(25);assert.equal(calls,atStop,'All owned timers must be stopped, including overlapping lifecycle calls');
});
