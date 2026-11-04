import test from 'node:test';import assert from 'node:assert/strict';
import {createBridgeErrorReporter,bridgeReportsChatId} from './error-reports.mts';
import{createMemoryStore,mockClient,testConfig}from'../testing.mts';import{createOctoService}from'../service.mts';
import type{SendOneInput,SendOneResult}from'../../../integrations/telegram/types.ts';
import type{OctoStore}from'../contracts.mts';import{openLocalStore}from'./test-store.mts';
import{mkdtemp,rm}from'node:fs/promises';import{join,dirname,basename}from'node:path';import{tmpdir}from'node:os';
const sent:SendOneResult={kind:'telegram-response',response:{ok:true,result:{message_id:42,date:1,chat:{id:-1003187558078,type:'supergroup',title:'reports'},text:'ok'}}};
async function fixture(store:OctoStore=createMemoryStore()){const service=createOctoService({store,config:testConfig,getClient:async id=>mockClient(id)});await service.ensure(901);const p=(await store.list())[0];
 const original=(await store.get(p.id))!;original.grant={id:'grant-error',phase:'blocked',alias:'alias',createdAt:1,eventsAfter:0,original:original.original,pending:'clear',attemptedAt:10,clearMethod:'bridge',error:'octo_bridge_outcome_unknown',bridgeClear:{bridgeId:'pc',ownerEmail:'owner@example.invalid',result:{state:'uncertain',code:'bridge_local_outcome_unknown',at:20}}};await store.save(original);return{store,id:p.id};}
test('one report per grant across parallel workers/restart, with no profile or proxy secrets',async()=>{
 const{store,id}=await fixture(),inputs:SendOneInput[]=[];const make=()=>createBridgeErrorReporter({store,client:async()=>({...mockClient(901),fio:'Тимофей Басуев',primaryStack:'GO'}),sendOne:async input=>{inputs.push(input);return sent;},now:()=>100});
 await Promise.allSettled([make()(id),make()(id)]);await make()(id);
 assert.equal(inputs.length,1);assert.equal(inputs[0].chatId,bridgeReportsChatId);assert.match(inputs[0].text,/Тимофей Басуев/);assert.match(inputs[0].text,/Стек: GO/);assert.match(inputs[0].text,/grant-error/);assert.ok(!inputs[0].text.includes('owner@example.invalid'));assert.ok(!inputs[0].text.includes((await store.get(id))!.password));
 assert.equal((await store.get(id))!.grant!.bridgeClear!.incident!.messageId,42);
});

test('a process restart reloads an unknown report claim from the durable store and does not resend',async()=>{
 const root=await mkdtemp(join(tmpdir(),'octo-report-restart-'));let disk=await openLocalStore(join(root,'store.json'),'report-fixture'),calls=0;
 try{const{id}=await fixture(disk.store);const save=disk.store.save;disk.store.save=async p=>{if(p.grant?.bridgeClear?.incident?.state==='sent')throw Error('crash before receipt');return save(p);};
  await assert.rejects(createBridgeErrorReporter({store:disk.store,client:async()=>mockClient(901),sendOne:async()=>{calls++;return sent;},now:()=>100})(id));
  await disk.close();disk=await openLocalStore(join(root,'store.json'),'report-fixture');
  await createBridgeErrorReporter({store:disk.store,client:async()=>mockClient(901),sendOne:async()=>{calls++;return sent;},now:()=>200})(id);
  assert.equal(calls,1);assert.equal((await disk.store.get(id))!.grant!.bridgeClear!.incident!.state,'attempting');
 }finally{await disk.close();assert.equal(dirname(root),tmpdir());assert.ok(basename(root).startsWith('octo-report-restart-'));await rm(root,{recursive:true,force:true});}
});
test('failed, uncertain and throwing sends are recorded and never automatically repeated',async()=>{
 for(const kind of ['failed','uncertain','throw']as const){const{store,id}=await fixture();let calls=0;
  const run=()=>createBridgeErrorReporter({store,client:async()=>mockClient(901),sendOne:async()=>{calls++;if(kind==='throw')throw Error('SECRET');if(kind==='failed')return{kind:'telegram-response',response:{ok:false,error_code:403,description:'SECRET'}};return{kind:'client-failure',failure:{stage:'transport',error:{name:'Error',message:'SECRET'}}};},now:()=>100})(id);
  await run();await run();assert.equal(calls,1);const receipt=(await store.get(id))!.grant!.bridgeClear!.incident!;assert.equal(receipt.state,kind==='failed'?'failed':'uncertain');assert.ok(!JSON.stringify(receipt).includes('SECRET'));
 }
});
test('stalled pre-write authorization gets one alert after threshold; successful short cleanup gets none',async()=>{
 const{store,id}=await fixture();let time=100,calls=0;const p=(await store.get(id))!;p.grant!.phase='awaiting_close';p.grant!.error='octo_bridge_waiting';delete p.grant!.bridgeClear!.result;await store.save(p);
 const report=createBridgeErrorReporter({store,client:async()=>mockClient(901),sendOne:async()=>{calls++;return sent;},now:()=>time,waitingMs:1000});await report(id);assert.equal(calls,0);time=1010;await report(id);assert.equal(calls,1);assert.equal((await store.get(id))!.grant!.bridgeClear!.incident!.code,'octo_bridge_cleanup_delayed');
});
test('a durable claim survives a crash/lost receipt; a new grant has its own notification',async()=>{
 const{store,id}=await fixture();let calls=0;const save=store.save;let failReceipt=true;store.save=async p=>{if(p.grant?.bridgeClear?.incident?.state==='sent'&&failReceipt){failReceipt=false;throw Error('db lost');}return save(p);};
 const make=()=>createBridgeErrorReporter({store,client:async()=>mockClient(901),sendOne:async()=>{calls++;return sent;},now:()=>100});await assert.rejects(make()(id));await make()(id);assert.equal(calls,1);assert.equal((await store.get(id))!.grant!.bridgeClear!.incident!.state,'attempting');
 const next=(await store.get(id))!;next.grant!.id='next-grant';delete next.grant!.bridgeClear!.incident;await store.save(next);await make()(id);assert.equal(calls,2);
});
