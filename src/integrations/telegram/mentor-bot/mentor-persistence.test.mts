import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Delivery} from './types.mts';
import {postgresStore} from './postgres-store.mts';
import {sqlTestPool} from './sql-test-pool.mts';
import {enroll} from './schedule.mts';
import {START} from './test-fixtures.mts';
import {createMentorService} from './service.mts';
import {pilotStaffAllowed} from './pilot-staff-access.mts';

const pilot={clientId:'1',binding:'mentor-write-fixture',studentUsername:'alice',chatId:'-100',reportChatId:'-900',
  hardMentor:'@testhard',softMentor:'@testsoft'};
const gate={database:'mentor_bot_test',environment:'local-test' as const,pilot};
const fixture=()=>sqlTestPool({pilot,extraClients:[{id:'2',client_name:'Untouched',client_status:'studying',
  tg_hard_mentor:'@otherhard',tg_soft_mentor:'@othersoft',market_id:2}]});

test('SQL mentor reads use canonical fields despite legacy runtime values and test-role defaults',async()=>{
  const f=fixture(),db=await f.pool.connect();
  try{await db.query('UPDATE mentor_bot_pilot_1.runtime SET mentor_overrides=$1::jsonb WHERE singleton',
    [JSON.stringify({hardMentor:'@legacyhard',softMentor:'@legacysoft'})]);}finally{db.release();}
  const store=postgresStore(f.pool,gate);
  assert.deepEqual(await store.transaction(s=>[s.clients['1'].hardMentor,s.clients['1'].softMentor]),['@hardmentor','@softmentor']);
  await store.transaction(s=>{s.clients['1'].hardMentor='';});
  assert.equal(await postgresStore(f.pool,gate).transaction(s=>s.clients['1'].hardMentor),'');
  assert.deepEqual(f.snapshot().mentors,{hardMentor:'@legacyhard',softMentor:'@legacysoft'});
});

for(const type of ['hard','soft'] as const)for(const failure of ['none','beforeWrite','loseCommitReply'] as const){
  test(`SQL pilot: confirmed ${type} mentor writes only its canonical column, audit and messages; failure=${failure}`,async()=>{
    const f=fixture(),store=postgresStore(f.pool,gate),field=type==='hard'?'hardMentor':'softMentor',
      column=type==='hard'?'tg_hard_mentor':'tg_soft_mentor';
    await store.transaction(s=>enroll(s,'1',START));
    const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>START,id:()=> 'mentor'});
    let updateId=0;
    const actor={username:'support',userId:3,chatId:'-100'};
    assert.equal((await service.handle({...actor,updateId:++updateId,text:'/change_mentor'})).code,'ok');
    await store.transaction(s=>{s.sessions.mentor.messageId=7;});
    const click=async(control:string)=>{
      const s=await store.transaction(s=>s.sessions.mentor);
      return service.handle({...actor,updateId:++updateId,messageId:7,callback:'m:'+s.id+':'+s.revision+':'+control});
    };
    assert.equal((await click(type+'-type')).code,'ok');
    assert.equal((await service.handle({...actor,updateId:++updateId,text:'@NEWMENTOR'})).code,'ok');
    assert.equal(f.snapshot().clients[0][column],type==='hard'?'@hardmentor':'@softmentor');
    assert.deepEqual(f.snapshot().tables.history,{});
    assert.equal((await click('cancel')).code,'ok');
    assert.equal(f.snapshot().clients[0][column],type==='hard'?'@hardmentor':'@softmentor');
    assert.equal((await service.handle({...actor,updateId:++updateId,text:'/change_mentor'})).code,'ok');
    await store.transaction(s=>{s.sessions.mentor.messageId=7;});
    await click(type+'-type');await service.handle({...actor,updateId:++updateId,text:'@NEWMENTOR'});
    const session=await store.transaction(s=>s.sessions.mentor),before=f.snapshot(),queryCount=f.queries.length;
    if(failure!=='none')f.fault[failure]=true;
    const input={...actor,updateId:++updateId,messageId:7,callback:'m:'+session.id+':'+session.revision+':confirm'};
    const result=await service.handle(input),saved=f.snapshot();
    if(failure==='beforeWrite'){
      assert.equal(result.error,'saveFailed');assert.deepEqual(saved,before);
    }else{
      assert.equal(result.code,failure==='none'?'ok':'unavailable');
      if(failure==='loseCommitReply')assert.equal(result.error,'saveUncertain');
      assert.deepEqual(saved.clients,[{...before.clients[0],[column]:'@newmentor'},before.clients[1]]);
      assert.equal(saved.events.length,before.events.length);
      assert.equal(Object.keys(saved.tables.history).length,1);
      assert.deepEqual(f.queries.slice(queryCount).filter(q=>q.startsWith('UPDATE noco.clients')),
        ['UPDATE noco.clients SET '+column+'=$2 WHERE id=$1 AND NOT COALESCE(__nc_deleted,false) RETURNING id']);
      const messages=Object.values(saved.tables.deliveries) as Delivery[];
      assert.equal(messages.filter(d=>d.template?.type==='mentor-notice').length,1);
      assert.equal(messages.filter(d=>d.template?.type==='mentor-report').length,1);
      const reopened=postgresStore(f.pool,gate);
      assert.equal(await reopened.transaction(s=>s.clients['1'][field]),'@newmentor');
      const accessConfig={studentUsername:'alice',botUsername:'mentor_test_bot',staffUsernames:['support']};
      assert.equal(await reopened.transaction(s=>pilotStaffAllowed(accessConfig,s.clients['1'],'newmentor')),true);
      assert.equal(await reopened.transaction(s=>pilotStaffAllowed(accessConfig,s.clients['1'],type==='hard'?'hardmentor':'softmentor')),false);
      const nextService=createMentorService({store:reopened,member:async()=>true,reportChatId:'-900',now:()=>START});
      assert.equal((await nextService.handle(input)).code,'duplicate');
      assert.equal(Object.keys(f.snapshot().tables.history).length,1);
    }
  });
}

test('an external canonical mentor edit invalidates a draft and students cannot change mentors',async()=>{
  const f=fixture(),store=postgresStore(f.pool,gate);
  await store.transaction(s=>enroll(s,'1',START));
  const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>START,id:()=> 'mentor'});
  assert.equal((await service.handle({username:'alice',userId:1,chatId:'-100',updateId:1,text:'/change_mentor'})).code,'denied');
  await service.handle({username:'support',userId:3,chatId:'-100',updateId:2,text:'/change_mentor'});
  await store.transaction(s=>{s.sessions.mentor.messageId=7;});
  let session=await store.transaction(s=>s.sessions.mentor);
  await service.handle({username:'support',userId:3,chatId:'-100',updateId:3,messageId:7,
    callback:'m:'+session.id+':'+session.revision+':soft-type'});
  await service.handle({username:'support',userId:3,chatId:'-100',updateId:4,text:'@draftmentor'});
  session=await store.transaction(s=>s.sessions.mentor);
  const db=await f.pool.connect();
  try{await db.query('UPDATE noco.clients SET tg_soft_mentor=$2 WHERE id=$1 RETURNING id',['1','@external']);}
  finally{db.release();}
  assert.equal((await service.handle({username:'support',userId:3,chatId:'-100',updateId:5,messageId:7,
    callback:'m:'+session.id+':'+session.revision+':confirm'})).code,'stale');
  assert.equal(f.snapshot().clients[0].tg_soft_mentor,'@external');assert.deepEqual(f.snapshot().tables.history,{});
});
