import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {assertCopyDatabase} from '../../../integrations/postgres/read-session.mts';

/** Explicit operator command, dry-run by default. Never called by application startup. */
export async function migrateTaskCompletion(env:NodeJS.ProcessEnv,apply=false,open=createPostgresPool){
 const config=readPostgresAppDbConfig(env),pool=open(config),s=await pool.connect();
 try{
  await s.query('BEGIN READ WRITE');await assertCopyDatabase(s,config.database);
  await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');
  const sql=(await readFile(new URL('./sql/004-three-statuses.up.sql',import.meta.url),'utf8'))
   .replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
  await s.query(sql);
  await s.query('SELECT recipient,chat_id,state,message_id,error_code FROM noco.linkedin_cycle_notifications LIMIT 0');
  const remaining=(await s.query("SELECT count(*)::int AS count FROM noco.linkedin_creation_task WHERE status='выполнение подтверждено'")).rows[0]?.count;
  if(Number(remaining)!==0)throw Error('linkedin_completion_schema_incomplete');
  await s.query(apply?'COMMIT':'ROLLBACK');return{applied:apply};
 }finally{await s.query('ROLLBACK').catch(()=>{});s.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);
  if(args.some(a=>!['--apply','--dry-run'].includes(a))||args.includes('--apply')&&args.includes('--dry-run'))throw Error('invalid_migration_arguments');
  console.log(JSON.stringify(await migrateTaskCompletion(process.env,args.includes('--apply'))));
 }catch(e){
  const pending=String((e as Error).message).match(/linkedin_pending_expert_tasks: ([\d,]+)/);
  console.error(JSON.stringify({error:pending?'linkedin_pending_expert_tasks':'linkedin_completion_migration_failed',
   ...(pending?{taskIds:pending[1].split(',').map(Number)}:{})}));process.exitCode=1;
 }
}
