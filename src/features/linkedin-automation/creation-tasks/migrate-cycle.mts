import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {assertCopyDatabase} from '../../../integrations/postgres/read-session.mts';
export async function migrateAccountCycle(env:NodeJS.ProcessEnv,apply=false,open=createPostgresPool){
 const config=readPostgresAppDbConfig(env),pool=open(config),s=await pool.connect();
 try{
  await s.query('BEGIN READ WRITE');await assertCopyDatabase(s,config.database);await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');
  const ready=(await s.query("SELECT to_regclass('noco.linkedin_cycle_notifications') IS NOT NULL AS ready")).rows[0]?.ready;
  if(!ready)for(const path of ['./sql/002-new-proxy.up.sql','../linklab/sql/006-account-cycle.up.sql']){
   const sql=(await readFile(new URL(path,import.meta.url),'utf8')).replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');await s.query(sql);
  }
  // A partial/manual installation must never be mistaken for a completed release.
  await s.query('SELECT requires_new_proxy FROM noco.linkedin_creation_task LIMIT 0');
  await s.query('SELECT crm_integration_required FROM noco.linklab LIMIT 0');
  await s.query('SELECT baseline_fingerprint,baseline_connection,operation_id FROM noco.linkedin_creation_proxy LIMIT 0');
  const triggers=await s.query("SELECT tgname FROM pg_trigger WHERE tgrelid='noco.linkedin_creation_task'::regclass AND tgname IN ('linkedin_proxy_baseline','linkedin_new_proxy_check','linkedin_confirm_cycle') AND tgenabled<>'D'");
  if(triggers.rows.length!==3)throw new Error('linkedin_cycle_schema_incomplete');
  const role=String((await s.query('SELECT session_user AS name')).rows[0].name),quoted='"'+role.replaceAll('"','""')+'"';
  await s.query(`GRANT SELECT,UPDATE ON noco.linkedin_creation_proxy,noco.linkedin_cycle_notifications TO ${quoted}`);
  await s.query(`GRANT SELECT ON noco.linkedin_account_cycles TO ${quoted}`);
  await s.query(apply?'COMMIT':'ROLLBACK');return{applied:apply,alreadyInstalled:!!ready};
 }finally{await s.query('ROLLBACK').catch(()=>{});s.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await migrateAccountCycle(process.env,process.argv.includes('--apply'))));}
 catch{console.error(JSON.stringify({error:'linkedin_cycle_migration_failed'}));process.exitCode=1;}
}
