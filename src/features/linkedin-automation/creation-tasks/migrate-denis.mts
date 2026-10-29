import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {assertCopyDatabase} from '../../../integrations/postgres/read-session.mts';
export async function migrateDenisWorkflow(env:NodeJS.ProcessEnv,apply=false,open=createPostgresPool){
 const config=readPostgresAppDbConfig(env),pool=open(config),s=await pool.connect();
 try{
  await s.query('BEGIN READ WRITE');await assertCopyDatabase(s,config.database);await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');
  const matched=(await s.query(`SELECT count(*)::int AS count FROM noco.octo_profiles p
   WHERE p.state->'proxy'->>'uuid' IS NOT NULL AND NOT coalesce((p.state->'proxy'->>'isMadeByExpert')::boolean,false)
   AND EXISTS(SELECT 1 FROM noco.linkedin_creation_task t WHERE t.client_id=p.client_id AND t.proxy_profile_id=p.profile_id
   AND t.proxy_uuid=p.state->'proxy'->>'uuid' AND t.proxy_saved_at IS NOT NULL)`)).rows[0]?.count??0;
  const sql=(await readFile(new URL('./sql/003-denis-workflow.up.sql',import.meta.url),'utf8')).replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
  await s.query(sql);
  await s.query('SELECT is_banned FROM noco.platform_accounts LIMIT 0');
  await s.query('SELECT proxy_is_made_by_expert FROM noco.octo_profiles LIMIT 0');
  await s.query('SELECT account_id,state FROM noco.linkedin_intake_notifications LIMIT 0');
  await s.query(apply?'COMMIT':'ROLLBACK');
  return{applied:apply,matchedExpertProxies:Number(matched)};
 }finally{await s.query('ROLLBACK').catch(()=>{});s.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.slice(2).some(arg=>!['--apply','--dry-run'].includes(arg))||process.argv.includes('--apply')&&process.argv.includes('--dry-run'))throw Error('invalid_migration_arguments');
  console.log(JSON.stringify(await migrateDenisWorkflow(process.env,process.argv.includes('--apply'))));
 }catch{console.error(JSON.stringify({error:'linkedin_denis_migration_failed'}));process.exitCode=1;}
}
