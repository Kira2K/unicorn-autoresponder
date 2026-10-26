// Optional embedded PostgreSQL validation. No ENV, network or existing database access.
// npm install --prefix storage/mentor-bot-validation --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import type {SqlPool,SqlResult} from '../../postgres/contracts.mts';
import {COPY_MARKER} from '../../postgres/contracts.mts';
import {preparePilotDatabase,checkPilotDatabase,inspectPilotClient} from './pilot-database.mts';
import {postgresStore} from './postgres-store.mts';
import {createMentorService} from './service.mts';
import {enroll} from './schedule.mts';
import {deliver} from './delivery.mts';
import {postgresLock} from './postgres-lock.mts';
import type {PilotScope} from './pilot-scope.mts';

test('embedded PostgreSQL: pilot setup, role grants, scoped trigger, real transitions and rollback',async t=>{
  const require=createRequire(new URL('../../../../storage/mentor-bot-validation/package.json',import.meta.url));
  let module:{PGlite:new()=>{query(sql:string,values?:unknown[]):Promise<SqlResult>;exec(sql:string):Promise<unknown>;close():Promise<void>}};
  try{module=require('@electric-sql/pglite');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='MODULE_NOT_FOUND')throw error;
    t.skip('Optional isolated PGlite fixture not installed.');return;}
  const db=new module.PGlite();
  // PGlite has a fixed database name. Only the identity projection is adapted; all DDL, grants,
  // row locks, triggers, transactions, constraints and data queries run in PostgreSQL itself.
  const pool:SqlPool={async connect(){return {release(){},async query(sql,values=[]){
    sql=sql.replaceAll('current_database() AS database',"'unicorn_noco_copy_restore' AS database");
    if(!values.length&&sql.includes(';')){await db.exec(sql);return {rows:[]};}
    try{return await db.query(sql,values);}catch(error){
      t.diagnostic(JSON.stringify({query:sql,code:(error as {code?:string}).code,message:(error as Error).message}));throw error;
    }
  }};},async end(){}};
  const pilot:PilotScope={clientId:'204',binding:'native-fixture',studentUsername:'teststudent',chatId:'-100',reportChatId:'-900',
    hardMentor:'@testhard',softMentor:'@testsoft',useTestChat:true};
  const gate={database:'unicorn_noco_copy_restore' as const,environment:'local-test' as const,pilot};
  try{
    await db.exec(`COMMENT ON DATABASE postgres IS '${COPY_MARKER}';
      CREATE ROLE unicorn_noco_copy_owner; CREATE ROLE test_app;
      GRANT unicorn_noco_copy_owner TO test_app;
      GRANT CREATE ON DATABASE postgres TO unicorn_noco_copy_owner;
      SET ROLE unicorn_noco_copy_owner;
      CREATE SCHEMA noco;
      CREATE TABLE noco.stacks(id bigint PRIMARY KEY,name text,__nc_deleted boolean);
      CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_name text,client_status text,market_id bigint,
        telegram_general_chat_id text,telegram_personal_chat_id text,"01_stacks_id" bigint,__nc_deleted boolean,
        tg_hard_mentor text,tg_soft_mentor text);
      INSERT INTO noco.stacks VALUES(1,'Synthetic',false);
      INSERT INTO noco.clients VALUES(204,'Synthetic test','onboarding',1,'777777777','@realfixture',1,false,'@canonicalhard','@canonicalsoft'),
        (205,'Untouched','studying',2,'-200','@otherfixture',1,false,'@otherhard','@othersoft');
      GRANT USAGE ON SCHEMA noco TO test_app;
      GRANT SELECT ON noco.clients,noco.stacks TO test_app;
      GRANT UPDATE(client_status,market_id,tg_hard_mentor,tg_soft_mentor) ON noco.clients TO test_app;
      RESET ROLE; SET ROLE test_app; SET search_path=pg_catalog;`);
    const beforeSetup=(await db.query('SELECT to_jsonb(c) AS row FROM noco.clients c ORDER BY id')).rows;
    assert.equal((await inspectPilotClient({query:(sql,values)=>db.query(sql,values)},{...pilot,useTestChat:false})).chatSafe,false);
    assert.equal((await checkPilotDatabase(pool,gate.database,pilot)).ready,false);
    await preparePilotDatabase(pool,gate.database,pilot);
    await preparePilotDatabase(pool,gate.database,pilot);
    assert.deepEqual((await db.query('SELECT to_jsonb(c) AS row FROM noco.clients c ORDER BY id')).rows,beforeSetup);
    assert.equal((await checkPilotDatabase(pool,gate.database,pilot)).ready,true);
    const store=postgresStore(pool,gate);
    const lock=postgresLock(pool,gate);
    assert.equal(await lock.acquire(),true);await lock.assertHeld();await lock.release();
    await store.cursor!.advance(17);await store.cursor!.advance(14);assert.equal(await store.cursor!.read(),17);
    await store.transaction(s=>{enroll(s,'204',Date.now());s.learners['204'].hardCompletedAt=Date.now()-1000;});
    let updateId=0,sessionId=0;
    const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:Date.now,id:()=> 'session'+(++sessionId),
      log:event=>t.diagnostic(JSON.stringify(event))});
    async function confirm(command:string,action?:string){
      assert.equal((await service.handle({username:'testmentor',userId:2,chatId:'-100',updateId:++updateId,text:command})).code,'ok');
      let session=await store.transaction(s=>{
        const session=Object.values(s.sessions).find(row=>row.owner==='testmentor')!;
        session.messageId=7;return session;
      });
      if(action){
        assert.equal((await service.handle({username:'testmentor',userId:2,chatId:'-100',updateId:++updateId,messageId:7,
          callback:'m:'+session.id+':'+session.revision+':'+action})).code,'ok');
        assert.equal((await db.query('SELECT client_status FROM noco.clients WHERE id=204')).rows[0].client_status,'onboarding');
        session=await store.transaction(s=>s.sessions[session.id]);
      }
      const input={username:'testmentor',userId:2,chatId:'-100',updateId:++updateId,messageId:7,
        callback:'m:'+session.id+':'+session.revision+':confirm'};
      assert.equal((await service.handle(input)).code,'ok');
      assert.equal((await service.handle(input)).code,'duplicate');
    }
    await confirm('/menu','onboarding');
    const studied=(await db.query('SELECT client_status,market_id FROM noco.clients WHERE id=204')).rows[0];
    assert.equal(studied.client_status,'studying');assert.equal(Number(studied.market_id),1);
    assert.equal(await store.transaction(s=>s.learners['204'].hardCompletedAt),undefined);
    await confirm('/market_ru');
    assert.equal((await db.query('SELECT client_status FROM noco.clients WHERE id=204')).rows[0].client_status,'hh_ru process');
    await confirm('/responses_started');
    assert.equal((await db.query('SELECT client_status FROM noco.clients WHERE id=204')).rows[0].client_status,'on ru market');
    const history=await db.query('SELECT client_id,old_status,new_status FROM mentor_bot_pilot_204.status_history ORDER BY id');
    assert.deepEqual(history.rows.map(r=>r.new_status),['studying','hh_ru process','on ru market']);
    assert.ok(history.rows.every(r=>Number(r.client_id)===204));
    await confirm('/market_both');
    assert.equal((await db.query('SELECT client_status FROM noco.clients WHERE id=204')).rows[0].client_status,'hh_both process');
    await confirm('/responses_started');
    const both=(await db.query('SELECT client_status,market_id FROM noco.clients WHERE id=204')).rows[0];
    assert.equal(both.client_status,'on en market');assert.equal(Number(both.market_id),3);
    const bothHistory=await db.query('SELECT client_id,old_status,new_status FROM mentor_bot_pilot_204.status_history ORDER BY id');
    assert.deepEqual(bothHistory.rows.slice(-2).map(r=>[r.old_status,r.new_status]),
      [['on ru market','hh_both process'],['hh_both process','on en market']]);
    assert.ok(bothHistory.rows.every(r=>Number(r.client_id)===204));
    assert.equal((await db.query('SELECT client_status FROM noco.clients WHERE id=205')).rows[0].client_status,'studying');
    assert.equal((await db.query('SELECT telegram_personal_chat_id FROM noco.clients WHERE id=204')).rows[0].telegram_personal_chat_id,'@realfixture');
    assert.equal((await db.query('SELECT telegram_general_chat_id FROM noco.clients WHERE id=204')).rows[0].telegram_general_chat_id,'777777777');
    for(const type of ['hard','soft'] as const){
      const actor={username:'testmentor',userId:2,chatId:'-100'},column=type==='hard'?'tg_hard_mentor':'tg_soft_mentor';
      await service.handle({...actor,updateId:++updateId,text:'/change_mentor'});
      let session=await store.transaction(s=>{
        const session=Object.values(s.sessions).find(row=>row.owner==='testmentor')!;session.messageId=7;return session;
      });
      await service.handle({...actor,updateId:++updateId,messageId:7,callback:'m:'+session.id+':'+session.revision+':'+type+'-type'});
      await service.handle({...actor,updateId:++updateId,text:'@REPLACEMENT'+type.toUpperCase()});
      assert.equal((await db.query('SELECT '+column+' FROM noco.clients WHERE id=204')).rows[0][column],'@canonical'+type);
      session=await store.transaction(s=>s.sessions[session.id]);
      const input={...actor,updateId:++updateId,messageId:7,callback:'m:'+session.id+':'+session.revision+':confirm'};
      assert.equal((await service.handle(input)).code,'ok');assert.equal((await service.handle(input)).code,'duplicate');
      assert.equal((await db.query('SELECT '+column+' FROM noco.clients WHERE id=204')).rows[0][column],'@replacement'+type);
    }
    assert.equal(await postgresStore(pool,gate).transaction(s=>s.clients['204'].softMentor),'@replacementsoft');
    assert.deepEqual((await db.query('SELECT to_jsonb(c) AS row FROM noco.clients c WHERE id=205')).rows[0],beforeSetup[1]);
    await db.exec('RESET ROLE; REVOKE unicorn_noco_copy_owner FROM test_app; SET ROLE unicorn_noco_copy_owner; REVOKE UPDATE(tg_hard_mentor,tg_soft_mentor) ON noco.clients FROM test_app; RESET ROLE; SET ROLE test_app;');
    assert.equal((await checkPilotDatabase(pool,gate.database,pilot)).canUpdateClient,false);
    assert.equal((await checkPilotDatabase(pool,gate.database,pilot)).ready,false);
    await assert.rejects(store.transaction(s=>{s.clients['204'].hardMentor='@denied';}));
    assert.equal((await db.query('SELECT tg_hard_mentor FROM noco.clients WHERE id=204')).rows[0].tg_hard_mentor,'@replacementhard');
    await db.exec('RESET ROLE; GRANT unicorn_noco_copy_owner TO test_app; SET ROLE unicorn_noco_copy_owner; GRANT UPDATE(tg_hard_mentor,tg_soft_mentor) ON noco.clients TO test_app; RESET ROLE; SET ROLE test_app;');
    const destinations:string[]=[];
    await deliver({store,now:Date.now,send:async input=>{
      destinations.push(input.chatId);
      return {kind:'telegram-response',response:{ok:true,result:{message_id:9,date:1,
        chat:{id:Number(input.chatId),type:'group',title:'Synthetic'},text:input.text}}};
    }});
    assert.ok(destinations.length>0);assert.ok(destinations.every(chat=>chat==='-100'||chat==='-900'));
    // An external edit of another synthetic client cannot enter this pilot's history.
    await db.query("UPDATE noco.clients SET client_status='paused' WHERE id=205");
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM mentor_bot_pilot_204.status_history')).rows[0].n,5);
    await preparePilotDatabase(pool,gate.database,pilot);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM mentor_bot_pilot_204.status_history')).rows[0].n,5);
    await db.exec('SET ROLE unicorn_noco_copy_owner; DROP TRIGGER mentor_pilot_204_status_history ON noco.clients; RESET ROLE; SET ROLE test_app;');
    await assert.rejects(store.transaction(s=>{s.clients['204'].status='hh_en process';s.clients['204'].market='both';}));
    const unchanged=(await db.query('SELECT client_status,market_id FROM noco.clients WHERE id=204')).rows[0];
    assert.equal(unchanged.client_status,'on en market');assert.equal(Number(unchanged.market_id),3);
  }finally{await db.close();}
});
