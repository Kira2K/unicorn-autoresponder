import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {assertCopyDatabase} from '../../../integrations/postgres/read-session.mts';

/** Operator-only, rollback by default. Replaces two function predicates; never updates data. */
export async function migrateCompletionAccess(env:NodeJS.ProcessEnv,apply=false,open=createPostgresPool){
 const config=readPostgresAppDbConfig(env),pool=open(config),s=await pool.connect();
 try{
  await s.query('BEGIN READ WRITE');await assertCopyDatabase(s,config.database);
  await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');
  const sql=(await readFile(new URL('./sql/005-completion-access.up.sql',import.meta.url),'utf8'))
   .replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
  await s.query(sql);await s.query(apply?'COMMIT':'ROLLBACK');return{applied:apply};
 }finally{await s.query('ROLLBACK').catch(()=>{});s.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);
  if(args.some(a=>!['--apply','--dry-run'].includes(a))||args.includes('--apply')&&args.includes('--dry-run'))throw Error('invalid_migration_arguments');
  console.log(JSON.stringify(await migrateCompletionAccess(process.env,args.includes('--apply'))));
 }catch{console.error(JSON.stringify({error:'linkedin_completion_access_migration_failed'}));process.exitCode=1;}
}
