import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {assertCopyDatabase} from '../../../integrations/postgres/read-session.mts';
import type {SqlPool,CopyDatabase} from '../../../integrations/postgres/contracts.mts';
export async function migrateLinkedInLocal(pool:SqlPool,database:CopyDatabase,apply=false) {
  const s=await pool.connect();
  try{await s.query('BEGIN READ WRITE');await assertCopyDatabase(s,database);await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');await s.query("SET LOCAL lock_timeout='5s'");
    for(const url of [new URL('../console-intake/sql/003-outlook-forwarding.up.sql',import.meta.url),new URL('./sql/001-proxy-move.up.sql',import.meta.url)]){
      const sql=await readFile(url,'utf8');await s.query(sql);await s.query(sql);
    }
    await s.query(apply?'COMMIT':'ROLLBACK');return{applied:apply,rerunVerified:true};
  }finally{await s.query('ROLLBACK').catch(()=>{});s.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let pool:SqlPool|undefined;
  try{const config=readPostgresAppDbConfig(process.env);pool=createPostgresPool(config);console.log(JSON.stringify(await migrateLinkedInLocal(pool,config.database,process.argv.includes('--apply'))));}
  catch{console.error('linkedin_local_migration_failed');process.exitCode=1;}finally{await pool?.end();}
}
