import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {COPY_MARKER} from '../../../integrations/postgres/contracts.mts';
import {createLinkedInIntakeStore} from '../console-intake/postgres-store.mts';
import {createLinkedInIntakeService} from '../console-intake/service.mts';
import {createCreationTaskStore} from '../creation-tasks/postgres-store.mts';
import {createCreationTaskService} from '../creation-tasks/service.mts';
import {mockClient} from '../../octo-access/testing.mts';
import {createAccountCommandActions,readAccountCommandConfig} from './crm-account-actions.mts';
import {sendAccountCommand} from './crm-account-command.mts';
const require=createRequire(import.meta.url),{Client,Pool}=require('pg'),express=require('express');
const {registerLinkedInIntakeRoutes}=require('../../web-console/backend/linkedin-intake-routes.ts');
const {registerAdminCreationTaskRoutes}=require('../../web-console/backend/linkedin-admin-creation-routes.ts');
const file=process.env.CRM_ACCOUNT_ACTIONS_TEST_CONFIG;

test('disabled actions perform no SQL/HTTP; enabled configuration must be complete',()=>{
  assert.equal(readAccountCommandConfig({}),undefined);
  assert.equal(createAccountCommandActions({pool:{connect:async()=>{throw Error('must not connect');},end:async()=>{}},database:'unicorn_noco_copy_restore'}),undefined);
  assert.throws(()=>readAccountCommandConfig({CRM_ACCOUNT_COMMANDS_ENABLED:'1'}),/configuration_required/);
});

test('button HTTP → committed source SQL → real CRM command handler',{skip:!file,timeout:180_000},async()=>{
  const cfg=JSON.parse(readFileSync(file!,'utf8'));
  assert.equal(cfg.local_proof,true);assert.equal(cfg.host,'127.0.0.1');assert.equal(cfg.database,'unicorn_noco_copy_restore');
  assert.equal(new URL(cfg.crm_url).hostname,'127.0.0.1');assert.equal(new URL(cfg.crm_url).protocol,'http:');
  const db=new Client({host:cfg.host,port:cfg.port,user:cfg.user,database:cfg.database});await db.connect();
  const pool=new Pool({host:cfg.host,port:cfg.port,user:cfg.user,database:cfg.database,max:4});
  const q=(sql:string,values:unknown[]=[])=>db.query(sql,values);
  const control=async(action:string,p:Record<string,unknown>={})=>{
    const r=await fetch(cfg.crm_url+'/__synthetic/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:'101',...p})});
    assert.equal(r.status,200,await r.clone().text());return r.json() as Promise<any>;
  };
  const student='10000000-0000-4000-8000-000000000001',captures:{body:Buffer;status:number}[]=[],warnings:unknown[]=[];
  let verifyCommitted=true;
  const transport:typeof fetch=async(url,init)=>{
    const body=Buffer.from(init!.body as Uint8Array),event=JSON.parse(body.toString());
    const current=(await q('SELECT a.is_banned,l.platform_account_id FROM noco.linklab l JOIN noco.platform_accounts a ON a.id=l.platform_account_id WHERE l.client_id=$1',[event.client_id])).rows[0];
    if(verifyCommitted){
      assert.equal(current.platform_account_id,event.account_id,'another connection sees committed identity');
      if(event.command==='ban')assert.equal(current.is_banned,true);
      else assert.ok((await q('SELECT applied_at FROM noco.linkedin_account_cycles WHERE task_id=$1',[event.cycle_id])).rows[0].applied_at);
    }
    const reply=await fetch(cfg.crm_url+new URL(String(url)).pathname,init);captures.push({body,status:reply.status});return reply;
  };
  const options={baseUrl:'https://synthetic-crm.example.test',secret:cfg.secret,fetch:transport};
  const actions=createAccountCommandActions({pool,database:'unicorn_noco_copy_restore',config:options,fetch:transport,report:e=>warnings.push(e)})!;
  let server:any,owned=false;
  try{
    assert.equal((await q("SELECT to_regnamespace('noco') AS ns")).rows[0].ns,null,'never replace an existing schema');
    await q(`COMMENT ON DATABASE unicorn_noco_copy_restore IS '${COPY_MARKER}';CREATE ROLE unicorn_sql_app;CREATE SCHEMA noco;
      CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_name text,__nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text,__nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,clients_id bigint REFERENCES noco.clients(id),platforms_id bigint REFERENCES noco.platforms(id),
        url text,login text,password text,__nc_deleted boolean DEFAULT false,linkedin_first_name text,linkedin_last_name text,real_location text,
        old_link_blocked text,outlook_registered_at timestamptz,updated_at timestamptz DEFAULT clock_timestamp());
      CREATE TABLE noco.octo_profiles(profile_id bigint PRIMARY KEY,client_id bigint REFERENCES noco.clients(id),locale text,revision bigint,state jsonb);
      CREATE TABLE noco.dolphin_profiles(id bigint PRIMARY KEY,browser text,octo_profile_id text);
      INSERT INTO noco.clients VALUES(101,'Synthetic');INSERT INTO noco.platforms VALUES(16,'LinkedIn'),(31,'email_outlook');
      INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES
        (11,101,16,'https://linkedin.com/in/old','old','fixture'),(12,101,31,'','old@outlook.com','fixture');`);owned=true;
    const migration=(path:string)=>q(readFileSync(new URL(path,import.meta.url),'utf8'));
    for(const name of ['001-status','002-crm-results','003-intake','004-proxy-status','005-credentials-refresh'])await migration('./sql/'+name+'.up.sql');
    await migration('../creation-tasks/sql/001.up.sql');await migration('../creation-tasks/sql/002-new-proxy.up.sql');
    await migration('./sql/006-account-cycle.up.sql');await migration('../creation-tasks/sql/003-denis-workflow.up.sql');
    await q("INSERT INTO noco.linklab(client_id,platform_account_id,status) VALUES(101,11,'Раскачка')");
    await q('UPDATE noco.linklab SET crm_student_id=$1,confirmed_version=version WHERE client_id=101',[student]);
    const before=await control('fixture',{student_id:student,account_id:'11',version:'1'});
    const intake=createLinkedInIntakeService({store:createLinkedInIntakeStore(pool,'unicorn_noco_copy_restore',false,true,actions.ban),
      allowed:()=>true,getClient:async id=>mockClient(id),hasDolphin:async()=>false});
    const profiles:any={list:async(id:number)=>(await q('SELECT profile_id,state FROM noco.octo_profiles WHERE client_id=$1',[id])).rows.map((p:any)=>({id:Number(p.profile_id),locale:'en',proxy:p.state.proxy})),get:async()=>undefined};
    const creator=createCreationTaskService({store:createCreationTaskStore(pool,'unicorn_noco_copy_restore',false,actions.replacement),profiles,
      octo:{} as any,client:async id=>mockClient(id),secrets:async()=>({}),capture:async(p)=>({proxy:p.proxy} as any),nodeMavenKey:()=>''});
    const app=express();app.use(express.json());
    const auth=(req:any,_res:any,next:any)=>{req.webSession={role:req.headers['x-test-role'],clientId:Number(req.headers['x-test-client']||101)};next();};
    registerLinkedInIntakeRoutes(app,auth,intake);registerAdminCreationTaskRoutes(app,auth,creator);
    server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const click=(path:string,body:unknown,role='client',client=101)=>fetch('http://127.0.0.1:'+server.address().port+path,
      {method:'POST',headers:{'content-type':'application/json','x-test-role':role,'x-test-client':String(client)},body:JSON.stringify(body)});
    const banPath='/api/client/linkedin-intake/ban';
    const lossy={end:async()=>{},connect:async()=>{
      const s=await pool.connect();return{release:(destroy?:boolean)=>s.release(destroy),query:async(sql:string,v?:unknown[])=>{
        const result=await s.query(sql,v);if(sql==='COMMIT')throw Error('synthetic lost commit response');return result;
      }};
    }};
    let unexpected=0;
    const lostStore=createLinkedInIntakeStore(lossy,'unicorn_noco_copy_restore',false,true,async()=>{unexpected++;});
    await assert.rejects(lostStore.reportBan(101,11),{code:'commit_uncertain'});assert.equal(unexpected,0);
    assert.equal((await q('SELECT is_banned FROM noco.platform_accounts WHERE id=11')).rows[0].is_banned,true);
    await q('UPDATE noco.platform_accounts SET is_banned=false WHERE id=11');
    assert.equal((await click(banPath,{linkedinAccountId:11},'admin')).status,403);assert.equal(captures.length,0);
    const bans=await Promise.all([click(banPath,{linkedinAccountId:11}),click(banPath,{linkedinAccountId:11})]);
    assert.ok(bans.every(r=>r.status===200));assert.equal(captures.length,1);assert.equal(captures[0].status,201);
    const blocked=await control('probe');assert.equal(blocked.ban_receipts,1);assert.equal(blocked.active_bans,1);
    assert.equal(blocked.warmup_started_on,before.warmup_started_on);assert.equal(blocked.profile_filled,before.profile_filled);
    assert.equal(blocked.open_sessions,0);assert.deepEqual(blocked.done,before.done);
    await sendAccountCommand({body:captures[0].body,expectedStudentId:student},options);assert.equal(captures.at(-1)!.status,200);
    assert.equal((await control('probe')).ban_receipts,1);
    await q(`UPDATE noco.platform_accounts SET __nc_deleted=true WHERE id IN(11,12);
      INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES
      (21,101,16,'https://www.linkedin.com/IN/студент/?trk=profile#details','new','fixture'),(22,101,31,'','new@outlook.com','fixture');
      INSERT INTO noco.octo_profiles VALUES(1,101,'en',1,'{"phase":"ready","proxy":{"uuid":"fixture-proxy"}}');
      INSERT INTO noco.linkedin_creation_task(client_id,linkedin_account_id,outlook_account_id,status,requires_new_proxy,proxy_profile_id,proxy_uuid,proxy_saved_at)
      VALUES(101,21,22,'сделана экспертом',false,1,'fixture-proxy',clock_timestamp());`);
    const task=(await q('SELECT id,version FROM noco.linkedin_creation_task')).rows[0],confirmPath='/api/admin/linkedin-creation/tasks/'+task.id+'/confirm';
    const count=captures.length;
    const confirmations=await Promise.all([click(confirmPath,{version:Number(task.version)},'admin'),click(confirmPath,{version:Number(task.version)},'admin')]);
    assert.ok(confirmations.every(r=>r.status===200));assert.equal(captures.length,count+1);assert.equal(captures.at(-1)!.status,201);
    const recovered=await control('probe');assert.equal(recovered.student_id,student);assert.equal(recovered.account_id,'21');
    assert.equal(recovered.status,'warmup');assert.equal(recovered.profile_filled,0);assert.equal(recovered.ssi_current,0);assert.equal(recovered.ssi_history,before.ssi_history);
    assert.deepEqual(recovered.done.map((d:any)=>[d.estimated_minutes,d.operator_added_minutes]),before.done.map((d:any)=>[d.estimated_minutes,d.operator_added_minutes]));
    assert.equal((await q('SELECT crm_integration_required FROM noco.linklab WHERE client_id=101')).rows[0].crm_integration_required,true,'source ACK is not part of this command PR');
    await sendAccountCommand({body:captures.at(-1)!.body,expectedStudentId:student},options);assert.equal((await control('probe')).receipt_count,1);
    verifyCommitted=false;
    await assert.rejects(sendAccountCommand({body:captures[0].body,expectedStudentId:student},options),/receipt/);
    verifyCommitted=true;
    assert.equal((await control('probe')).account_id,'21');
    const beforeRetry=captures.length;await click(confirmPath,{version:Number(task.version)},'admin');assert.equal(captures.length,beforeRetry);
    const recoveryBody=captures.find(c=>JSON.parse(c.body.toString()).command==='replacement')!.body;
    await assert.rejects(sendAccountCommand({body:recoveryBody,expectedStudentId:student},{...options,secret:cfg.secret+'bad'}),/http_401/);
    const altered=Buffer.from(JSON.stringify({...JSON.parse(recoveryBody.toString()),account_url:'https://www.linkedin.com/in/changed'}));
    await assert.rejects(sendAccountCommand({body:altered,expectedStudentId:student},options),/http_409/);
    for(const change of [{missing:true},{active:false}]){
      await control('link-state',change);
      await assert.rejects(sendAccountCommand({body:recoveryBody,expectedStudentId:student},options),/receipt|http/);
      await control('link-state',{missing:false,active:true});
    }
    const afterReplays=captures.length;
    await q(`INSERT INTO noco.clients VALUES(102,'First');
      INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES
      (31,102,16,'https://linkedin.com/in/first','first','fixture'),(32,102,31,'','first@outlook.com','fixture');
      INSERT INTO noco.octo_profiles(profile_id,client_id,locale,revision,state) VALUES(2,102,'en',1,'{"phase":"ready","proxy":{"uuid":"first-proxy"}}');
      INSERT INTO noco.linkedin_creation_task(client_id,linkedin_account_id,outlook_account_id,status,requires_new_proxy,proxy_profile_id,proxy_uuid,proxy_saved_at)
      VALUES(102,31,32,'сделана экспертом',false,2,'first-proxy',clock_timestamp());`);
    const first=(await q('SELECT id,version FROM noco.linkedin_creation_task WHERE client_id=102')).rows[0];
    assert.equal((await click('/api/admin/linkedin-creation/tasks/'+first.id+'/confirm',{version:Number(first.version)},'admin')).status,200);
    assert.equal(captures.length,afterReplays,'first account is not a replacement');
    assert.equal(warnings.length,0);
    const lagStudent='10000000-0000-4000-8000-000000000004';
    await q(`INSERT INTO noco.clients VALUES(104,'Pending');
      INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES
      (111,104,16,'https://linkedin.com/in/pending','pending','fixture'),(112,104,31,'','pending@outlook.com','fixture');
      INSERT INTO noco.linklab(client_id,platform_account_id,status) VALUES(104,111,'Раскачка');`);
    await q('UPDATE noco.linklab SET crm_student_id=$1,confirmed_version=version WHERE client_id=104',[lagStudent]);
    await control('fixture',{client_id:'104',student_id:lagStudent,account_id:'111',version:'1'});
    await q("UPDATE noco.linklab SET new_account_url='https://linkedin.com/in/pending-next' WHERE client_id=104");
    assert.equal((await click(banPath,{linkedinAccountId:111},'client',104)).status,200);
    assert.equal(captures.at(-1)!.status,409,'BAN cannot skip an unconsumed ordinary source version');
    const pendingBody=captures.at(-1)!.body;
    assert.equal((await control('probe',{client_id:'104'})).version,'1');
    assert.equal((await control('pending-event',{client_id:'104'})).version,2);
    await sendAccountCommand({body:pendingBody,expectedStudentId:lagStudent},options);
    assert.equal((await control('probe',{client_id:'104'})).active_bans,1);
    await q("UPDATE noco.linklab SET new_account_url='https://linkedin.com/in/pending-next-two' WHERE client_id=104");
    assert.equal((await control('pending-event',{client_id:'104'})).version,3,'ordinary exchange still advances after BAN');
    assert.equal((await q('SELECT confirmed_version FROM noco.linklab WHERE client_id=104')).rows[0].confirmed_version,'3');
    assert.equal(warnings.length,1,'only the deliberate unsynchronized BAN is reported');
    assert.deepEqual(warnings[0],{command:'ban',clientId:104,accountId:111,state:'failed',code:'crm_account_command_http_409',eventId:JSON.parse(pendingBody.toString()).event_id});
    console.log('REAL_CRM_PROOF '+JSON.stringify({same_student:recovered.student_id===student,
      new_account:recovered.account_id,warmup_started_on:recovered.warmup_started_on,
      ban_preserved_profile:blocked.profile_filled===before.profile_filled,
      replacement_reset_profile:recovered.profile_filled===0,preserved_ssi_history:recovered.ssi_history===before.ssi_history,
      http_statuses:captures.map(c=>c.status),ordinary_cursor_after_ban:3,source_ack_for_recovery:false}));
  }finally{if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(r));}await pool.end();if(owned){await q('DROP SCHEMA noco CASCADE');await q('DROP OWNED BY unicorn_sql_app;DROP ROLE unicorn_sql_app');}await db.end();}
});
