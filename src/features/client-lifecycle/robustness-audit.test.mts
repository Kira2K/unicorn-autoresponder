import { testMessageConfig } from "./message-config.test-helper.mts";
import { memoryProgress } from "./memory-progress.test-helper.mts";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLifecycleRuntime } from './runtime.mts';
import { planReminder, planStatusMessage, type Client, type MessagePlan } from './policy.ts';
import { deliverPlan, type Delivery, type Store } from './worker.ts';
import { runLifecyclePass, type LifecycleStore } from './pass.mts';
const now=new Date('2026-10-14T16:00:00Z'),activatedAt=new Date('2026-09-01T00:00Z');
const indicators=Object.fromEntries(['phone_en','phone_ru','hh_en','hh_ru','linkedin','telegram_en','telegram_ru','email_en','email_ru'].map(k=>[k,'заполнен'])) as Client['indicators'];
const c:Client={id:1,name:'Synthetic',status:'onboarding',role:'ученик',market:'en',tag:'@audit_student',chatId:'-1001111111111',googleFolder:'https://example.invalid/folder',hardMentor:'@audit_mentor',indicators,missingPersonal:[],missingStopList:false};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('every mandatory missing-field subset goes exclusively to support; allowed exceptions do not block HH/client',async()=>{
  const fields=['tag','chatId','googleFolder','hardMentor','role'] as const;
  for(let mask=1;mask<32;mask++){
    const broken={...c};for(let i=0;i<5;i++)if(mask&(1<<i))broken[fields[i]]='';
    const p=planStatusMessage(broken,{id:String(mask),oldStatus:'studying',newStatus:'onboarding',at:now},activatedAt);
    assert.equal(p.kind,'error');let sentTo='';
    await deliverPlan({client:broken,plan:p,now,enabled:true,store:{claim:async()=>true,finish:async()=>{}},messageConfig: testMessageConfig, supportChatId:'999',send:async chat=>{sentTo=chat;return {outcome:'sent',messageId:1}}});
    assert.equal(sentTo,'999');
  }
  for(const status of ['hh_ru process','hh_both process','hh_en process']){
    assert.equal(planStatusMessage({...c,status,googleFolder:'',hardMentor:''},{id:'100',oldStatus:'studying',newStatus:status,at:now},activatedAt).kind,'send');
  }
  assert.equal(planStatusMessage({...c,role:'клиент',hardMentor:''},{id:'100',oldStatus:'studying',newStatus:c.status,at:now},activatedAt).kind,'send');
});
test('inactive/other roles do not send reminder or support report even if everything is missing',()=>{
  const state={now,activatedAt,statusChangedAt:null,lastSentAt:null,statusChangeId:null};
  for(const role of ['клиент','реферал','фейк',''])assert.equal(planReminder({...c,role,chatId:'',tag:'',market:null},state).kind,'skip');
  for(const status of ['paused','graduated','blacklisted','left','unknown','test',''])assert.equal(planReminder({...c,status,chatId:'',tag:'',market:null},state).kind,'skip');
});
test('loss of SQL claim/result, timeout and restart never blindly resend to the student',async()=>{
  const p=planStatusMessage(c,{id:'1',oldStatus:'studying',newStatus:c.status,at:now},activatedAt);
  for(const mode of ['claim_before_commit','claim_after_commit','send_unknown','finish_failed'] as const){
    let claims=0,sends=0;const taken=new Set<string>();const outcomes:Delivery[]=[];
    const store:Store={claim:async key=>{claims++;if(taken.has(key))return false;if(mode==='claim_before_commit'&&claims===1)throw Error('lost SQL');taken.add(key);if(mode==='claim_after_commit'&&claims===1)throw Error('lost commit reply');return true},
      finish:async(_key,result)=>{outcomes.push(result);if(mode==='finish_failed')throw Error('lost result write')}};
    const input={client:c,plan:p,now,enabled:true,store,messageConfig: testMessageConfig, supportChatId:'999',send:async()=>{sends++;if(mode==='send_unknown')throw Error('lost acknowledgement');return {outcome:'sent' as const,messageId:1}}};
    await deliverPlan(input).catch(()=>{});await deliverPlan(input).catch(()=>{});
    assert.ok(sends<=1,mode);if(mode==='claim_after_commit')assert.equal(sends,0);if(mode==='send_unknown')assert.equal(outcomes[0].outcome,'uncertain');
  }
});
test('SQL outage for one item does not stop later clients, and retry does not duplicate successful sends',async()=>{
  const clients=[1,2,3].map(id=>({client:{...c,id},statusChangeId:String(id),statusChangedAt:now,lastSentAt:null,lastHHTransitionAt:null}));let cursor='0',fail=true,sends=0;
  const taken=new Set<string>(),progress=memoryProgress();const store:LifecycleStore={...progress,activation:async()=>({activatedAt,statusCursor:cursor}),clients:async()=>clients,
    changes:async(_cursor,at=now)=>progress.select(clients.map(r=>({id:r.statusChangeId,clientId:r.client.id,oldStatus:'studying',newStatus:'onboarding',at:now})),at),advanceCursor:async value=>{cursor=value},
    delivery:{claim:async key=>{if(fail&&key==='status:2')throw Error('offline');if(taken.has(key))return false;taken.add(key);return true},finish:async()=>{}}};
  const input={store,send:async()=>({outcome:'sent' as const,messageId:++sends}),messageConfig: testMessageConfig, supportChatId:'999',now,apply:true,statuses:true,reminders:false};
  const first=await runLifecyclePass(input);assert.equal(first.counts.errors,1);assert.equal(sends,2);assert.equal(cursor,'3');
  fail=false;await runLifecyclePass({...input,now:new Date(now.getTime()+61000)});assert.equal(sends,3);assert.equal(cursor,'3');
});
test('runtime: disabled/default has no side effects; repeated start and stop leave no timer',async()=>{
  let calls=0;const runtime=createLifecycleRuntime({enabled:false,pass:async()=>{calls++;return {counts:{errors:0}}},report:()=>{},intervalMs:1});
  await runtime.start();await delay(10);await runtime.stop();assert.equal(calls,0);
  let active=0,overlap=false;const running=createLifecycleRuntime({enabled:true,pass:async()=>{calls++;active++;overlap ||= active>1;await delay(5);active--;return {counts:{errors:0}}},report:()=>{},intervalMs:1});
  await running.start();await running.start();await delay(15);await running.stop();const stopped=calls;await delay(10);assert.equal(calls,stopped);assert.equal(overlap,false);assert.equal(active,0);
});
test('runtime: activation during the 19h window must not be mistaken for an already completed daily check',async()=>{
  let activated=false,activeChecks=0;
  const runtime=createLifecycleRuntime({enabled:true,now:()=>now,intervalMs:1,report:()=>{},pass:async options=>{
    if(activated&&options.reminders)activeChecks++;
    return {state:activated?'send':'not_activated',counts:{errors:0}};
  }});
  try{await runtime.start();activated=true;await delay(15)}finally{await runtime.stop()}
  assert.equal(activeChecks,1,'An inactive pass is not the daily student check');
});
