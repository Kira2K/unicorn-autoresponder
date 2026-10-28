import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {COPY_MARKER} from '../../../integrations/postgres/contracts.mts';
import {taskProxyStore} from './proxy-store.mts';import {taskRow} from './contracts.mts';
import {cycleNotificationStore} from './cycle-notifications.mts';import {proxyFingerprint} from './new-proxy.mts';
const {Client,Pool}=createRequire(import.meta.url)('pg');
const file=process.env.LINKEDIN_CYCLE_ISOLATED_CONFIG;
test('actual PostgreSQL: new-proxy CAS, confirmed cycle, restricted roles and notification journal',{skip:!file},async t=>{
 const cfg=JSON.parse(readFileSync(file!,'utf8'));
 assert.equal(cfg.local_proof,true);assert.equal(cfg.host,'127.0.0.1');assert.equal(cfg.database,'unicorn_noco_copy_restore');
 assert.equal(cfg.user,'cycle_owner');assert.equal(cfg.port,55439);
 const db=new Client(cfg);await db.connect();const q=(sql:string,v:unknown[]=[])=>db.query(sql,v);
 let owned=false;const pool=new Pool({...cfg,max:4});
 const sql=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
 const error=async(run:()=>Promise<unknown>,re:RegExp)=>{await assert.rejects(run(),(e:any)=>re.test(e.message));await q('ROLLBACK')};
 try{
  assert.equal((await q("SELECT to_regnamespace('noco') AS ns")).rows[0].ns,null,'never reuse or erase an existing schema');
  await q(`COMMENT ON DATABASE unicorn_noco_copy_restore IS '${COPY_MARKER.replaceAll("'","''")}';
   CREATE SCHEMA noco;
   CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_name text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,clients_id bigint REFERENCES noco.clients(id),platforms_id bigint REFERENCES noco.platforms(id),url text,login text,password text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.octo_profiles(profile_id bigint PRIMARY KEY,client_id bigint REFERENCES noco.clients(id),locale text,revision bigint,state jsonb);
   CREATE TABLE noco.dolphin_profiles(id bigint PRIMARY KEY,browser text,octo_profile_id text);
   INSERT INTO noco.dolphin_profiles VALUES(1,'octo',NULL);
   INSERT INTO noco.clients VALUES(101,'Synthetic'),(102,'Legacy');
   INSERT INTO noco.platforms VALUES(16,'LinkedIn'),(31,'email_outlook');
   INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES
    (11,101,16,'https://linkedin.com/in/old','old','fixture'),(12,101,31,'','old@outlook.com','fixture'),
    (21,101,16,'https://linkedin.com/in/new','new','fixture'),(22,101,31,'','new@outlook.com','fixture'),
    (31,102,16,'https://linkedin.com/in/other','legacy','fixture');`);owned=true;
  for(const name of ['001-status','002-crm-results','003-intake','004-proxy-status','005-credentials-refresh'])await q(sql(`../linklab/sql/${name}.up.sql`));
  await q(sql('./sql/001.up.sql'));await q(sql('./sql/002-new-proxy.up.sql'));await q(sql('../linklab/sql/006-account-cycle.up.sql'));
  await q(sql('../linklab/sql/007-account-ownership.up.sql'));
  const profile={id:1,clientId:101,locale:'en' as const,revision:1,operationId:'fixture',password:'fixture',createdAt:1,phase:'ready' as const,ownProxy:true,uuid:'a'.repeat(32),original:{title:'Fixture',description:'fixture',tags:[],start_pages:[]},proxy:{uuid:'old',title:'old'}};
  await q('INSERT INTO noco.octo_profiles VALUES(1,101,\'en\',1,$1::jsonb)',[JSON.stringify(profile)]);
  await q(`INSERT INTO noco.linklab(client_id,platform_account_id,status,blocked_at,profile_revision,profile_filled_count,profile_first_completed_at)
    VALUES(101,11,'Блок','2026-01-01',8,21,'2026-01-02'),(102,31,'Новый',NULL,-1,0,NULL);
    UPDATE noco.linklab SET confirmed_version=version,crm_student_id='10000000-0000-4000-8000-000000000001' WHERE client_id=101;
    UPDATE noco.linklab SET proxy_state='Активна' WHERE client_id=101;
    INSERT INTO noco.linklab_cv_approvals VALUES(101,101,'https://example.test/cv','2026-01-01');
    INSERT INTO noco.linkedin_creation_task(client_id,linkedin_account_id,outlook_account_id) VALUES(101,21,22);`);
  const task=taskRow((await q('SELECT * FROM noco.linkedin_creation_task')).rows[0]);
  const before=(await q('SELECT * FROM noco.linklab WHERE client_id=101')).rows[0];
  const proxy=taskProxyStore(pool,'unicorn_noco_copy_restore');
  const input={type:'socks5' as const,host:'gate.example.test',port:1080,login:'new',password:'fixture'};
  const oldConnection={...input,login:'old'};
  const proof={fingerprint:proxyFingerprint(input),exitIp:'1.1.1.1',comparison:'different' as const,baselineFingerprint:proxyFingerprint(oldConnection),baselineIp:'2.2.2.2',baselineConnection:oldConnection};
  await t.test('new request captures its baseline and closed-profile CAS queues one EN operation',async()=>{
   assert.equal((await proxy.read(task.id))?.baselineUuid,'old');
   await q("UPDATE noco.octo_profiles SET state=jsonb_set(state,'{grant}','{\"phase\":\"granted\"}')");
   await assert.rejects(proxy.queue(task,profile,input,proof),{code:'linkedin_task_close_profile_first'});
   await q("UPDATE noco.octo_profiles SET state=state-'grant'");
   await proxy.queue(task,profile,input,proof);
   assert.deepEqual((await proxy.read(task.id))?.baselineConnection,oldConnection);
   await assert.rejects(proxy.queue(task,profile,input,proof),{code:'linkedin_task_stale_version'});
   const actual=(await q('SELECT state FROM noco.octo_profiles')).rows[0].state;
   assert.equal(actual.proxy.uuid,'old');assert.equal(actual.proxyChange.phase,'queued');assert.equal(actual.proxyChange.input.login,'new');
   assert.equal((await q('SELECT platform_account_id FROM noco.linklab WHERE client_id=101')).rows[0].platform_account_id,'11');
   await error(()=>q("UPDATE noco.linkedin_creation_task SET status='сделана экспертом'"),/proxy_required|new_proxy_required/);
  });
  await t.test('pending new accounts cannot rebind, and any failure leaves confirmation/journal unchanged',async()=>{
   await error(()=>q('UPDATE noco.linklab SET platform_account_id=21 WHERE client_id=101'),/binding_immutable/);
   await q("UPDATE noco.octo_profiles SET revision=revision+1,state=jsonb_set(jsonb_set(state,'{proxyChange,phase}','\"complete\"'),'{proxy,uuid}','\"new\"')");
   await q('UPDATE noco.linkedin_creation_proxy SET fingerprint=baseline_fingerprint');
   await error(()=>q("UPDATE noco.linkedin_creation_task SET proxy_profile_id=1,proxy_uuid='new',proxy_saved_at=clock_timestamp(),status='сделана экспертом'"),/new_proxy_required/);
   await q('UPDATE noco.linkedin_creation_proxy SET fingerprint=$1',[proof.fingerprint]);
   await q("UPDATE noco.linkedin_creation_task SET proxy_profile_id=1,proxy_uuid='new',proxy_saved_at=clock_timestamp(),status='сделана экспертом'");
   await error(()=>q("UPDATE noco.linkedin_creation_task SET status='выполнение подтверждено'"),/active_binding/);
   assert.equal((await q('SELECT count(*) FROM noco.linkedin_cycle_notifications')).rows[0].count,'0');
   assert.equal((await q('SELECT status FROM noco.linkedin_creation_task')).rows[0].status,'сделана экспертом');
  });
  await t.test('restricted application role confirms atomically; only the owned archived binding may change',async()=>{
   await q('CREATE ROLE cycle_test_app');
   await q(`GRANT USAGE ON SCHEMA noco TO cycle_test_app;GRANT SELECT ON ALL TABLES IN SCHEMA noco TO cycle_test_app;
    GRANT UPDATE ON noco.linkedin_creation_task,noco.linkedin_creation_proxy,noco.linkedin_cycle_notifications TO cycle_test_app;
    UPDATE noco.platform_accounts SET __nc_deleted=true WHERE id IN(11,12);`);
   await q("BEGIN;SET ROLE cycle_test_app;UPDATE noco.linkedin_creation_task SET status='выполнение подтверждено';RESET ROLE;");
   const racingClient=await pool.connect();
   try{
    await racingClient.query("SET lock_timeout='3s'");
    const pid=(await racingClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const racing=racingClient.query("SELECT noco.linklab_apply_crm_result(gen_random_uuid(),101,'10000000-0000-4000-8000-000000000001','profile_progress','{\"revision\":99,\"filled_count\":21,\"total_count\":21,\"percent\":100,\"first_completed_at\":\"2026-01-02T00:00:00Z\"}') AS result");
    for(let i=0;i<100;i++){
     if((await q("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.wait_event_type==='Lock')break;
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal((await q('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0].wait_event_type,'Lock');
    await q('COMMIT');
    assert.equal((await racing).rows[0].result,'stale','a CRM result already waiting at confirmation must check the locked new cycle');
   }finally{await q('ROLLBACK');racingClient.release();}
   const row=(await q('SELECT * FROM noco.linklab WHERE client_id=101')).rows[0];
   assert.equal(row.platform_account_id,'21');assert.equal(row.status,'Новый');assert.equal(row.profile_filled_count,0);assert.equal(row.profile_revision,'-1');
   assert.equal(row.blocked_at,null);assert.equal(row.profile_first_completed_at,null);assert.equal(row.crm_integration_required,true);
   assert.equal(row.crm_student_id,before.crm_student_id);assert.deepEqual(row.en_approved_at,before.en_approved_at);
   assert.equal(row.proxy_cycle_id,before.proxy_cycle_id);assert.deepEqual(row.proxy_ends_at,before.proxy_ends_at);assert.equal(row.proxy_state,'Активна');
   await q("UPDATE noco.linkedin_creation_task SET status='выполнение подтверждено'");
   assert.equal((await q('SELECT count(*) FROM noco.linkedin_cycle_notifications')).rows[0].count,'1');
   assert.equal((await q('SELECT count(*) FROM noco.linkedin_account_cycles')).rows[0].count,'1');
   const snapshot=(await q('SELECT previous_state FROM noco.linkedin_account_cycles')).rows[0].previous_state;assert.equal(snapshot.filled_count,21);
   await error(()=>q('UPDATE noco.linklab SET platform_account_id=31 WHERE client_id=101'),/binding_immutable/);
  });
  await t.test('legacy CRM cannot restore old progress/status or consume the new cycle',async()=>{
   assert.equal((await q('SELECT count(*) FROM noco.linklab_pending_changes WHERE client_id=101')).rows[0].count,'0');
   assert.equal((await q('SELECT count(*) FROM noco.linklab_pending_changes WHERE client_id=102')).rows[0].count,'1');
   const payload={revision:99,filled_count:21,total_count:21,percent:100,first_completed_at:'2026-01-02T00:00:00Z'};
   assert.equal((await q("SELECT noco.linklab_apply_crm_result(gen_random_uuid(),101,'10000000-0000-4000-8000-000000000001','profile_progress',$1::jsonb) AS result",[JSON.stringify(payload)])).rows[0].result,'stale');
   assert.equal((await q('SELECT profile_filled_count FROM noco.linklab WHERE client_id=101')).rows[0].profile_filled_count,0);
   const event=(await q('SELECT id FROM noco.linklab_changes WHERE client_id=101 ORDER BY id LIMIT 1')).rows[0].id;
   assert.equal((await q('SELECT noco.linklab_acknowledge($1,gen_random_uuid(),gen_random_uuid()) AS result',[event])).rows[0].result,false);
   assert.equal((await q("SELECT noco.linklab_record_failure($1,'crm_unavailable') AS result",[event])).rows[0].result,false);
   await error(()=>q("SELECT noco.linklab_request_status(101,1,gen_random_uuid(),'Прогрев')"),/crm_integration_required/);
   await q("UPDATE noco.linklab SET crm_student_id='10000000-0000-4000-8000-000000000002' WHERE client_id=102");
   assert.equal((await q("SELECT noco.linklab_apply_crm_result(gen_random_uuid(),102,'10000000-0000-4000-8000-000000000002','profile_progress',$1::jsonb) AS result",[JSON.stringify({...payload,filled_count:5,percent:24})])).rows[0].result,'applied');
   assert.equal((await q('SELECT profile_filled_count FROM noco.linklab WHERE client_id=102')).rows[0].profile_filled_count,5,'legacy students retain their CRM contract');
  });
  await t.test('concurrent workers claim once; delivered/uncertain events never silently replay',async()=>{
   const notices=cycleNotificationStore(pool,'unicorn_noco_copy_restore');const claims=await Promise.all([notices.claim(),notices.claim()]);
   assert.equal(claims.filter(Boolean).length,1);const event=claims.find(Boolean)!;
   await notices.finish(event,'sent',123);assert.equal(await notices.claim(),undefined);
   await q("UPDATE noco.linkedin_cycle_notifications SET state='attempting',claimed_at=clock_timestamp()-interval '11 minutes'");
   assert.equal(await notices.claim(),undefined);assert.equal((await q('SELECT state FROM noco.linkedin_cycle_notifications')).rows[0].state,'uncertain');
  });
  await t.test('first confirmed account creates LinkLab, repeated transitions preserve progress, and archived ownership stays protected',async()=>{
   await q(`INSERT INTO noco.clients VALUES(103,'First');
    INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES
     (41,103,16,'https://linkedin.com/in/first','first','fixture'),(42,103,31,'','first@outlook.com','fixture');
    INSERT INTO noco.linkedin_creation_task(client_id,linkedin_account_id,outlook_account_id) VALUES(103,41,42);`);
   const first=(await q('SELECT id FROM noco.linkedin_creation_task WHERE client_id=103')).rows[0].id;
   const p=structuredClone((await q('SELECT state FROM noco.octo_profiles WHERE profile_id=1')).rows[0].state);
   p.id=3;p.clientId=103;p.proxy.uuid='first-proxy';
   await q("INSERT INTO noco.octo_profiles VALUES(3,103,'en',1,$1::jsonb)",[JSON.stringify(p)]);
   await q(`UPDATE noco.linkedin_creation_proxy SET profile_id=3,fingerprint='fresh',exit_ip='3.3.3.3',comparison='skipped',operation_id=$2 WHERE task_id=$1`,[first,p.proxyChange.id]);
   await q("UPDATE noco.linkedin_creation_task SET proxy_profile_id=3,proxy_uuid='first-proxy',proxy_saved_at=clock_timestamp(),status='выполнение подтверждено' WHERE id=$1",[first]);
   assert.equal((await q('SELECT platform_account_id FROM noco.linklab WHERE client_id=103')).rows[0].platform_account_id,'41');
   await q('UPDATE noco.linklab SET profile_filled_count=5 WHERE client_id=103');
   await q("UPDATE noco.linkedin_creation_task SET status='блок' WHERE id=$1",[first]);
   await q("UPDATE noco.linkedin_creation_task SET status='выполнение подтверждено' WHERE id=$1",[first]);
   assert.equal((await q('SELECT profile_filled_count FROM noco.linklab WHERE client_id=103')).rows[0].profile_filled_count,5);
   assert.equal((await q('SELECT count(*) FROM noco.linkedin_cycle_notifications WHERE task_id=$1',[first])).rows[0].count,'1');
   await q('UPDATE noco.platform_accounts SET __nc_deleted=true WHERE id=31');
   await error(()=>q('UPDATE noco.linklab SET platform_account_id=31 WHERE client_id=101'),/binding_immutable/);
  });
  await t.test('a referenced LinkedIn account cannot change owner or platform outside the cycle',async()=>{
   await q('GRANT UPDATE(clients_id,platforms_id,login,password,__nc_deleted) ON noco.platform_accounts TO cycle_test_app');
   const account=(await q('SELECT platform_account_id FROM noco.linklab WHERE client_id=101')).rows[0].platform_account_id;
   for(const column of ['clients_id','platforms_id']){
    await q('BEGIN;SET LOCAL ROLE cycle_test_app');try{
     await assert.rejects(q(`UPDATE noco.platform_accounts SET ${column}=$2 WHERE id=$1`,[account,column==='clients_id'?102:31]),/linkedin_account_binding_immutable/);
    }finally{await q('ROLLBACK');}
   }
   await q('BEGIN;SET LOCAL ROLE cycle_test_app');
   await q("UPDATE noco.platform_accounts SET login='updated',password='fixture-new' WHERE id=$1",[account]);
   await q('UPDATE noco.platform_accounts SET __nc_deleted=true WHERE id=$1',[account]);await q('COMMIT');
   assert.equal((await q('SELECT clients_id FROM noco.platform_accounts WHERE id=$1',[account])).rows[0].clients_id,'101');
   await q('BEGIN');try{await assert.rejects(q('UPDATE noco.platform_accounts SET clients_id=102 WHERE id=42'),/linkedin_account_binding_immutable/);}finally{await q('ROLLBACK');}
  });
  await t.test('installation refuses existing mismatches without silently repairing records',async()=>{
   await q(sql('../linklab/sql/007-account-ownership.down.sql'));
   const account=(await q('SELECT platform_account_id FROM noco.linklab WHERE client_id=101')).rows[0].platform_account_id;
   await q('UPDATE noco.platform_accounts SET clients_id=102 WHERE id=$1',[account]);
   await error(()=>q(sql('../linklab/sql/007-account-ownership.up.sql')),/linklab_existing_account_ownership_requires_review/);
   assert.equal((await q('SELECT clients_id FROM noco.platform_accounts WHERE id=$1',[account])).rows[0].clients_id,'102');
   await q('UPDATE noco.platform_accounts SET clients_id=101 WHERE id=$1',[account]);
   await q(sql('../linklab/sql/007-account-ownership.up.sql'));
  });
 }finally{await pool.end();await q('RESET ROLE');if(owned){await q('DROP SCHEMA noco CASCADE');await q('DROP OWNED BY cycle_test_app').catch(()=>{});await q('DROP ROLE IF EXISTS cycle_test_app');}await db.end();}
});
