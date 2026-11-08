import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {createProxyMoveStore} from './postgres-store.mts';
import {createCreationTaskStore} from '../creation-tasks/postgres-store.mts';
import type {Move} from './contracts.mts';
import type {ManagedProfile} from '../../octo-access/contracts.mts';
test('isolated PostgreSQL: replacement commits atomically, preserves notices and rejects concurrent changes',
 {skip:!process.env.LINKEDIN_SQL_ISOLATED_RUN_ID},async t=>{
 const config=readPostgresAppDbConfig(process.env);assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'unicorn_noco_copy_restore');
 const pool=createPostgresPool(config),store=createProxyMoveStore(pool,config.database);
 const query=async(sql:string,values?:unknown[])=>{const s=await pool.connect();try{return await s.query(sql,values);}finally{s.release();}};
 try{
  const guard=(await query('SELECT run_id FROM test_runtime.guard')).rows[0];assert.equal(guard?.run_id,process.env.LINKEDIN_SQL_ISOLATED_RUN_ID);
  assert.equal((await query("SELECT to_regclass('noco.clients') AS existing")).rows[0].existing,null,'never seed an existing application schema');
  await query(`BEGIN READ WRITE;
   CREATE SCHEMA noco; CREATE ROLE unicorn_sql_app;
   CREATE TABLE noco.clients(id bigint PRIMARY KEY,ready_for_interview_in_english_in_2_months text,__nc_deleted boolean);
   CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text,__nc_deleted boolean);
   CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,clients_id bigint REFERENCES noco.clients(id),platforms_id bigint REFERENCES noco.platforms(id),is_banned boolean,__nc_deleted boolean);
   CREATE TABLE noco.octo_profiles(profile_id bigint PRIMARY KEY,client_id bigint REFERENCES noco.clients(id),revision bigint NOT NULL,state jsonb NOT NULL);
   COMMIT;`);
  await query('BEGIN READ WRITE;'+await readFile(new URL('./sql/001-proxy-move.up.sql',import.meta.url),'utf8')+'COMMIT;');
  const move:Move={id:randomUUID(),clientId:901,accountId:10,profileId:1,profileUuid:'synthetic-en',country:'ES',phase:'assigning',fingerprint:'first',createdAt:new Date().toISOString(),proof:{exitIp:'203.0.113.25',country:'ES',checkedAt:new Date().toISOString()}};
  const p:ManagedProfile={id:1,clientId:901,locale:'en',revision:1,operationId:'initial',password:'synthetic',uuid:'synthetic-en',phase:'ready',ownProxy:true,createdAt:0,original:{title:'Test',description:'',tags:[],start_pages:[]},proxy:{uuid:'old',title:'old'}};
  const write=async(sql:string,values?:unknown[])=>{const s=await pool.connect();try{await s.query('BEGIN READ WRITE');const r=await s.query(sql,values);await s.query('COMMIT');return r;}catch(e){await s.query('ROLLBACK');throw e;}finally{s.release();}};
  await write("INSERT INTO noco.clients VALUES(901,'Yes',false);INSERT INTO noco.platforms VALUES(16,'linkedin',false);INSERT INTO noco.platform_accounts VALUES(10,901,16,false,false)");
  await write('INSERT INTO noco.octo_profiles VALUES(1,901,1,$1)',[JSON.stringify(p)]);
  await t.test('initial move queues and completion produces one durable notification',async()=>{
   await store.begin(move,p,{type:'socks5',host:'new.example.invalid',port:1080,login:'synthetic',password:'synthetic'});
   const row=(await query('SELECT state FROM noco.octo_profiles WHERE profile_id=1')).rows[0];Object.assign(p,row.state);
   p.proxy={uuid:'first-new',title:'first-new'};p.proxyChange={...p.proxyChange!,phase:'complete',uuid:'first-new'};p.revision++;
   await write('UPDATE noco.octo_profiles SET revision=$1,state=$2 WHERE profile_id=1',[p.revision,JSON.stringify(p)]);
   await store.finish(move,p,'2026-11-08T10:00:00Z');await store.finish(move,p,'2026-11-08T12:00:00Z');
   const complete=await store.read(901,10);assert.equal(complete?.pauseUntil,'2026-11-10T10:00:00.000Z');assert.equal(complete?.completedAt,'2026-11-08T10:00:00Z');
   await write("UPDATE noco.linkedin_proxy_move SET notice_state='sent',message_id=123 WHERE id=$1",[move.id]);
  });
  await t.test('replacement preserves original event and stores checked proof with the queue',async()=>{
   const complete=(await store.readForProfile(901,1))!;
   await write("UPDATE noco.clients SET ready_for_interview_in_english_in_2_months='No' WHERE id=901");
   await store.queueReplacement(complete,p,{type:'socks5',host:'replacement.example.invalid',port:1080,login:'synthetic',password:'synthetic'},{exitIp:'203.0.113.26',country:'ES',checkedAt:new Date().toISOString()},'replacement-operation','replacement-fingerprint');
   const row=(await query('SELECT state,revision FROM noco.octo_profiles WHERE profile_id=1')).rows[0],state=row.state as ManagedProfile;assert.equal(state.proxy?.uuid,'first-new');assert.equal(state.proxyChange?.phase,'queued');assert.equal(state.revision,Number(row.revision));
   const m=(await query('SELECT data,notice_state,message_id FROM noco.linkedin_proxy_move WHERE id=$1',[move.id])).rows[0],data=m.data as Move;assert.equal(data.id,move.id);assert.equal(data.lastProxyCheck?.operationId,'replacement-operation');assert.equal(data.completedAt,complete.completedAt);assert.equal(data.pauseUntil,complete.pauseUntil);assert.equal(m.notice_state,'sent');assert.equal(m.message_id,'123');
   Object.assign(p,row.state);p.proxyChange={...p.proxyChange!,phase:'complete',uuid:'second-new'};p.proxy={uuid:'second-new',title:'second-new'};p.revision++;
   await write('UPDATE noco.octo_profiles SET state=$1,revision=$2 WHERE profile_id=1',[JSON.stringify(p),p.revision]);
  });
  await t.test('advisory lock and revision check reject a concurrent grant without overwriting it',async()=>{
   const complete=(await store.read(901,10))!,held=await pool.connect();
   await held.query('BEGIN READ WRITE');await held.query('SELECT pg_advisory_xact_lock(730644,901)');
   const changed={...p,revision:p.revision+1,grant:{phase:'granted'}};
   await held.query('UPDATE noco.octo_profiles SET revision=$1,state=$2 WHERE profile_id=1',[changed.revision,JSON.stringify(changed)]);
   const pending=store.queueReplacement(complete,p,{type:'socks5',host:'late.example.invalid',port:1080,login:'synthetic',password:'synthetic'},{exitIp:'203.0.113.27',country:'ES',checkedAt:new Date().toISOString()},'must-not-queue','late-fingerprint');
   const rejected=assert.rejects(pending,e=>(e as any).code==='linkedin_proxy_move_stale');
   await held.query('COMMIT');held.release();await rejected;
   const row=(await query('SELECT state FROM noco.octo_profiles WHERE profile_id=1')).rows[0],state=row.state as ManagedProfile;assert.equal(state.grant?.phase,'granted');assert.notEqual(state.proxyChange?.id,'must-not-queue');
   assert.equal((await store.read(901,10))?.lastProxyCheck?.operationId,'replacement-operation');
  });
  await t.test('expert completion saves its receipt atomically and rolls it back when LinkedIn data are missing',async()=>{
   await write(`ALTER TABLE noco.octo_profiles ADD COLUMN locale text DEFAULT 'en';
    ALTER TABLE noco.platform_accounts ADD COLUMN url text,ADD COLUMN login text,ADD COLUMN password text;
    INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,is_banned,__nc_deleted) VALUES(11,901,16,false,false);
    CREATE TABLE noco.linkedin_creation_task(id bigint PRIMARY KEY,client_id bigint,linkedin_account_id bigint,outlook_account_id bigint,source text,status text,version bigint,proxy_profile_id bigint,proxy_uuid text,proxy_saved_at timestamptz,created_at timestamptz,updated_at timestamptz,requires_new_proxy boolean);
    INSERT INTO noco.linkedin_creation_task VALUES(1,901,10,11,'student_intake','не начата',1,NULL,NULL,NULL,now(),now(),true);
    UPDATE noco.platform_accounts SET url='https://www.linkedin.com/in/isolated-synthetic',login='synthetic@example.invalid',password='' WHERE id=10;`);
   const state=(await query('SELECT state FROM noco.octo_profiles WHERE profile_id=1')).rows[0].state as ManagedProfile;delete state.grant;
   await write('UPDATE noco.octo_profiles SET state=$1 WHERE profile_id=1',[JSON.stringify(state)]);
   let hooks=0;const tasks=createCreationTaskStore(pool,config.database,false,async()=>{hooks++;}),proof={profileId:1,proxyUuid:state.proxy!.uuid,revision:state.revision};
   await assert.rejects(tasks.status(1,1,'сделана экспертом',proof),e=>(e as {code?:string}).code==='linkedin_task_result_required');
   const pending=(await query('SELECT status,proxy_saved_at FROM noco.linkedin_creation_task WHERE id=1')).rows[0];assert.equal(pending.status,'не начата');assert.equal(pending.proxy_saved_at,null);assert.equal(hooks,0);
   await write("UPDATE noco.platform_accounts SET password='synthetic-only' WHERE id=10");
   const done=await tasks.status(1,1,'сделана экспертом',proof);assert.equal(done.status,'сделана экспертом');assert.equal(done.proxyUuid,proof.proxyUuid);assert.ok(done.proxySavedAt);assert.equal(hooks,1);
   await tasks.status(1,1,'сделана экспертом',proof);assert.equal(hooks,1);
  });
  await t.test('installed CRM SQL pauses exactly 48 hours, deduplicates and restores Раскачка at the boundary',
   {skip:!process.env.LINKEDIN_CRM_SQL_SNAPSHOT},async()=>{
    // This optional snapshot contains only installed function/trigger definitions, no live data.
    await write(`CREATE TABLE noco.linkedin_account_cycles(client_id bigint,account_id bigint,applied_at timestamptz);
     CREATE TABLE noco.linklab(client_id bigint PRIMARY KEY,platform_account_id bigint,version bigint DEFAULT 1,confirmed_version bigint DEFAULT 1,crm_student_id uuid,crm_integration_required boolean DEFAULT false,status text DEFAULT 'Раскачка',new_account_url text,proxy_state text DEFAULT 'Не активна',proxy_cycle_id uuid,proxy_started_at timestamptz,proxy_ends_at timestamptz,proxy_completed_at timestamptz,proxy_previous_status text,proxy_status_overridden boolean DEFAULT false,updated_at timestamptz DEFAULT now(),blocked_at timestamptz,profile_revision bigint DEFAULT 0,profile_total_count integer DEFAULT 20,profile_filled_count integer DEFAULT 0,profile_first_completed_at timestamptz);
     CREATE TABLE noco.linklab_changes(id bigserial PRIMARY KEY,client_id bigint,platform_account_id bigint,version bigint,previous_version bigint,previous_status text,status text,new_account_url text,changed_fields text[],source text,db_actor text,proxy_cycle_id uuid,proxy_started_at timestamptz);
     CREATE TABLE noco.linklab_crm_results(operation_id uuid PRIMARY KEY,client_id bigint,crm_student_id uuid,kind text,payload jsonb,outcome text);
     CREATE TABLE noco.crm_proxy_move_receipts(move_id uuid PRIMARY KEY,facts jsonb,client_id bigint,account_id bigint,student_id uuid,expected_version bigint,transaction_id bigint,occurred_at timestamptz,event_id bigint,error text,available_at timestamptz,created_at timestamptz DEFAULT now());`);
    await write(await readFile(process.env.LINKEDIN_CRM_SQL_SNAPSHOT!,'utf8'));
    const studentId=randomUUID(),eventId=randomUUID(),end=Date.now()+2000,start=end-48*3600000;
    const crmMove:Move={...move,id:eventId,phase:'completed',completedAt:new Date(start).toISOString(),pauseUntil:new Date(end).toISOString()};
    await write('INSERT INTO noco.linklab(client_id,platform_account_id,crm_student_id) VALUES(901,10,$1)',[studentId]);
    await write("INSERT INTO noco.linkedin_proxy_move(id,client_id,account_id,profile_id,data) VALUES($1,901,10,1,$2) ON CONFLICT(client_id,account_id) DO UPDATE SET id=excluded.id,data=excluded.data",[eventId,JSON.stringify(crmMove)]);
    const receive=()=>write('SELECT noco.crm_receive_proxy_move($1) AS result',[eventId]);
    assert.equal((await receive()).rows[0].result,'applied');assert.equal((await receive()).rows[0].result,'duplicate');
    const time=(value:unknown)=>new Date(value as string).getTime();
    const paused=(await query('SELECT * FROM noco.linklab WHERE client_id=901')).rows[0];assert.equal(paused.status,'Пауза');assert.equal(paused.proxy_cycle_id,eventId);assert.equal(time(paused.proxy_ends_at)-time(paused.proxy_started_at),48*3600000);assert.equal(time(paused.proxy_ends_at),end);
    assert.equal((await query("SELECT count(*) AS n FROM noco.linklab_changes WHERE 'proxy_status_paused'=ANY(changed_fields)")).rows[0].n,'1');
    const operationId=randomUUID(),payload=JSON.stringify({cycle_id:eventId,completed_at:crmMove.pauseUntil});
    const complete=()=>write("SELECT noco.linklab_apply_crm_result(p_operation_id=>$1,p_client_id=>901,p_student_id=>$2,p_kind=>'proxy_completed',p_payload=>$3::jsonb) AS result",[operationId,studentId,payload]);
    await assert.rejects(complete(),/linklab_proxy_not_finished/);
    await new Promise(done=>setTimeout(done,Math.max(0,end-Date.now()+25)));
    assert.equal((await complete()).rows[0].result,'applied');assert.equal((await complete()).rows[0].result,'duplicate');
    const restored=(await query('SELECT status,proxy_state,proxy_completed_at FROM noco.linklab WHERE client_id=901')).rows[0];assert.equal(restored.status,'Раскачка');assert.equal(restored.proxy_state,'Не активна');assert.equal(time(restored.proxy_completed_at),end);
    assert.equal((await receive()).rows[0].result,'duplicate','old completion cannot re-pause the restored account');
   });
 }finally{await pool.end();}
});
