import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {banCancellationBody,createBanCancellation,type BanCancellation} from './crm-ban-cancellation.mts';

const input: BanCancellation = {clientId:101,accountId:11,studentId:'10000000-0000-4000-8000-000000000001',
  linklabVersion:'7',banUndoVersion:'123456:7:2026-11-07T05:00:00.123456Z'};
const secret='synthetic-ban-cancellation-xxxxxxxxxxxxxxxx';
const options={baseUrl:'https://crm.example.test',secret,now:()=>1794016800};

function acknowledgement(body:Buffer) {
  return {...JSON.parse(body.toString()),student_id:input.studentId,payload_sha256:createHash('sha256').update(body).digest('hex'),
    state:'applied',current:true,current_linklab_version:'7',stage_preserved:true,current_status:'growth',
    source_banned:false,crm_banned:false};
}

test('one source proof produces identical operation bytes across retries and a fresh report gets a new ID',()=>{
  const first=banCancellationBody(input),retry=banCancellationBody({...input});
  assert.deepEqual(first,retry);
  const event=JSON.parse(first.toString());
  assert.match(event.event_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(event.confirmed_at,'2026-11-07T05:00:00.123456Z','microseconds remain exact');
  assert.notEqual(event.event_id,JSON.parse(banCancellationBody({...input,banUndoVersion:'123457:7:2026-11-07T05:00:00.123456Z'}).toString()).event_id);
});

test('cancellation uses signed HTTPS and requires acknowledgement that both flags are clear',async()=>{
  let calls=0;
  const cancel=createBanCancellation({...options,fetch:async(url,init)=>{
    calls++;
    assert.equal(String(url),'https://crm.example.test/integrations/linkedin/ban-cancellations/');
    const body=Buffer.from(init!.body as Uint8Array);
    const expected='v1='+createHmac('sha256',secret).update('v1:'+options.now()+':').update(body).digest('hex');
    assert.equal((init!.headers as Record<string,string>)['X-CRM-Signature'],expected);
    return Response.json(acknowledgement(body),{status:201});
  }})!;
  await cancel(input);assert.equal(calls,1);
  for(const patch of [{source_banned:true},{crm_banned:true},{stage_preserved:false},{current:false},
    {student_id:'10000000-0000-4000-8000-000000000002'},{current_linklab_version:'8'},{payload_sha256:'0'.repeat(64)}]){
    const unsafe=createBanCancellation({...options,fetch:async(_url,init)=>Response.json({...acknowledgement(Buffer.from(init!.body as Uint8Array)),...patch})})!;
    await assert.rejects(unsafe(input),/crm_ban_cancel_receipt_invalid/);
  }
});

test('stale or malformed proofs fail before the network and an unknown delivery is not automatically retried',async()=>{
  let calls=0;
  const cancel=createBanCancellation({...options,fetch:async()=>{calls++;throw Error('network error');}})!;
  for(const banUndoVersion of ['123456','123456:8:2026-11-07T05:00:00Z','0:7:2026-11-07T05:00:00Z','123456:7:invalid'])
    await assert.rejects(cancel({...input,banUndoVersion}),/crm_ban_cancel_invalid/);
  assert.equal(calls,0);
  await assert.rejects(cancel(input),/crm_account_command_delivery_uncertain/);
  assert.equal(calls,1);
});
