import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { CopyDatabase,SqlPool,SqlSession } from '../../../integrations/postgres/contracts.mts';
import { quoted } from '../../../integrations/postgres/working-catalog.mts';
import { inspectCompanySchema } from '../schema.mts';
import { digest } from '../legacy-snapshot.mts';
import { BUSINESS_TABLES,BUSINESS_VIEWS,RELOCATION_VERSION } from '../business-location.mts';
import { captureRelocationState,relocationObjects } from './snapshot.mts';

async function inspect(session:SqlSession,database:CopyDatabase,nocoRole:string) {
  if(!nocoRole || nocoRole.length>63 || nocoRole.includes('\0'))throw new PostgresReadError('company_relocation_role_invalid');
  const schema=await inspectCompanySchema(session);
  if(schema.status!=='applied')throw new PostgresReadError('company_schema_required');
  const versions=(await session.query('SELECT version FROM company_management.schema_migrations')).rows;
  if(!versions.some(v=>v.version==='002_directory'))throw new PostgresReadError('company_directory_schema_required');
  const sql=(await readFile(new URL('../migrations/003_noco_business.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  const sqlChecksum=createHash('sha256').update(sql).digest('hex');
  const role=(await session.query('SELECT oid::text AS oid FROM pg_roles WHERE rolname=$1',[nocoRole])).rows[0];
  if(!role)throw new PostgresReadError('company_relocation_role_missing');
  const objects=await relocationObjects(session,schema.businessSchema);
  if(schema.businessSchema==='noco') {
    const details=(await session.query('SELECT details FROM company_management.schema_migrations WHERE version=$1',[RELOCATION_VERSION])).rows[0]?.details as {planChecksum:string;nocoRole:string;counts:Record<string,number>}|undefined;
    if(!details || details.nocoRole!==nocoRole)throw new PostgresReadError('company_relocation_receipt_mismatch');
    return {database,version:RELOCATION_VERSION,status:'already_applied' as const,checksum:details.planChecksum,sqlChecksum,nocoRole,sql,objects,counts:details.counts,deployment:{allowed:true,missingPrivileges:[] as string[]}};
  }
  const collisions=(await session.query("SELECT c.relname FROM pg_class c WHERE c.relnamespace=to_regnamespace('noco') AND c.relname=ANY($1::text[])",[objects.map(o=>o.name)])).rows;
  if(collisions.length)throw new PostgresReadError('company_relocation_collision');
  const permissions=(await session.query(`SELECT has_schema_privilege('noco','CREATE') AS create_target,
    has_schema_privilege('company_management','USAGE') AS use_origin,
    pg_has_role((SELECT relowner FROM pg_class WHERE oid='company_management.schema_migrations'::regclass),'USAGE') AS own_ledger,
    bool_and(pg_has_role(c.relowner,'USAGE')) AS own_objects FROM pg_class c WHERE c.oid=ANY($1::oid[])`,[objects.map(o=>o.oid)])).rows[0];
  const requirements=[['create_target','CREATE on noco'],['use_origin','USAGE on company_management'],['own_ledger','ownership of migration ledger'],['own_objects','ownership of moving objects']];
  const missingPrivileges=requirements.filter(([key])=>permissions?.[key]!==true).map(([,label])=>label);
  const checksum=digest({database,sqlChecksum,nocoRole,roleOid:role.oid,objects});
  return {database,version:RELOCATION_VERSION,status:'pending' as const,checksum,sqlChecksum,nocoRole,sql,objects,counts:undefined,deployment:{allowed:!missingPrivileges.length,missingPrivileges}};
}

/** Read-only: validate the applied migrations, role, ownership and all target-name collisions. */
export async function planBusinessRelocation(pool:SqlPool,database:CopyDatabase,nocoRole:string) {
  return createReadSession(pool,database)(async s=>{const {sql,...plan}=await inspect(s,database,nocoRole);return plan;});
}

/** Explicit move, no copies or drops. Full data/structure verification and receipt share one commit. */
export async function applyBusinessRelocation(pool:SqlPool,database:CopyDatabase,nocoRole:string,expectedChecksum:string) {
  return writeTransaction(pool,database,async session=>{
    await session.query('SELECT pg_advisory_xact_lock(1789941001,1)');
    await session.query("SET LOCAL lock_timeout='5s'");
    let plan=await inspect(session,database,nocoRole);
    if(plan.checksum!==expectedChecksum)throw new PostgresReadError('company_relocation_plan_changed');
    if(plan.status==='already_applied')return {status:'already_applied' as const,checksum:plan.checksum,counts:plan.counts!};
    if(!plan.deployment.allowed)throw new PostgresReadError('company_relocation_permission_denied');
    await session.query('LOCK TABLE '+[...BUSINESS_TABLES,'legacy_records','directory_imports','schema_migrations'].map(n=>'company_management.'+n).join(',')+' IN ACCESS EXCLUSIVE MODE');
    plan=await inspect(session,database,nocoRole);
    if(plan.checksum!==expectedChecksum)throw new PostgresReadError('company_relocation_plan_changed');
    const before=await captureRelocationState(session,'company_management');
    await session.query(plan.sql);
    const after=await captureRelocationState(session,'noco');
    if(digest(before)!==digest(after))throw new PostgresReadError('company_relocation_preservation_failed');
    await session.query('GRANT USAGE ON SCHEMA noco TO '+quoted(nocoRole));
    await session.query('GRANT SELECT ON '+[...BUSINESS_TABLES,...BUSINESS_VIEWS].map(n=>'noco.'+n).join(',')+' TO '+quoted(nocoRole));
    const counts=Object.fromEntries(Object.entries(after.records).map(([name,r])=>[name,r.count]));
    await session.query('INSERT INTO company_management.schema_migrations(version,checksum,details) VALUES($1,$2,$3::jsonb)',[
      RELOCATION_VERSION,plan.sqlChecksum,JSON.stringify({planChecksum:plan.checksum,nocoRole,counts,preserved:after})
    ]);
    await inspectCompanySchema(session);
    return {status:'applied' as const,checksum:plan.checksum,counts};
  });
}
