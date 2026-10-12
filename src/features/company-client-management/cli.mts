import { parseArgs } from 'node:util';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../platform/db/postgres/config.mts';
import { PostgresReadError } from '../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../integrations/postgres/contracts.mts';
import { planSchema,applySchema } from './schema.mts';
import { inspectSnapshot } from './legacy-snapshot.mts';
import { exportLegacySnapshot } from './legacy-export.mts';
import { importLegacySnapshot } from './legacy-import.mts';
import { planDirectory,applyDirectory } from './directory/import.mts';
import { planRuntime,applyRuntime } from './runtime-migration/index.mts';
import { planArchive,archiveLegacy } from './runtime-migration/archive.mts';
import { planBusinessRelocation,applyBusinessRelocation } from './relocation/index.mts';
import { planRestoreRestrictions,restoreRestrictions } from './restrictions/restore.mts';
import { planWorkflowRelocation,applyWorkflowRelocation } from './workflow-relocation/index.mts';

export function parseCommand(args:string[]) {
  const {values,positionals}=parseArgs({args,allowPositionals:true,strict:true,options:{
    env:{type:'string'},out:{type:'string'},input:{type:'string'},'expect-checksum':{type:'string'},'noco-role':{type:'string'},apply:{type:'boolean'},'dry-run':{type:'boolean'},help:{type:'boolean'}
  }});
  const command=positionals[0];
  if(values.help)return {command:'help' as const,values};
  if(positionals.length!==1 || !['plan','apply','export-legacy','import-legacy','directory-plan','directory-apply','relocate-plan','relocate-apply','runtime-plan','runtime-apply','archive-plan','archive-apply','restrictions-restore-plan','restrictions-restore-apply','workflow-plan','workflow-apply'].includes(command))throw Error('invalid_command');
  if(command.startsWith('relocate-')&&!values['noco-role'])throw Error('noco_role_required');
  if(!command.startsWith('relocate-')&&values['noco-role'])throw Error('invalid_mode');
  if((values.apply || values['dry-run']) && command!=='import-legacy' || values.apply && values['dry-run'])throw Error('invalid_mode');
  if(['import-legacy','directory-plan','directory-apply','restrictions-restore-apply'].includes(command) && !values.input)throw Error('input_required');
  if(['export-legacy','restrictions-restore-plan','workflow-plan'].includes(command) && !values.out)throw Error('output_required');
  if((command==='apply' || command==='directory-apply' || command==='relocate-apply' || command==='runtime-apply' || command==='archive-apply' || command==='restrictions-restore-apply' || command==='workflow-apply' || command==='import-legacy' && values.apply) && !/^[a-f0-9]{64}$/.test(values['expect-checksum']??''))throw Error('reviewed_checksum_required');
  return {command,values};
}
async function save(path:string,value:string) {
  const file=resolve(path);await mkdir(dirname(file),{recursive:true});
  await writeFile(file,value,{flag:'wx',mode:0o600});
}
export async function main(args=process.argv.slice(2)) {
  const {command,values}=parseCommand(args);
  if(command==='help') {
    console.log('company:sql workflow-plan --out private-backup.json\ncompany:sql workflow-apply --expect-checksum HASH [--out result.json]');
    console.log('company:sql restrictions-restore-plan --out private-backup.json\ncompany:sql restrictions-restore-apply --input private-backup.json --expect-checksum HASH');
    console.log('company:sql runtime-plan|archive-plan [--env PATH] [--out plan.json]\ncompany:sql runtime-apply|archive-apply --expect-checksum HASH [--env PATH] [--out result.json]');
    console.log('company:sql relocate-plan --noco-role ROLE [--env PATH] [--out plan.json]\ncompany:sql relocate-apply --noco-role ROLE --expect-checksum HASH [--env PATH] [--out result.json]');
    console.log('company:sql directory-plan --input reviewed.json [--env PATH] [--out plan.json]\ncompany:sql directory-apply --input reviewed.json --expect-checksum HASH [--env PATH] [--out result.json]');
    console.log('company:sql plan [--env PATH] [--out migration.sql]\ncompany:sql apply --expect-checksum HASH [--env PATH]\ncompany:sql export-legacy --out snapshot.json [--env PATH]\ncompany:sql import-legacy --input snapshot.json [--dry-run]\ncompany:sql import-legacy --input snapshot.json --apply --expect-checksum HASH [--env PATH]\nNo runtime cutover or name matching. Output files are never overwritten.');return;
  }
  const snapshot=['import-legacy','directory-plan','directory-apply','restrictions-restore-apply'].includes(command)?JSON.parse(await readFile(resolve(values.input!),'utf8')):undefined;
  if(command==='import-legacy' && !values.apply) {console.log(JSON.stringify({mode:'dry-run',...inspectSnapshot(snapshot)},null,2));return;}
  process.loadEnvFile(values.env??'.env');
  const config=readPostgresAppDbConfig(process.env);let pool:SqlPool|undefined;
  try {
    pool=createPostgresPool(config);
    if(command==='workflow-plan') {
      const plan=await planWorkflowRelocation(pool,config.database);
      await save(values.out!,JSON.stringify(plan,null,2)+'\n');
      const {sql,backup,before,...summary}=plan;console.log(JSON.stringify({...summary,out:resolve(values.out!)},null,2));
    } else if(command==='workflow-apply') {
      const result=await applyWorkflowRelocation(pool,config.database,values['expect-checksum']!);
      if(values.out)await save(values.out,JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify(result,null,2));
    } else if(command==='restrictions-restore-plan') {
      const plan=await planRestoreRestrictions(pool,config.database);
      await save(values.out!,JSON.stringify(plan,null,2)+'\n');
      console.log(JSON.stringify({status:plan.status,checksum:plan.checksum,backupHash:plan.backupHash,policies:plan.backup?.policies.length,out:resolve(values.out!)},null,2));
    } else if(command==='restrictions-restore-apply') {
      if(snapshot.checksum!==values['expect-checksum'])throw Error('restriction_restoration_plan_changed');
      const result=await restoreRestrictions(pool,config.database,snapshot);
      if(values.out)await save(values.out,JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify(result,null,2));
    } else if(['runtime-plan','runtime-apply','archive-plan','archive-apply'].includes(command)) {
      const result=command==='runtime-plan'?await planRuntime(pool,config.database):command==='runtime-apply'?await applyRuntime(pool,config.database,values['expect-checksum']!):command==='archive-plan'?await planArchive(pool,config.database):await archiveLegacy(pool,config.database,values['expect-checksum']!);
      if(values.out)await save(values.out,JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify(result,null,2));
    } else if(command==='relocate-plan'||command==='relocate-apply') {
      const result=command==='relocate-plan'?await planBusinessRelocation(pool,config.database,values['noco-role']!):await applyBusinessRelocation(pool,config.database,values['noco-role']!,values['expect-checksum']!);
      if(values.out)await save(values.out,JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify(result,null,2));
    } else if(command==='directory-plan'||command==='directory-apply') {
      const result=command==='directory-plan'?await planDirectory(pool,config.database,snapshot):await applyDirectory(pool,config.database,snapshot,values['expect-checksum']!);
      if(values.out)await save(values.out,JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify(result,null,2));
    } else if(command==='plan') {
      const plan=await planSchema(pool,config.database);
      if(values.out){await save(values.out,plan.sql);const {sql,...metadata}=plan;await save(values.out+'.json',JSON.stringify(metadata,null,2)+'\n');}
      const {sql,...metadata}=plan;console.log(JSON.stringify(metadata,null,2));
    } else if(command==='apply')console.log(JSON.stringify(await applySchema(pool,config.database,values['expect-checksum']!),null,2));
    else if(command==='export-legacy') {
      const result=await exportLegacySnapshot(pool,config.database);await save(values.out!,JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify({out:resolve(values.out!),...inspectSnapshot(result)},null,2));
    } else {
      const result=await importLegacySnapshot(pool,config.database,snapshot,values['expect-checksum']!);
      if(values.out)await save(values.out,JSON.stringify(result,null,2)+'\n');
      const {review,...summary}=result;console.log(JSON.stringify(summary,null,2));
    }
  }finally{await pool?.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{
    const local=new Set(['invalid_command','invalid_mode','input_required','output_required','reviewed_checksum_required','noco_role_required']);
    const code=error instanceof PostgresReadError?error.code:local.has(error?.message)?error.message:error?.code==='EEXIST'?'output_exists':'company_sql_command_failed';
    console.error(`company:sql: ${code}`);process.exitCode=1;
  });
}
