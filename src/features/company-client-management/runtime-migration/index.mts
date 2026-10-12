import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import { createWorkingCatalog,tableSql,quoted } from '../../../integrations/postgres/working-catalog.mts';
import type { SqlSession,SqlPool,CopyDatabase } from '../../../integrations/postgres/contracts.mts';
import { inspectCompanySchema } from '../schema.mts';
import { digest } from '../legacy-snapshot.mts';
import { migrateRestrictionText } from './restrictions.mts';
import { currentLegacy,auditRestrictionCutover } from './audit.mts';
const {TABLES}=createRequire(import.meta.url)('../../../integrations/noco/core/schema.ts');
export const RUNTIME_VERSION='004_runtime';

export async function runtimeSql(session:SqlSession) {
  const catalog=createWorkingCatalog((await session.query("SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
  let sql=(await readFile(new URL('../migrations/004_runtime.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  for(const [key,id] of [['CLIENTS',TABLES.clients.id],['STACKS',TABLES.stacks.id]]) {
    const table=catalog.get(id),pk=table.columns.filter(c=>c.pk);
    if(pk.length!==1||pk[0].sqlType!=='bigint')throw new PostgresReadError('runtime_primary_key_required');
    sql=sql.replaceAll(`{{${key}_TABLE}}`,tableSql(table)).replaceAll(`{{${key}_PK}}`,quoted(pk[0].sqlName));
  }
  return sql;
}
async function inspect(session:SqlSession) {
  const schema=await inspectCompanySchema(session);
  if(schema.businessSchema!=='noco')throw new PostgresReadError('business_relocation_required');
  const sql=await runtimeSql(session),checksum=digest(sql);
  const receipt=(await session.query('SELECT checksum,details FROM company_management.schema_migrations WHERE version=$1',[RUNTIME_VERSION])).rows[0];
  if(receipt&&receipt.checksum!==checksum)throw new PostgresReadError('runtime_migration_changed');
  return {sql,checksum,status:receipt?'already_applied':'pending',details:receipt?.details};
}
export const planRuntime=(pool:SqlPool,database:CopyDatabase)=>createReadSession(pool,database)(async s=>{const {sql,...plan}=await inspect(s);return plan;});
export async function applyRuntime(pool:SqlPool,database:CopyDatabase,checksum:string) {
  return writeTransaction(pool,database,async session=>{
    await session.query('SELECT pg_advisory_xact_lock(1789941001,1)');
    const plan=await inspect(session);
    if(plan.checksum!==checksum)throw new PostgresReadError('runtime_plan_changed');
    if(plan.status==='already_applied')return {status:plan.status,details:plan.details};
    await currentLegacy(session);
    await session.query(plan.sql);
    const contextualRules=await migrateRestrictionText(session);
    const details={contextualRules,coverage:await auditRestrictionCutover(session)};
    await session.query('INSERT INTO company_management.schema_migrations(version,checksum,details) VALUES($1,$2,$3::jsonb)',[RUNTIME_VERSION,checksum,JSON.stringify(details)]);
    return {status:'applied',details};
  });
}
