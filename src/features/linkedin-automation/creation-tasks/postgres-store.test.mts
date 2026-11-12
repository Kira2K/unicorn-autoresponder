import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_MARKER } from '../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../integrations/postgres/contracts.mts';
import { createCreationTaskStore } from './postgres-store.mts';
test('client list summaries use one read-only query and return only names and stacks',async()=>{
 const calls:{sql:string,values:unknown[]}[]=[];
 const pool={end:async()=>{},connect:async()=>({release(){},async query(sql:string,values:unknown[]=[]){
  calls.push({sql,values});
  return{rows:sql.includes('current_database()')?[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]:
   sql.includes('FROM noco.clients c')?[{id:'901',fio:'Тест Ученик',stack:'JAVA',password:'must-not-leak'},{id:'902',fio:'Второй Ученик',stack:null}]:[]};
 }})}as SqlPool;
 const store=createCreationTaskStore(pool,'unicorn_noco_copy_restore');
 assert.deepEqual(await store.clientSummaries([]),[]);assert.equal(calls.length,0);
 assert.deepEqual(await store.clientSummaries([901,902]),[{id:901,fio:'Тест Ученик',stack:'JAVA'},{id:902,fio:'Второй Ученик',stack:undefined}]);
 const summaries=calls.filter(c=>c.sql.includes('FROM noco.clients c'));
 assert.equal(summaries.length,1);assert.deepEqual(summaries[0].values,[[901,902]]);
 assert.ok(!calls.some(c=>/^\s*(UPDATE|INSERT|DELETE)\b/i.test(c.sql)));
});
function fixture(afterComplete?:(taskId:number)=>Promise<unknown>) {
  const initial={task:{id:1,client_id:901,linkedin_account_id:11,outlook_account_id:12,source:'student_intake',status:'не начата',version:1,
    created_at:new Date(),updated_at:new Date(),proxy_profile_id:2 as number|null,proxy_uuid:'proxy' as string|null,proxy_saved_at:new Date() as Date|null},
    li:{id:11,url:'https://linkedin.com/in/test',login:'test',password:'secret'},
    mail:{id:12,login:'mail@outlook.com',password:'mail-secret'},
    archived:[] as Record<string,unknown>[],
    profile:{revision:4,state:{phase:'ready',proxy:{uuid:'proxy'},grant:undefined as undefined|{phase:string},proxyChange:undefined as undefined|{phase:string}}}};
  let state=structuredClone(initial),backup=structuredClone(state),uncertain=false;
  const calls:string[]=[];
  const pool={end:async()=>{},connect:async()=>({release(){},async query(sql:string,v:unknown[]=[]){
    calls.push(sql);
    if(sql.includes('current_database()'))return{rows:[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]};
    if(sql.startsWith('BEGIN')){backup=structuredClone(state);return{rows:[]};}
    if(sql==='ROLLBACK'){state=structuredClone(backup);return{rows:[]};}
    if(sql==='COMMIT'){backup=structuredClone(state);if(uncertain){uncertain=false;throw Error('ack lost');}return{rows:[]};}
    if(sql.startsWith('SELECT client_id FROM'))return{rows:[{client_id:901}]};
    if(sql.includes('FROM noco.linkedin_creation_task'))return{rows:state.task.status==='сделана экспертом'&&sql.includes("status<>")?[]:[structuredClone(state.task)]};
    if(sql.includes('FROM noco.octo_profiles'))return{rows:[structuredClone(state.profile)]};
    if(sql.includes('FROM noco.platform_accounts a JOIN noco.platforms'))return{rows:structuredClone(state.archived)};
    if(sql.includes('FROM noco.platform_accounts'))return{rows:sql.includes('ANY')?[structuredClone(state.li),structuredClone(state.mail)]:[structuredClone(state.li)]};
    if(sql.startsWith('UPDATE noco.platform_accounts')){state.li={...state.li,url:String(v[1]),login:String(v[2]),password:v[3]?String(v[3]):state.li.password};return{rows:[]};}
    if(sql.startsWith('UPDATE noco.linkedin_creation_task')) {
      state.task.version++;
      if(sql.includes('SET status='))state.task.status=String(v[1]);
      if(sql.includes('SET proxy_profile_id=')){state.task.proxy_profile_id=Number(v[1]);state.task.proxy_uuid=String(v[2]);state.task.proxy_saved_at=new Date();}
      return{rows:[structuredClone(state.task)]};
    }
    return{rows:[]};
  }})} as SqlPool;
  return{store:createCreationTaskStore(pool,'unicorn_noco_copy_restore',false,afterComplete),get state(){return state;},calls,uncertain(){uncertain=true;}};
}

test('the existing CRM completion hook runs only after the first known commit, never on a replay or unknown commit',async()=>{
 let hooks=0;const f=fixture(async id=>{assert.equal(id,1);assert.equal(f.state.task.status,'сделана экспертом');hooks++;});
 await f.store.status(1,1,'сделана экспертом');await f.store.status(1,1,'сделана экспертом');assert.equal(hooks,1);
 const uncertain=fixture(async()=>{hooks++;});uncertain.uncertain();
 await assert.rejects(uncertain.store.status(1,1,'сделана экспертом'),{code:'commit_uncertain'});
 await uncertain.store.status(1,1,'сделана экспертом');assert.equal(hooks,1);
});

test('completion is final, hidden from Denis and idempotent even with an old version or a later active grant',async()=>{
 const f=fixture();f.state.profile.state.grant={phase:'granted'};
 const done=await f.store.status(1,1,'сделана экспертом');
 const writes=f.calls.filter(sql=>sql.includes('SET status=')).length;
 f.state.profile.state.grant={phase:'granted'};
 assert.deepEqual(await f.store.status(1,1,'сделана экспертом'),done);
 assert.equal(f.calls.filter(sql=>sql.includes('SET status=')).length,writes);
 await assert.rejects(f.store.status(1,done.version,'блок'),{code:'linkedin_task_completed'});
 await assert.rejects(f.store.detail(1),{code:'linkedin_task_not_found'});
 assert.equal((await f.store.detail(1,true)).task.status,'сделана экспертом');
});

test('completion atomically saves the checked proxy receipt and rolls it back when result is incomplete',async()=>{
 for(const incomplete of [false,true]){
  const f=fixture();f.state.task.proxy_saved_at=null;f.state.task.proxy_profile_id=null;f.state.task.proxy_uuid=null;
  if(incomplete)f.state.li.password='';
  const proof={profileId:2,proxyUuid:'proxy',revision:4};
  if(incomplete){await assert.rejects(f.store.status(1,1,'сделана экспертом',proof));assert.equal(f.state.task.proxy_saved_at,null);assert.equal(f.state.task.status,'не начата');}
  else{const done=await f.store.status(1,1,'сделана экспертом',proof);assert.equal(done.status,'сделана экспертом');assert.equal(done.proxyUuid,'proxy');assert.ok(done.proxySavedAt);}
 }
});

test('automatic completion receipt rejects an outdated revision or different proxy',async()=>{
 for(const kind of ['revision','proxy']){
  const f=fixture();f.state.task.proxy_saved_at=null;
  await assert.rejects(f.store.status(1,1,'сделана экспертом',{profileId:2,proxyUuid:kind==='proxy'?'other':'proxy',revision:kind==='revision'?3:4}));
  assert.equal(f.state.task.status,'не начата');assert.equal(f.state.task.proxy_saved_at,null);
 }
});

test('atomic completion accepts active access but leaves its cleanup state untouched; explicit receipt remains idle-only',async()=>{
 for(const phase of ['preparing','granted','awaiting_close','blocked']){
  const f=fixture();f.state.task.proxy_saved_at=null;f.state.profile.state.grant=Object.assign({phase},{id:'g',pending:'clear',bridgeClear:{result:{state:'succeeded'}}});
  const before=structuredClone(f.state.profile);
  await assert.rejects(f.store.receipt(1,1,2,'proxy',4),{code:'linkedin_task_proxy_changed'});
  assert.equal((await f.store.status(1,1,'сделана экспертом',{profileId:2,proxyUuid:'proxy',revision:4})).status,'сделана экспертом');
  assert.deepEqual(f.state.profile,before);
 }
});

test('a committed unknown completion is read back without starting another cycle',async()=>{
 const f=fixture();f.uncertain();
 await assert.rejects(f.store.status(1,1,'сделана экспертом'),{code:'commit_uncertain'});
 assert.equal(f.state.task.status,'сделана экспертом');
 const writes=f.calls.filter(sql=>sql.includes('SET status=')).length;
 assert.equal((await f.store.status(1,1,'сделана экспертом')).status,'сделана экспертом');
 assert.equal(f.calls.filter(sql=>sql.includes('SET status=')).length,writes);
});

test('expert and admin detail return Outlook creation time without account passwords',async()=>{
  const f=fixture();Object.assign(f.state.mail,{outlook_registered_at:new Date('2026-10-25T10:30:00.000Z')});
  const detail=await f.store.detail(1);
  assert.equal(detail.intake.outlookRegisteredAt,'2026-10-25T10:30:00.000Z');
  assert.ok(!JSON.stringify(detail).includes('mail-secret'));
});

test('Denis detail includes the archived account alongside the current submitted blocked history',async()=>{
  const f=fixture();
  const entered={fullName:'Earlier account',country:'Poland'};
  Object.assign(f.state.li,{old_link_blocked:JSON.stringify([entered])});
  f.state.archived.push({id:5,linkedin_first_name:'Alex',linkedin_last_name:'Smith',
    url:'https://linkedin.com/in/previous',old_link_blocked:JSON.stringify([entered])});
  const before=structuredClone(f.state);
  const detail=await f.store.detail(1);
  assert.equal(detail.intake.blockedAccounts.length,2);
  assert.deepEqual(detail.intake.blockedAccounts[0],entered);
  assert.equal(detail.intake.blockedAccounts[1].fullName,'Alex Smith');
  assert.match(detail.intake.blockedAccounts[1].legacyText!,/https:\/\/linkedin.com\/in\/previous/);
  assert.deepEqual(f.state,before);
  assert.ok(!JSON.stringify(detail).includes('mail-secret'));
  assert.ok(!JSON.stringify(detail).includes('"password"'));
});
test('completion requires result and matching saved proxy; active grants and stale edits cannot bypass it',async()=>{
  for(const variant of ['receipt','proxy','pending','password','url']){
    const f=fixture();
    if(variant==='receipt')f.state.task.proxy_saved_at=null;
    if(variant==='proxy')f.state.profile.state.proxy.uuid='other';
    if(variant==='pending')f.state.profile.state.proxyChange={phase:'queued'};
    if(variant==='password')f.state.li.password='';
    if(variant==='url')f.state.li.url='';
    await assert.rejects(f.store.status(1,1,'сделана экспертом'));assert.equal(f.state.task.status,'не начата');
    assert.ok(!f.calls.some(sql=>sql.startsWith('UPDATE noco.linkedin_creation_task')));
  }
  const f=fixture();await assert.rejects(f.store.status(1,2,'блок'),{code:'linkedin_task_stale_version'});
  await assert.rejects(f.store.status(1,1,'выполнение подтверждено'),{code:'linkedin_task_invalid_status'});
  const done=await f.store.status(1,1,'сделана экспертом');assert.equal(done.status,'сделана экспертом');
  assert.equal((await f.store.list()).length,0,'expert completion leaves the queue');
  await assert.rejects(f.store.detail(1),{code:'linkedin_task_not_found'});
  await assert.rejects(f.store.result(1,2,{url:'https://linkedin.com/in/a',login:'a'}),{code:'linkedin_task_not_found'});
});
test('expert result uses the existing platform account, preserves blank password, and serializes stale saves',async()=>{
  const f=fixture();
  const task=await f.store.result(1,1,{url:'https://linkedin.com/in/new',login:'new',password:''});
  assert.equal(task.version,2);assert.equal(f.state.li.password,'secret');assert.equal(f.state.li.login,'new');
  assert.equal(f.state.li.id,11);
  await assert.rejects(f.store.result(1,1,{url:'https://linkedin.com/in/stale',login:'stale'}),{code:'linkedin_task_stale_version'});
  assert.equal(f.state.li.login,'new');
  assert.ok(f.calls.indexOf('SELECT id FROM noco.clients WHERE id=$1 FOR UPDATE')<f.calls.findIndex(sql=>sql.startsWith('UPDATE noco.platform_accounts')));
  const detail=await f.store.detail(1);assert.ok(!JSON.stringify(detail).includes('mail-secret'));assert.ok(!Object.hasOwn(detail.intake,'password'));
});
test('proxy receipt is committed only for the verified profile revision; unknown COMMIT is not retried',async()=>{
  const f=fixture();
  await assert.rejects(f.store.receipt(1,1,2,'proxy',3),{code:'linkedin_task_proxy_changed'});
  const task=await f.store.receipt(1,1,2,'proxy',4);assert.equal(task.version,2);
  f.uncertain();await assert.rejects(f.store.status(1,2,'блок'),{code:'commit_uncertain'});
  assert.equal(f.state.task.status,'блок');
  const updates=f.calls.filter(sql=>sql.includes('SET status=')).length;
  await assert.rejects(f.store.status(1,2,'блок'),{code:'linkedin_task_stale_version'});
  assert.equal(f.calls.filter(sql=>sql.includes('SET status=')).length,updates);
});

test('saving the same status is a version-checked no-op, including after reopening a completed task',async()=>{
  const f=fixture();
  assert.equal((await f.store.status(1,1,'не начата')).version,1);
  assert.equal(f.calls.filter(sql=>sql.includes('SET status=')).length,0);
  const done=await f.store.status(1,1,'сделана экспертом');
  f.state.profile.state.grant={phase:'granted'};
  assert.deepEqual(await f.store.status(1,done.version,'сделана экспертом'),done);
  assert.equal(f.calls.filter(sql=>sql.includes('SET status=')).length,1);
  assert.deepEqual(await f.store.status(1,1,'сделана экспертом'),done);
});
