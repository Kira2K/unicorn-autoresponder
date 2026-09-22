import 'dotenv/config';
import { readFile,readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '../pg-pool.mts';
import { writeTransaction } from '../working-session.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { createAutomationSqlStore } from './store.mts';
import { acquireLinkedInAuthority } from './authority.mts';
import { createWithdrawalFileStore } from '../../../features/linkedin-automation/invitation-withdrawal/file-store.ts';
import { readAutomationDiagnostics } from '../../../features/linkedin-automation/orchestrator/diagnostics.ts';
import { safeCode } from '../../../features/linkedin-automation/orchestrator/audit.ts';
const args=process.argv.slice(2);
async function main() {
  const command=args[0];
  if(!['status','migrate'].includes(command)) throw Object.assign(Error(),{code:'automation_cli_command_required'});
  const config=readPostgresAppDbConfig(process.env);
  if(command==='migrate' && (!args.includes('--apply') ||
    !args.includes(`--target=${config.host}:${config.port}/${config.database}`)))
    throw Object.assign(Error(),{code:'automation_migration_target_confirmation_required'});
  const pool=createPostgresPool(config);
  let authority:Awaited<ReturnType<typeof acquireLinkedInAuthority>>|undefined;
  try {
    const storage=createAutomationSqlStore(pool,config.database);
    if(command==='status') {
      const account=args.find(a=>a.startsWith('--account='))?.split('=')[1];
      if(account && !/^[1-9]\d*$/.test(account)) throw Object.assign(Error(),{code:'automation_account_invalid'});
      const report=await readAutomationDiagnostics(storage.store,Date.now(),{account:account?Number(account):undefined,
        runKey:args.find(a=>a.startsWith('--run='))?.slice(6),limit:100});
      console.log(JSON.stringify(report,null,2));return;
    }
    authority=await acquireLinkedInAuthority(pool,config.database);
    const ddl=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
    await writeTransaction(pool,config.database,s=>s.query(ddl));
    const directory=resolve(process.env.LINKEDIN_WITHDRAWAL_DATA_DIR??'storage/linkedin-invitation-withdrawal');
    const files=await readdir(directory).catch((error:any)=>{if(error?.code==='ENOENT')return [];throw error});
    const fileStore=createWithdrawalFileStore(directory);let imported=0;
    for(const file of files.filter(f=>/^[1-9]\d*\.json$/.test(f))) {
      const id=Number(file.slice(0,-5)),state=await fileStore.load(id);
      if(state){await storage.importWithdrawal(id,state);imported++}
    }
    await storage.finishImport();await storage.checkSchema();
    console.log(JSON.stringify({schemaVersion:1,journalsChecked:imported,sourceFilesPreserved:true}));
  } finally {await authority?.close();await pool.end();}
}
void main().catch(error=>{console.error(safeCode(error?.code,'automation_cli_failed'));process.exitCode=1});
