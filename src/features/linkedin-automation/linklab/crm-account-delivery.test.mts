import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {COPY_MARKER} from '../../../integrations/postgres/contracts.mts';
import {createAccountDeliveryWorker} from './crm-account-delivery.mts';
import {createAccountCommandActions} from './crm-account-actions.mts';

function fixture(status=503,ack=false){
  const event={schema_version:1,event_type:'linkedin.account_command',source:'unicorn',command:'replacement',event_id:'10000000-0000-4000-8000-000000000001',client_id:'101',account_id:'21',linklab_version:'2',confirmed_at:'2026-11-06T01:00:00Z',cycle_id:'1',old_account_id:'11',account_url:'https://www.linkedin.com/in/synthetic'};
  const student='20000000-0000-4000-8000-000000000001',body=JSON.stringify(event);
  const row={event_id:event.event_id,body,student_id:student};
  let available=true,current=true,active=0,calls=0;
  const results:unknown[][]=[],bodies:string[]=[];
  const pool={end:async()=>{},connect:async()=>{active++;return{release:()=>{active--;},query:async(sql:string,values?:unknown[])=>{
    if(sql.includes('current_database()'))return{rows:[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]};
    if(sql.includes('crm_claim_account_delivery')){if(!available)return{rows:[]};available=false;return{rows:[row]};}
    if(sql.includes('crm_account_delivery_current'))return{rows:[{current}]};
    if(sql.includes('crm_finish_account_delivery')){results.push(values!);return{rows:[{saved:values![2]!=='sent'||ack}]};}
    return{rows:[]};
  }}}};
  const transport:typeof fetch=async(_url,options)=>{
    assert.equal(active,0,'SQL connection is released before HTTP');calls++;
    bodies.push(Buffer.from(options!.body as Uint8Array).toString('utf8'));
    if(status===0)throw Error('lost response');
    return new Response(JSON.stringify({...event,student_id:student,payload_sha256:createHash('sha256').update(body).digest('hex'),state:'applied',effects_applied:true,current:true,current_linklab_version:'2',status:'warmup',current_status:'warmup',warmup_started_on:'2026-11-06'}),{status});
  };
  const worker=createAccountDeliveryWorker({pool,database:'unicorn_noco_copy_restore',config:{baseUrl:'https://synthetic.invalid',secret:'synthetic-command-key-xxxxxxxxxxxxxxxx'},fetch:transport});
  return{worker,results,bodies,calls:()=>calls,retry:()=>{available=true;},stale:()=>{current=false;}};
}
for(const status of [0,408,429,503])test(`temporary failure ${status} retains exact UUID and bytes`,async()=>{
  const f=fixture(status);await f.worker.pass();f.retry();await f.worker.pass();
  assert.equal(f.calls(),2);assert.equal(f.results[0][2],'retry');assert.equal(f.bodies[0],f.bodies[1]);
});
test('a permanent rejection is queued for review',async()=>{const f=fixture(409);await f.worker.pass();assert.equal(f.results[0][2],'review');});
test('concurrent passes coalesce and acknowledged success is not sent again',async()=>{
  const f=fixture(201,true);await Promise.all([f.worker.pass(),f.worker.pass()]);await f.worker.pass();assert.equal(f.calls(),1);assert.equal(f.results[0][2],'sent');
});
test('a successful HTTP response cannot replace source ACK',async()=>{const f=fixture(201,false);await assert.rejects(f.worker.pass(),/ack_or_lease_unconfirmed/);});
test('a newer source version/account is never sent',async()=>{const f=fixture();f.stale();await f.worker.pass();assert.equal(f.calls(),0);assert.equal(f.results[0][2],'superseded');});
for(const state of ['pending','review','superseded'])test(`replacement callback reads durable ${state} without minting another event`,async()=>{
  const pool={end:async()=>{},connect:async()=>({release:()=>{},query:async(sql:string)=>({rows:sql.includes('current_database()')?[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]:sql.includes('crm_account_deliveries')?[{event_id:'10000000-0000-4000-8000-000000000001',state}]:[]})})};
  const actions=createAccountCommandActions({pool,database:'unicorn_noco_copy_restore',config:{baseUrl:'https://synthetic.invalid',secret:'synthetic-command-key-xxxxxxxxxxxxxxxx'},fetch:async()=>{throw Error('must not send');}})!;
  const result=await actions.replacement(1);assert.equal(result.state,state==='pending'?'queued':'failed');assert.equal(result.eventId,'10000000-0000-4000-8000-000000000001');
});
