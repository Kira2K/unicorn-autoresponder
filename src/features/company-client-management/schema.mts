import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createWorkingCatalog, quoted, tableSql } from '../../integrations/postgres/working-catalog.mts';
import { createReadSession } from '../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../integrations/postgres/working-session.mts';
import { PostgresReadError } from '../../integrations/postgres/contracts.mts';
import type { CopyDatabase, SqlPool, SqlSession } from '../../integrations/postgres/contracts.mts';
import { inspectMigrationPermissions } from './migration-permissions.mts';
import type { MigrationPermissions } from './migration-permissions.mts';
import { BUSINESS_TABLES,BUSINESS_VIEWS,RELOCATION_VERSION } from './business-location.mts';
import type { BusinessSchema } from './business-location.mts';
import { EXISTING_RESTRICTIONS_VERSION } from './restrictions/existing.mts';
import { restorationSql,removedRestrictionObjects } from './restrictions/restore.mts';
import { WORKFLOW_VERSION,WORKFLOW_TABLES,workflowDdl } from './workflow-relocation/definition.mts';
const { TABLES } = createRequire(import.meta.url)('../../integrations/noco/core/schema.ts');
export const VERSION = '001_core';
const expectedTables = ['schema_migrations','legacy_records','companies','company_identifiers','company_restrictions','vacancies','applications','client_company_events'];
export type SchemaPlan = { version:string; checksum:string; sql:string; status:'pending'|'applied'; businessSchema:BusinessSchema; clientTable:string; clientKey:string; deployment:MigrationPermissions };

export async function inspectCompanySchema(session:SqlSession):Promise<SchemaPlan> {
  const catalog = createWorkingCatalog((await session.query("SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
  const clients = catalog.get(TABLES.clients.id), pk = clients.columns.filter(c=>c.pk);
  if(pk.length!==1 || pk[0].sqlType!=='bigint') throw new PostgresReadError('unsupported_client_key');
  const clientTable=tableSql(clients), clientKey=quoted(pk[0].sqlName);
  const actualKey=(await session.query(`SELECT a.attname AS name,a.atttypid::regtype::text AS type,i.indnkeyatts AS key_count
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid=to_regclass($1) AND i.indisprimary`,[clientTable])).rows;
  if(actualKey.length!==1 || actualKey[0].name!==pk[0].sqlName || actualKey[0].type!=='bigint' || Number(actualKey[0].key_count)!==1)
    throw new PostgresReadError('client_key_mapping_mismatch');
  const template = (await readFile(new URL('./migrations/001_core.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  const sql=template.replaceAll('{{CLIENTS_TABLE}}',clientTable).replaceAll('{{CLIENTS_PK}}',clientKey);
  const checksum=createHash('sha256').update(sql).digest('hex');
  const found=(await session.query("SELECT to_regnamespace('company_management')::text AS schema, to_regclass('company_management.schema_migrations')::text AS ledger")).rows[0];
  let status:SchemaPlan['status']='pending';
  let businessSchema:BusinessSchema='company_management';
  if(found?.schema) {
    if(!found.ledger) throw new PostgresReadError('unmanaged_company_schema');
    const versions=(await session.query('SELECT version,checksum FROM company_management.schema_migrations')).rows;
    const core=versions.find(v=>v.version===VERSION),directory=versions.find(v=>v.version==='002_directory'),relocation=versions.find(v=>v.version===RELOCATION_VERSION);
    if(!core || core.checksum!==checksum || versions.some(v=>![VERSION,'002_directory',RELOCATION_VERSION,'004_runtime',EXISTING_RESTRICTIONS_VERSION,WORKFLOW_VERSION].includes(String(v.version)))) throw new PostgresReadError('company_schema_version_mismatch');
    const runtime=versions.find(v=>v.version==='004_runtime');
    const workflow=versions.find(v=>v.version===WORKFLOW_VERSION);
    if(workflow && (!runtime || workflow.checksum!==(await workflowDdl()).checksum))throw new PostgresReadError('company_schema_version_mismatch');
    const restored=versions.find(v=>v.version===EXISTING_RESTRICTIONS_VERSION);
    if(restored) {
      const {digest}=await import('./legacy-snapshot.mts');
      if(!runtime || restored.checksum!==digest((await restorationSql(session)).sql))throw new PostgresReadError('company_schema_version_mismatch');
    }
    if(runtime) {
      const {runtimeSql}=await import('./runtime-migration/index.mts');
      const {digest}=await import('./legacy-snapshot.mts');
      if(!relocation || runtime.checksum!==digest(await runtimeSql(session)))throw new PostgresReadError('company_schema_version_mismatch');
    }
    if(directory){
      const ddl=(await readFile(new URL('./migrations/002_directory.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
      if(directory.checksum!==createHash('sha256').update(ddl).digest('hex'))throw new PostgresReadError('company_schema_version_mismatch');
    }
    const tables=(await session.query("SELECT tablename FROM pg_tables WHERE schemaname='company_management'")).rows.map(r=>r.tablename);
    if(relocation) {
      const ddl=(await readFile(new URL('./migrations/003_noco_business.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
      if(!directory || relocation.checksum!==createHash('sha256').update(ddl).digest('hex'))throw new PostgresReadError('company_schema_version_mismatch');
      businessSchema='noco';
      const movedTables=(await session.query("SELECT tablename FROM pg_tables WHERE schemaname='noco'")).rows.map(r=>r.tablename);
      const movedViews=(await session.query("SELECT viewname FROM pg_views WHERE schemaname='noco'")).rows.map(r=>r.viewname);
      if(workflow && WORKFLOW_TABLES.some(t=>!movedTables.includes(t)||tables.includes(t)))throw new PostgresReadError('workflow_schema_incomplete');
      const requiredTables=BUSINESS_TABLES.filter(t=>!restored||!removedRestrictionObjects.includes(t));
      const requiredViews=BUSINESS_VIEWS.filter(v=>!restored||!removedRestrictionObjects.includes(v));
      if(requiredTables.some(t=>!movedTables.includes(t)||tables.includes(t)) || requiredViews.some(v=>!movedViews.includes(v)) || ['schema_migrations','legacy_records','directory_imports'].some(t=>!tables.includes(t)) || restored&&removedRestrictionObjects.some(t=>movedTables.includes(t)||movedViews.includes(t)))throw new PostgresReadError('company_schema_incomplete');
    } else {
      if(expectedTables.some(t=>!tables.includes(t))) throw new PostgresReadError('company_schema_incomplete');
      const views=(await session.query("SELECT viewname FROM pg_views WHERE schemaname='company_management'")).rows.map(r=>r.viewname);
      if(['active_restrictions','client_company_summary'].some(v=>!views.includes(v)))throw new PostgresReadError('company_schema_incomplete');
      if(directory && (['sources','directory_imports'].some(t=>!tables.includes(t))||!views.includes('company_directory')))throw new PostgresReadError('company_schema_incomplete');
    }
    status='applied';
  }
  const deployment=status==='applied'?{allowed:true,missingPrivileges:[]}:await inspectMigrationPermissions(session,clientTable,pk[0].sqlName);
  return {version:VERSION,checksum,sql,status,businessSchema,clientTable,clientKey,deployment};
}

/** Reads mapped metadata and renders the reviewed DDL; no schema or row changes. */
export async function planSchema(pool:SqlPool,database:CopyDatabase):Promise<SchemaPlan & {database:CopyDatabase}> {
  return createReadSession(pool,database)(async session=>({...await inspectCompanySchema(session),database}));
}

/** Explicit entry point only; never called by application startup. */
export async function applySchema(pool:SqlPool,database:CopyDatabase,expectedChecksum:string) {
  return writeTransaction(pool,database,async session=>{
    await session.query("SELECT pg_advisory_xact_lock(1789941001,1)");
    const plan=await inspectCompanySchema(session);
    if(!expectedChecksum || plan.checksum!==expectedChecksum) throw new PostgresReadError('migration_plan_changed');
    if(plan.status==='applied') return {version:VERSION,status:'already_applied' as const,checksum:plan.checksum};
    if(!plan.deployment.allowed)throw new PostgresReadError('company_schema_permission_denied');
    await session.query(plan.sql);
    await session.query('INSERT INTO company_management.schema_migrations(version,checksum) VALUES($1,$2)',[VERSION,plan.checksum]);
    return {version:VERSION,status:'applied' as const,checksum:plan.checksum};
  });
}
