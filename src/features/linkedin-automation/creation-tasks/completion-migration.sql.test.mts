import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {COPY_MARKER,type SqlSession} from '../../../integrations/postgres/contracts.mts';
import {studentAccountAccess} from './student-task.mts';
import {createCreationTaskStore} from './postgres-store.mts';
const {Client,Pool}=createRequire(import.meta.url)('pg');
const file=process.env.LINKEDIN_CYCLE_ISOLATED_CONFIG;

test('actual PostgreSQL: three-status migration guards pending work, rolls back, preserves history and never replays deliveries',{skip:!file},async()=>{
 const cfg=JSON.parse(readFileSync(file!,'utf8'));
 assert.equal(cfg.local_proof,true);assert.equal(cfg.host,'127.0.0.1');assert.equal(cfg.port,55439);
 assert.equal(cfg.database,'unicorn_noco_copy_restore');assert.equal(cfg.user,'cycle_owner');
 const db=new Client(cfg);await db.connect();const q=(sql:string,v:unknown[]=[])=>db.query(sql,v);
 const sql=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
 const migration=sql('./sql/004-three-statuses.up.sql');
 let owned=false;
 try{
  assert.equal((await q("SELECT to_regnamespace('noco') AS ns")).rows[0].ns,null,'never replace an existing schema');
  await q(`COMMENT ON DATABASE unicorn_noco_copy_restore IS '${COPY_MARKER}';CREATE SCHEMA noco;
   CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_name text,telegram_general_chat_id text,secured_general_chat_id text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,clients_id bigint REFERENCES noco.clients(id),platforms_id bigint REFERENCES noco.platforms(id),url text,login text,password text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.octo_profiles(profile_id bigint PRIMARY KEY,client_id bigint REFERENCES noco.clients(id),locale text,revision bigint,state jsonb);
   INSERT INTO noco.clients(id,client_name,telegram_general_chat_id,secured_general_chat_id) VALUES(101,'Historical','-7101','-8101'),(102,'Pending','-7102',NULL);
   INSERT INTO noco.platforms(id,name) VALUES(16,'LinkedIn'),(31,'email_outlook');
   INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES
    (11,101,16,'https://linkedin.com/in/historical','historical','fixture'),(12,101,31,'','first@outlook.com','fixture'),
    (21,102,16,'https://linkedin.com/in/pending','pending','fixture'),(22,102,31,'','second@outlook.com','fixture');
   INSERT INTO noco.octo_profiles VALUES(1,101,'en',1,'{"phase":"ready","proxy":{"uuid":"one"}}'),(2,102,'en',1,'{"phase":"ready","proxy":{"uuid":"two"}}');`);owned=true;
  for(const name of ['001-status','002-crm-results','003-intake','004-proxy-status','005-credentials-refresh'])await q(sql(`../linklab/sql/${name}.up.sql`));
  await q(sql('./sql/001.up.sql'));await q(sql('./sql/002-new-proxy.up.sql'));await q(sql('../linklab/sql/006-account-cycle.up.sql'));
  await q(`INSERT INTO noco.linkedin_creation_task(client_id,linkedin_account_id,outlook_account_id,requires_new_proxy,proxy_profile_id,proxy_uuid,proxy_saved_at)
    VALUES(101,11,12,false,1,'one',clock_timestamp()),(102,21,22,false,2,'two',clock_timestamp());
   UPDATE noco.linkedin_creation_task SET status='выполнение подтверждено' WHERE id=1;
   UPDATE noco.linkedin_cycle_notifications SET state='sent',message_id=987,claimed_at=clock_timestamp(),claim_token=gen_random_uuid();
   UPDATE noco.linkedin_creation_task SET status='сделана экспертом' WHERE id=2;`);
  const snapshot=async()=>({tasks:(await q('SELECT * FROM noco.linkedin_creation_task ORDER BY id')).rows,
   cycles:(await q('SELECT * FROM noco.linkedin_account_cycles ORDER BY task_id')).rows,
   notices:(await q('SELECT * FROM noco.linkedin_cycle_notifications ORDER BY task_id')).rows,
   linklab:(await q('SELECT * FROM noco.linklab ORDER BY client_id')).rows});
  const pending=await snapshot();await assert.rejects(q(migration),/linkedin_pending_expert_tasks: 2/);await q('ROLLBACK');
  assert.deepEqual(await snapshot(),pending,'refused install leaves all state intact');
  await q("UPDATE noco.linkedin_creation_task SET status='блок' WHERE id=2;DELETE FROM noco.octo_profiles WHERE profile_id=1;UPDATE noco.platform_accounts SET __nc_deleted=true WHERE id IN(11,12)");
  const before=await snapshot();
  await q('BEGIN');await q(migration.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,''));await q('ROLLBACK');
  assert.deepEqual(await snapshot(),before,'dry-run is a true rollback');
  await q(migration);const after=await snapshot();
  assert.deepEqual(after.tasks,before.tasks.map((t:any)=>({...t,status:t.status==='выполнение подтверждено'?'сделана экспертом':t.status})));
  assert.deepEqual(after.cycles,before.cycles);assert.deepEqual(after.linklab,before.linklab);
  assert.deepEqual(after.notices,before.notices.map((n:any)=>({...n,recipient:'reports',chat_id:'-1003187558078'})));
  await q(migration);assert.deepEqual(await snapshot(),after,'repeated installation does not reset or enqueue anything');
  assert.deepEqual(await studentAccountAccess(db as SqlSession,101,11),{editLocked:true,registrationPending:false,completionConfirmed:true});
  // A legacy/current proxy needs ordinary closure too, even when requires_new_proxy=false.
  await q("UPDATE noco.octo_profiles SET state=state||'{\"grant\":{\"phase\":\"granted\"}}'::jsonb WHERE profile_id=2");
  await assert.rejects(q("UPDATE noco.linkedin_creation_task SET status='сделана экспертом' WHERE id=2"),/proxy_required/);
  assert.equal((await q('SELECT count(*) FROM noco.linkedin_account_cycles')).rows[0].count,'1');
  await q("UPDATE noco.octo_profiles SET state=state-'grant' WHERE profile_id=2");
  await q("UPDATE noco.linkedin_creation_task SET status='сделана экспертом' WHERE id=2");
  assert.deepEqual((await q('SELECT recipient,chat_id,state FROM noco.linkedin_cycle_notifications WHERE task_id=2 ORDER BY recipient')).rows,
   [{recipient:'reports',chat_id:'-1003187558078',state:'pending'},{recipient:'student',chat_id:'-7102',state:'pending'}]);
  await q("UPDATE noco.clients SET telegram_general_chat_id='-9999' WHERE id=102");
  assert.equal((await q("SELECT chat_id FROM noco.linkedin_cycle_notifications WHERE task_id=2 AND recipient='student'")).rows[0].chat_id,'-7102','destination is frozen at commit');
  const final=await snapshot();await q("UPDATE noco.linkedin_creation_task SET status='сделана экспертом' WHERE id=2");
  assert.deepEqual(await snapshot(),final,'direct SQL repetition is a no-op');
  await assert.rejects(q("UPDATE noco.linkedin_creation_task SET status='блок' WHERE id=2"),/linkedin_task_completed/);
  await assert.rejects(q("UPDATE noco.linkedin_creation_task SET status='выполнение подтверждено' WHERE id=2"),/linkedin_task_completed|status_check/);
  await q(`INSERT INTO noco.clients(id,client_name,telegram_general_chat_id) VALUES(103,'Concurrent','-7103');
   INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES
    (31,103,16,'https://linkedin.com/in/concurrent','concurrent','fixture'),(32,103,31,'','third@outlook.com','fixture');
   INSERT INTO noco.octo_profiles VALUES(3,103,'en',1,'{"phase":"ready","proxy":{"uuid":"three"}}');
   INSERT INTO noco.linkedin_creation_task(client_id,linkedin_account_id,outlook_account_id,requires_new_proxy,proxy_profile_id,proxy_uuid,proxy_saved_at)
    VALUES(103,31,32,false,3,'three',clock_timestamp());`);
  const pool=new Pool({...cfg,max:2});let hooks=0;
  try{
   const store=createCreationTaskStore(pool,'unicorn_noco_copy_restore',false,async taskId=>{
    assert.equal(taskId,3);assert.equal((await q('SELECT count(*) FROM noco.linkedin_cycle_notifications WHERE task_id=3')).rows[0].count,'2');hooks++;
   });
   await assert.rejects(store.status(3,999,'сделана экспертом'),{code:'linkedin_task_stale_version'});
   const completed=await Promise.all([store.status(3,1,'сделана экспертом'),store.status(3,1,'сделана экспертом')]);
   assert.deepEqual(completed[0],completed[1]);assert.equal(completed[0].version,2);assert.equal(hooks,1);
   assert.equal((await q('SELECT count(*) FROM noco.linkedin_account_cycles WHERE task_id=3')).rows[0].count,'1');
   await assert.rejects(store.status(3,2,'не начата'),{code:'linkedin_task_completed'});
   await q('UPDATE noco.platform_accounts SET __nc_deleted=true WHERE id IN(31,32)');
   assert.deepEqual(await store.status(3,1,'сделана экспертом'),completed[0],'late repeats also reconcile after account archival for a later cycle');
   assert.equal(hooks,1);
  }finally{await pool.end();}
 }finally{await q('ROLLBACK');if(owned)await q('DROP SCHEMA noco CASCADE');await db.end();}
});
