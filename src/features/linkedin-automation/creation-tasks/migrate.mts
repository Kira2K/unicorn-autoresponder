import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { assertCopyDatabase } from '../../../integrations/postgres/read-session.mts';
export async function migrateCreationTasks(env: NodeJS.ProcessEnv, apply: boolean) {
  const config=readPostgresAppDbConfig(env),pool=createPostgresPool(config),s=await pool.connect();
  try {
    await s.query('BEGIN READ WRITE'); await assertCopyDatabase(s,config.database);
    // Existing owner role, same as the Octo migrations. No changes to existing records.
    await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');
    const sql=await readFile(new URL('./sql/001.up.sql',import.meta.url),'utf8');
    await s.query(sql); await s.query(sql);
    const role=(await s.query('SELECT session_user AS name')).rows[0].name as string;
    const quoted='"'+role.replaceAll('"','""')+'"';
    await s.query(`GRANT SELECT,INSERT,UPDATE ON noco.linkedin_creation_task TO ${quoted}`);
    await s.query(`GRANT USAGE,SELECT ON SEQUENCE noco.linkedin_creation_task_id_seq TO ${quoted}`);
    await s.query(apply?'COMMIT':'ROLLBACK');
    return {applied:apply,rerunVerified:true};
  } finally {await s.query('ROLLBACK').catch(()=>{});s.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try{console.log(JSON.stringify(await migrateCreationTasks(process.env,process.argv.includes('--apply'))));}
  catch(e){console.error(JSON.stringify({error:(e as {code?:string}).code||'linkedin_task_migration_failed'}));process.exitCode=1;}
}
