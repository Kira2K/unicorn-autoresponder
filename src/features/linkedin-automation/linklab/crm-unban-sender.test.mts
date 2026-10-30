import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {accountCommandBody} from './crm-account-command.mts';
import {readAccountCommandConfig} from './crm-account-actions.mts';
import {createUnbanSender} from './crm-unban-sender.mts';

const config={baseUrl:'https://crm.example.test',secret:'synthetic-unban-key-xxxxxxxxxxxxxxxx'};
const student='10000000-0000-4000-8000-000000000001';
const operation={command:'unban' as const,event_id:'20000000-0000-4000-8000-000000000001',client_id:'9223372036854775807',
  account_id:'21',old_account_id:'21',cycle_id:'71',linklab_version:'8',confirmed_at:'2026-10-30T10:00:00.123456Z',
  account_url:'https://www.linkedin.com/in/synthetic'};
const body=accountCommandBody(operation);
function receipt(bytes:Buffer,patch:Record<string,unknown>={}){
  return {...JSON.parse(bytes.toString()),student_id:student,payload_sha256:createHash('sha256').update(bytes).digest('hex'),
    state:'applied',effects_applied:true,current:true,status:'warmup',current_status:'warmup',current_linklab_version:'8',
    warmup_started_on:'2026-10-30',...patch};
}
const response=(value:unknown,status=201)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

test('unban sender is OFF by default and adds no separate configuration flag',()=>{
  let called=0;
  assert.equal(createUnbanSender({config:readAccountCommandConfig({}),fetch:async()=>{called++;throw Error('unexpected');}}),undefined);
  assert.equal(called,0);
});

test('one committed body is forwarded unchanged with the existing HMAC and exact bigint identities',async()=>{
  let calls=0;
  const send=createUnbanSender({config,fetch:async(url,init)=>{
    calls++;assert.equal(String(url),'https://crm.example.test/integrations/linkedin/account-commands/');
    const bytes=Buffer.from(init!.body as Uint8Array),headers=init!.headers as Record<string,string>;
    assert.deepEqual(bytes,body);
    assert.equal(headers['X-CRM-Signature'],'v1='+createHmac('sha256',config.secret)
      .update('v1:'+headers['X-CRM-Timestamp']+':').update(bytes).digest('hex'));
    return response(receipt(bytes));
  }})!;
  assert.deepEqual(await send({body,expectedStudentId:student}),{studentId:student,status:'warmup',warmupStartedOn:'2026-10-30'});
  assert.equal(calls,1);assert.equal(JSON.parse(body.toString()).client_id,'9223372036854775807');
});

test('explicit replay retains the original event/cycle IDs and bytes; no new operation is invented',async()=>{
  const seen:Buffer[]=[];
  const send=createUnbanSender({config,fetch:async(_url,init)=>{
    const bytes=Buffer.from(init!.body as Uint8Array);seen.push(bytes);return response(receipt(bytes),seen.length===1?201:200);
  }})!;
  await send({body,expectedStudentId:student});await send({body,expectedStudentId:student});
  assert.equal(seen.length,2);assert.deepEqual(seen,[body,body]);
});

test('wrong command, invalid version or mismatched same-account IDs are rejected before HTTP',async()=>{
  let calls=0;
  const send=createUnbanSender({config,fetch:async()=>{calls++;throw Error('unexpected');}})!;
  for(const patch of [{command:'ban'},{command:'replacement'},{old_account_id:'22'},{linklab_version:'0'},
    {client_id:101},{cycle_id:''},{event_id:'changed'}]){
    const bytes=Buffer.from(JSON.stringify({...JSON.parse(body.toString()),...patch}));
    await assert.rejects(send({body:bytes,expectedStudentId:student}),/payload_invalid/);
  }
  await assert.rejects(send({body:Buffer.from('{'),expectedStudentId:student}),/payload_invalid/);
  assert.equal(calls,0);
});

test('HTTP200 with historical/wrong receipt never counts as confirmation',async()=>{
  for(const patch of [{current:false},{student_id:'other'},{account_id:'22'},{client_id:'101'},
    {event_id:'other'},{cycle_id:'72'},{linklab_version:'7'},{current_linklab_version:'9'},
    {payload_sha256:'wrong'},{effects_applied:false},{current_status:'blocked'},{warmup_started_on:''}]){
    const send=createUnbanSender({config,fetch:async()=>response(receipt(body,patch),200)})!;
    await assert.rejects(send({body,expectedStudentId:student}),/receipt_mismatch/);
  }
});

test('a lost answer or HTTP refusal makes exactly one attempt without an automatic retry',async()=>{
  for(const status of [401,409,429,503,'lost'] as const){
    let calls=0;
    const send=createUnbanSender({config,fetch:async()=>{calls++;
      if(status==='lost')throw Error('private upstream details');
      return response({private:'details'},status);
    }})!;
    await assert.rejects(send({body,expectedStudentId:student}),{
      message:status==='lost'?'crm_account_command_delivery_uncertain':'crm_account_command_http_'+status});
    assert.equal(calls,1);
  }
});
