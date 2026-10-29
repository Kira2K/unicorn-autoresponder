import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {COPY_MARKER, type SqlPool} from '../../../integrations/postgres/contracts.mts';
import {createAccountCommandActions,readAccountCommandConfig} from './crm-account-actions.mts';

const config={baseUrl:'https://crm.example.test',secret:'synthetic-command-key-xxxxxxxxxxxxxxxx'};
function fixture(row:Record<string,unknown>|undefined){
  const queries:string[]=[];
  let released=false;
  const pool:SqlPool={end:async()=>{},connect:async()=>({release(){released=true;},async query(sql){
    released=false;queries.push(sql);
    if(sql.includes('current_database()'))return{rows:[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]};
    return{rows:sql.includes('FROM noco.')&&row?[row]:[]};
  }})};
  return{pool,queries,get released(){return released;}};
}
const linked={client_id:'7',account_id:'21',version:'8',crm_student_id:'10000000-0000-4000-8000-000000000001',
  confirmed_at:new Date('2026-10-29T18:00:00.123Z'),cycle_id:'12',old_account_id:'11',account_url:'www.linkedin.com/in/synthetic'};

test('disabled config creates no action or SQL/HTTP side effect; broken enabled config is rejected',()=>{
  const f=fixture(linked);
  assert.equal(readAccountCommandConfig({}),undefined);
  assert.equal(createAccountCommandActions({pool:f.pool,database:'unicorn_noco_copy_restore'}),undefined);
  assert.deepEqual(f.queries,[]);
  assert.throws(()=>readAccountCommandConfig({CRM_ACCOUNT_COMMANDS_ENABLED:'1'}),/configuration_required/);
  assert.throws(()=>readAccountCommandConfig({CRM_ACCOUNT_COMMANDS_ENABLED:'1',CRM_ACCOUNT_COMMAND_API_URL:'http://crm.example.test',CRM_ACCOUNT_COMMAND_API_SECRET:config.secret}));
});

test('both real button callbacks build the intended command, release SQL and send once',async()=>{
  for(const command of ['ban','replacement'] as const){
    const f=fixture(linked);let sends=0;
    const actions=createAccountCommandActions({pool:f.pool,database:'unicorn_noco_copy_restore',config,
      fetch:async(_url,init)=>{
        assert.equal(f.released,true,'HTTP must run after the read transaction is released');
        assert.equal(f.queries.at(-1),'ROLLBACK');sends++;
        const body=Buffer.from(init!.body as Uint8Array),p=JSON.parse(body.toString());
        assert.equal(p.command,command);assert.equal(p.account_id,'21');assert.equal(p.client_id,'7');
        assert.equal(p.confirmed_at,'2026-10-29T18:00:00.123Z');
        if(command==='ban')assert.equal(p.cycle_id,undefined);
        else{assert.equal(p.cycle_id,'12');assert.equal(p.old_account_id,'11');assert.equal(p.account_url,'https://www.linkedin.com/in/synthetic');}
        const status=command==='ban'?'blocked':'warmup';
        return new Response(JSON.stringify({...p,payload_sha256:createHash('sha256').update(body).digest('hex'),
          student_id:linked.crm_student_id,state:'applied',effects_applied:true,current:true,
          status,current_status:status,current_linklab_version:'8',warmup_started_on:'2026-10-29'}),{status:201});
      }})!;
    assert.deepEqual(await(command==='ban'?actions.ban(7,21):actions.replacement(12)),{state:'sent'});
    assert.equal(sends,1);
    assert.ok(f.queries.some(q=>q==='BEGIN READ ONLY'));
    assert.ok(!f.queries.some(q=>/^\s*(UPDATE|INSERT|ALTER|DELETE|CREATE)\b/.test(q)));
  }
});

test('first/unlinked or no-longer-current account never sends, with distinct outcomes',async()=>{
  for(const row of [undefined,{...linked,crm_student_id:null}]){
    const f=fixture(row);let sends=0;
    const a=createAccountCommandActions({pool:f.pool,database:'unicorn_noco_copy_restore',config,
      fetch:async()=>{sends++;throw Error('must not send');}})!;
    assert.equal((await a.ban(7,21)).state,'failed');
    assert.equal((await a.replacement(12)).state,'failed');assert.equal(sends,0);
  }
  const f=fixture({...linked,old_account_id:null,crm_student_id:null});
  const first=createAccountCommandActions({pool:f.pool,database:'unicorn_noco_copy_restore',config,
    fetch:async()=>{throw Error('must not send');}})!;
  assert.equal((await first.replacement(12)).state,'not_applicable');
});

test('accepted intake profile URLs are canonicalized without query/hash and encode Unicode',async()=>{
  for(const url of ['https://www.linkedin.com/in/студент/?trk=profile#details','www.linkedin.com/IN/%D1%81%D1%82%D1%83%D0%B4%D0%B5%D0%BD%D1%82']){
    const f=fixture({...linked,account_url:url});let sent=false;
    const a=createAccountCommandActions({pool:f.pool,database:'unicorn_noco_copy_restore',config,
      fetch:async(_url,init)=>{
        const p=JSON.parse(Buffer.from(init!.body as Uint8Array).toString());sent=true;
        assert.equal(p.account_url,'https://www.linkedin.com/in/%D1%81%D1%82%D1%83%D0%B4%D0%B5%D0%BD%D1%82');
        return new Response('',{status:409});
      }})!;
    await a.replacement(12);assert.equal(sent,true);
  }
});

test('a lost reply stays uncertain and never retries or leaks diagnostics',async()=>{
  const f=fixture(linked);let sends=0;
  const a=createAccountCommandActions({pool:f.pool,database:'unicorn_noco_copy_restore',config,
    fetch:async()=>{sends++;throw Error('private token=do-not-return');}})!;
  assert.deepEqual(await a.ban(7,21),{state:'uncertain',code:'crm_account_command_delivery_uncertain'});
  assert.equal(sends,1);
});
