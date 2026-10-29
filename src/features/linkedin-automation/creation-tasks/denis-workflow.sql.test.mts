import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {COPY_MARKER} from '../../../integrations/postgres/contracts.mts';
import {createCreationTaskStore} from './postgres-store.mts';
import {createLinkedInIntakeStore} from '../console-intake/postgres-store.mts';
import {parseIntake} from '../console-intake/contracts.mts';
const {Client,Pool}=createRequire(import.meta.url)('pg');
const file=process.env.LINKEDIN_CYCLE_ISOLATED_CONFIG;
test('actual PostgreSQL: Denis migration rolls back, backfills exact receipts, and admin confirmation serializes',{skip:!file},async()=>{
 const cfg=JSON.parse(readFileSync(file!,'utf8'));
 assert.equal(cfg.local_proof,true);assert.equal(cfg.host,'127.0.0.1');assert.equal(cfg.port,55439);assert.equal(cfg.database,'unicorn_noco_copy_restore');assert.equal(cfg.user,'cycle_owner');
 const db=new Client(cfg);await db.connect();const pool=new Pool({...cfg,max:3});let owned=false,createdRole=false;
 const q=(text:string,values:unknown[]=[])=>db.query(text,values);
 const sql=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8');
 const migration=sql('./sql/003-denis-workflow.up.sql').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
 try{
  assert.equal((await q("SELECT to_regnamespace('noco') AS ns")).rows[0].ns,null,'never replace an existing schema');
  if(!(await q("SELECT 1 FROM pg_roles WHERE rolname='unicorn_sql_app'")).rows.length){await q('CREATE ROLE unicorn_sql_app');createdRole=true;}
  await q(`COMMENT ON DATABASE unicorn_noco_copy_restore IS '${COPY_MARKER}';CREATE SCHEMA noco;
   CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_name text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,clients_id bigint REFERENCES noco.clients(id),platforms_id bigint REFERENCES noco.platforms(id),url text,login text,password text,__nc_deleted boolean DEFAULT false);
   CREATE TABLE noco.octo_profiles(profile_id bigint PRIMARY KEY,client_id bigint REFERENCES noco.clients(id),locale text,revision bigint,state jsonb,
    CONSTRAINT octo_profiles_state_check CHECK ((state->>'revision')::bigint=revision));
   INSERT INTO noco.clients VALUES(101,'Test'),(102,'Other');INSERT INTO noco.platforms VALUES(16,'LinkedIn'),(31,'email_outlook');
   INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES(11,101,16,'https://linkedin.com/in/test','test','fixture'),(12,101,31,'','test@outlook.com','fixture');`);owned=true;
  await q(sql('./sql/001.up.sql'));
  for(const [id,clientId,uuid] of [[1,101,'known'],[2,102,'known'],[3,101,'unproven']] as const){
   await q('INSERT INTO noco.octo_profiles VALUES($1,$2,\'en\',1,$3::jsonb)',[id,clientId,JSON.stringify({id,revision:1,clientId,locale:'en',phase:'ready',proxy:{uuid},createdAt:1,original:{title:'Fixture'}})]);
  }
  await q(`INSERT INTO noco.linkedin_creation_task(client_id,linkedin_account_id,outlook_account_id,proxy_profile_id,proxy_uuid,proxy_saved_at)
   VALUES(101,11,12,1,'known',clock_timestamp()),(101,11,12,2,'known',clock_timestamp());`);
  await q('BEGIN');await q(migration);
  assert.equal((await q('SELECT proxy_is_made_by_expert FROM noco.octo_profiles WHERE profile_id=1')).rows[0].proxy_is_made_by_expert,true);
  assert.deepEqual((await q('SELECT revision,(state->>\'revision\')::bigint AS state_revision FROM noco.octo_profiles WHERE profile_id=1')).rows[0],
   {revision:'2',state_revision:'2'});
  await q('ROLLBACK');
  assert.equal((await q("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='noco' AND table_name='platform_accounts' AND column_name='is_banned'")).rows[0].count,0);
  await q(sql('./sql/003-denis-workflow.up.sql'));
  await q('BEGIN');await q(sql('../console-intake/sql/002-existing-connection.up.sql'));await q('ROLLBACK');
  assert.equal((await q("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='noco' AND table_name='platform_accounts' AND column_name='linkedin_octo_connection_pending'")).rows[0].count,0);
  await q(sql('../console-intake/sql/002-existing-connection.up.sql'));await q(sql('../console-intake/sql/002-existing-connection.up.sql'));
  assert.deepEqual((await q('SELECT proxy_is_made_by_expert FROM noco.octo_profiles ORDER BY profile_id')).rows.map((r:any)=>r.proxy_is_made_by_expert),[true,false,false]);
  assert.ok((await q('SELECT is_banned FROM noco.platform_accounts')).rows.every((r:any)=>r.is_banned===false));
  const revision=(await q('SELECT revision FROM noco.octo_profiles WHERE profile_id=1')).rows[0].revision;
  await q(sql('./sql/003-denis-workflow.up.sql'));
  assert.equal((await q('SELECT revision FROM noco.octo_profiles WHERE profile_id=1')).rows[0].revision,revision);
  const store=createCreationTaskStore(pool,'unicorn_noco_copy_restore');
  const done=await store.status(1,1,'сделана экспертом');
  const confirmed=await Promise.all([store.confirm(1,done.version),store.confirm(1,done.version)]);
  assert.ok(confirmed.every(task=>task.status==='выполнение подтверждено'));assert.equal(confirmed[0].version,done.version+1);assert.deepEqual(confirmed[0],confirmed[1]);
  await q(`DELETE FROM noco.linkedin_creation_task WHERE id=2;
   ALTER TABLE noco.platform_accounts ADD COLUMN linkedin_first_name text,ADD COLUMN linkedin_last_name text,
   ADD COLUMN real_location text,ADD COLUMN old_link_blocked text,ADD COLUMN outlook_registered_at timestamptz,ADD COLUMN updated_at timestamptz;`);
  const intake=createLinkedInIntakeStore(pool,'unicorn_noco_copy_restore');
  await assert.rejects(intake.reportBan(102,11),{code:'linkedin_intake_replacement_stale'});
  const ban=await intake.reportBan(101,11);
  assert.ok(ban.banUndoVersion);
  const markedAt=(await q('SELECT updated_at FROM noco.platform_accounts WHERE id=11')).rows[0].updated_at;
  assert.equal((await intake.reportBan(101,11)).banUndoVersion,undefined);
  assert.deepEqual((await q('SELECT updated_at FROM noco.platform_accounts WHERE id=11')).rows[0].updated_at,markedAt);
  assert.equal((await intake.load(101)).isBanned,true);
  assert.equal((await intake.load(101)).archivedBlockedAccounts?.length,1,'the active banned account is visible before archival');
  await assert.rejects(intake.cancelBan(102,11,ban.banUndoVersion!),{code:'linkedin_intake_replacement_stale'});
  await intake.cancelBan(101,11,ban.banUndoVersion!);await intake.cancelBan(101,11,ban.banUndoVersion!);
  assert.equal((await intake.load(101)).isBanned,false);
  assert.equal((await intake.load(101)).archivedBlockedAccounts?.length,0);
  const nextBan=await intake.reportBan(101,11);
  await assert.rejects(intake.cancelBan(101,11,ban.banUndoVersion!),{code:'linkedin_intake_ban_changed'},'a previous receipt cannot undo a later report');
  await q("UPDATE noco.platform_accounts SET login='changed@example.test' WHERE id=11");
  await assert.rejects(intake.cancelBan(101,11,nextBan.banUndoVersion!),{code:'linkedin_intake_ban_changed'});
  assert.equal((await intake.load(101)).isBanned,true,'concurrent changes survive cancellation');
  assert.equal((await q('SELECT count(*)::int AS count FROM noco.linkedin_creation_task')).rows[0].count,1);
  await q('UPDATE noco.octo_profiles SET state=jsonb_set(state,\'{proxy,isMadeByExpert}\',\'true\'::jsonb,true) WHERE profile_id=3');
  assert.equal((await q('SELECT proxy_is_made_by_expert FROM noco.octo_profiles WHERE profile_id=3')).rows[0].proxy_is_made_by_expert,true);
  await q("CREATE TABLE noco.octo_clients(client_id bigint PRIMARY KEY,state jsonb); INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,url,login,password) VALUES(21,102,16,'https://linkedin.com/in/other','old','fixture')");
  const draft=parseIntake({scenario:'existing',stage:'credentials',url:'https://linkedin.com/in/other',login:'other@example.com',password:'new-fixture'});
  const saved=await intake.save(102,draft,['ru','en']);assert.equal(saved.linkedinAccountId,21);
  await intake.save(102,{...draft,password:''},['ru','en']);
  assert.equal((await intake.load(102)).octoConnectionPending,true);
  assert.equal((await q('SELECT count(*)::int AS count FROM noco.linkedin_intake_notifications WHERE client_id=102')).rows[0].count,0);
  await assert.rejects(intake.save(102,{...draft,stage:'complete',loggedIn:true,password:''},['ru','en']),{code:'linkedin_intake_infrastructure_required'});
  await q("INSERT INTO noco.octo_profiles VALUES(4,102,'ru',1,'{\"id\":4,\"clientId\":102,\"revision\":1,\"phase\":\"ready\"}')");
  await q("INSERT INTO noco.octo_clients VALUES(102,'{\"setup\":{\"phase\":\"checking\"}}')");
  await assert.rejects(intake.save(102,{...draft,stage:'complete',loggedIn:true,password:''},['ru','en']),{code:'linkedin_intake_infrastructure_required'});
  await q("UPDATE noco.octo_clients SET state='{\"setup\":{\"phase\":\"complete\"}}'");
  await intake.save(102,{...draft,stage:'complete',loggedIn:true,password:''},['ru','en']);
  await intake.save(102,{...draft,stage:'complete',loggedIn:true,password:''},['ru','en']);
  assert.equal((await intake.load(102)).octoConnectionPending,false);
  assert.equal((await q('SELECT password FROM noco.platform_accounts WHERE id=21')).rows[0].password,'new-fixture');
  assert.equal((await q('SELECT count(*)::int AS count FROM noco.linkedin_intake_notifications WHERE client_id=102')).rows[0].count,1);
 }finally{
  await pool.end();await q('ROLLBACK');if(owned)await q('DROP SCHEMA noco CASCADE');
  if(createdRole){await q('DROP OWNED BY unicorn_sql_app');await q('DROP ROLE unicorn_sql_app');}await db.end();
 }
});
