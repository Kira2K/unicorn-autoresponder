// Explicit operator command; never imported by the application startup path.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../platform/db/postgres/config.mts';
import { assertCopyDatabase } from '../../integrations/postgres/read-session.mts';
export async function migrateOcto(env: NodeJS.ProcessEnv, apply: boolean) {
  const config=readPostgresAppDbConfig(env),pool=createPostgresPool(config),s=await pool.connect();
  const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const body=(await readFile(new URL('./sql/001-octo.up.sql',import.meta.url),'utf8'))
    .replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
  let committed=false;
  try {
    await s.query('BEGIN READ WRITE'); await assertCopyDatabase(s,config.database);
    await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');
    if ((await s.query("SELECT to_regclass('noco.octo_clients') AS onboarding")).rows[0]?.onboarding)
      throw Object.assign(new Error('octo_001_superseded_by_002'), { code: 'octo_001_superseded_by_002' });
    const snapshot=async()=>({profiles:(await s.query(`SELECT to_jsonb(p)-'browser'-'octo_profile_id' AS row
      FROM noco.dolphin_profiles p ORDER BY id`)).rows,
      inventory:(await s.query("SELECT id,definition FROM copy_meta.inventory WHERE id<>'octo_browser_local' ORDER BY id")).rows});
    const before=await snapshot();
    if(apply) {
      const directory=resolve('storage/octo-access-backups'); await mkdir(directory,{recursive:true});
      const path=resolve(directory,`${Date.now()}-before.json`),text=JSON.stringify({database:config.database,...before});
      await writeFile(path,text,{flag:'wx'});
      if(await readFile(path,'utf8')!==text) throw new Error('octo_backup_verification_failed');
    }
    await s.query(body); await s.query(body); // Rerun is part of the acceptance check, in the same transaction.
    if(hash(before)!==hash(await snapshot())) throw new Error('octo_existing_rows_changed');
    const counts=(await s.query('SELECT count(*)::integer AS profiles FROM noco.dolphin_profiles')).rows[0];
    await s.query(apply?'COMMIT':'ROLLBACK'); committed=apply;
    return {applied:apply,database:config.database,rerunVerified:true,existingRowsUnchanged:true,...counts};
  } finally {
    if(!committed) await s.query('ROLLBACK').catch(()=>{});
    s.release(); await pool.end();
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await migrateOcto(process.env,process.argv.includes('--apply')))); }
  catch(error) { console.error(JSON.stringify({error:(error as any)?.code??'octo_migration_failed',
    // Server schema diagnostics are useful; never print detail (it may include row values).
    message: String((error as any)?.message??'').slice(0,250)})); process.exitCode=1; }
}
