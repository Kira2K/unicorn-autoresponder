import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { SqlSession,SqlPool,CopyDatabase } from '../../../integrations/postgres/contracts.mts';
import { quoted } from '../../../integrations/postgres/working-catalog.mts';
import { inspectCompanySchema } from '../schema.mts';
import { captureRelocationState,relocationObjects } from '../relocation/snapshot.mts';
import { digest } from '../legacy-snapshot.mts';
import { WORKFLOW_VERSION,WORKFLOW_TABLES,workflowDdl } from './definition.mts';

async function inspect(session:SqlSession,database:CopyDatabase) {
  await inspectCompanySchema(session);
  const versions=(await session.query('SELECT version,checksum,details FROM company_management.schema_migrations')).rows;
  if(!versions.some(v=>v.version==='004_runtime'))throw new PostgresReadError('runtime_migration_required');
  const nocoRole=(versions.find(v=>v.version==='003_noco_business')?.details as {nocoRole?:string}|undefined)?.nocoRole;
  if(!nocoRole)throw new PostgresReadError('noco_role_required');
  const role=(await session.query('SELECT oid::text AS oid FROM pg_roles WHERE rolname=$1',[nocoRole])).rows[0];
  if(!role)throw new PostgresReadError('noco_role_missing');
  const {sql,checksum:sqlChecksum}=await workflowDdl();
  const receipt=versions.find(v=>v.version===WORKFLOW_VERSION);
  if(receipt) {
    const details=receipt.details as {planChecksum:string;nocoRole:string;counts:Record<string,number>};
    if(receipt.checksum!==sqlChecksum || details.nocoRole!==nocoRole)throw new PostgresReadError('workflow_relocation_receipt_mismatch');
    return {database,status:'already_applied' as const,checksum:details.planChecksum,sqlChecksum,sql,nocoRole,counts:details.counts};
  }
  const objects=await relocationObjects(session,'company_management',WORKFLOW_TABLES);
  if(WORKFLOW_TABLES.some(name=>!objects.some(o=>o.name===name&&o.kind==='r')))throw new PostgresReadError('workflow_schema_incomplete');
  if((await session.query("SELECT relname FROM pg_class WHERE relnamespace=to_regnamespace('noco') AND relname=ANY($1::text[])",[objects.map(o=>o.name)])).rows.length)
    throw new PostgresReadError('workflow_relocation_collision');
  const before=await captureRelocationState(session,'company_management',WORKFLOW_TABLES);
  const backup:Record<string,string[]>={};
  for(const name of WORKFLOW_TABLES)backup[name]=(await session.query(`SELECT row_to_json(t)::text AS record FROM company_management.${name} t ORDER BY row_to_json(t)::text`)).rows.map(r=>String(r.record));
  const counts=Object.fromEntries(Object.entries(before.records).map(([name,r])=>[name,r.count]));
  const checksum=digest({database,sqlChecksum,nocoRole,roleOid:role.oid,before,backup});
  return {database,status:'pending' as const,checksum,sqlChecksum,sql,nocoRole,counts,before,backup};
}

/** Read-only checked plan plus private row backup. CLI requires a file before live apply. */
export const planWorkflowRelocation=(pool:SqlPool,database:CopyDatabase)=>createReadSession(pool,database)(s=>inspect(s,database));

/** Move original tables, atomically preserving rows/OIDs/keys/checkpoints and recording the receipt. */
export async function applyWorkflowRelocation(pool:SqlPool,database:CopyDatabase,checksum:string) {
  return writeTransaction(pool,database,async session=>{
    await session.query('SELECT pg_advisory_xact_lock(1789941001,1)');
    await session.query("SET LOCAL lock_timeout='5s'");
    let plan=await inspect(session,database);
    if(plan.checksum!==checksum)throw new PostgresReadError('workflow_relocation_plan_changed');
    if(plan.status==='already_applied')return {status:plan.status,counts:plan.counts};
    await session.query('LOCK TABLE '+WORKFLOW_TABLES.map(n=>'company_management.'+n).join(',')+' IN ACCESS EXCLUSIVE MODE');
    plan=await inspect(session,database);
    if(plan.checksum!==checksum)throw new PostgresReadError('workflow_relocation_plan_changed');
    await session.query(plan.sql);
    const after=await captureRelocationState(session,'noco',WORKFLOW_TABLES);
    if(digest(plan.before)!==digest(after))throw new PostgresReadError('workflow_preservation_failed');
    await session.query('GRANT USAGE ON SCHEMA noco TO '+quoted(plan.nocoRole));
    await session.query('GRANT SELECT ON '+WORKFLOW_TABLES.map(n=>'noco.'+n).join(',')+' TO '+quoted(plan.nocoRole));
    const details={planChecksum:checksum,nocoRole:plan.nocoRole,counts:plan.counts,preserved:after};
    await session.query('INSERT INTO company_management.schema_migrations(version,checksum,details) VALUES($1,$2,$3::jsonb)',[WORKFLOW_VERSION,plan.sqlChecksum,JSON.stringify(details)]);
    await inspectCompanySchema(session);
    return {status:'applied',counts:plan.counts};
  });
}
