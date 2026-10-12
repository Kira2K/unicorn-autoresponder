import { createRequire } from 'node:module';
import { createWorkingCatalog, quoted, tableSql } from '../../../integrations/postgres/working-catalog.mts';
import { relation } from '../../../integrations/postgres/working-relations.mts';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { SqlSession,SqlPool,CopyDatabase } from '../../../integrations/postgres/contracts.mts';
import { digest } from '../legacy-snapshot.mts';
import { readExistingPolicies,EXISTING_RESTRICTIONS_VERSION as VERSION } from './existing.mts';
import { readReplacementPolicies } from './read.mts';
import type { PolicyRow } from './read.mts';
const {TABLES}=createRequire(import.meta.url)('../../../integrations/noco/core/schema.ts');
export const removedRestrictionObjects=['company_restrictions','active_restrictions','client_company_summary'];

/** Metadata-resolved DDL; original restrictions and their native company links become editable. */
export async function restorationSql(session:SqlSession) {
  const catalog=createWorkingCatalog((await session.query("SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
  const table=catalog.get(TABLES.restrictions.id),clients=catalog.get(TABLES.clients.id);
  const blocked=table.columns.find(c=>c.title==='rel_restrictions_blocked_companies');
  const junction=blocked&&relation(catalog,table.id,blocked.id).junction;
  const stop=clients.columns.find(c=>c.dataKey==='stop_list_company');
  if(!junction||!stop)throw new PostgresReadError('existing_restriction_schema_required');
  const targets=[tableSql(table),tableSql(junction.table)].sort(),clientTable=tableSql(clients);
  const archives=[tableSql(catalog.get(TABLES.companies.id)),tableSql(catalog.get(TABLES.applications.id))];
  const sql=[
    'DROP VIEW noco.client_company_summary;',
    'DROP VIEW noco.active_restrictions;',
    'DROP TABLE noco.company_restrictions;',
    ...targets.flatMap(t=>[`DROP TRIGGER IF EXISTS archived_company_data ON ${t};`,
      `COMMENT ON TABLE ${t} IS 'Original active student restrictions and native company links. Shared by HH and external responses.';`]),
    `DROP TRIGGER IF EXISTS archived_stop_list ON ${clientTable};`,
    `COMMENT ON COLUMN ${clientTable}.${quoted(stop.sqlName)} IS 'Active student company stop-list. Shared by HH and external responses.';`,
    ...archives.map(t=>`COMMENT ON TABLE ${t} IS 'Archived company/application evidence. IDs and native links are preserved.';`),
    `CREATE OR REPLACE FUNCTION company_management.reject_archived_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Archived company/application evidence is read-only.' USING ERRCODE='23514'; END; $$`
  ].join('\n');
  return {sql,targets,locks:[...targets,clientTable,...archives,'noco.companies','company_management.legacy_records','noco.company_restrictions']};
}

const policyHashes=(rows:PolicyRow[])=>rows.map(({id,source,...rule})=>digest(rule)).sort();
export type RestorePlan={version:string;status:'pending'|'already_applied';checksum:string;sql:string;targets:string[];
  backupHash?:string;backup?:{rows:Record<string,unknown>[];views:Record<string,unknown>[];policies:PolicyRow[]};details?:unknown};

async function inspect(session:SqlSession):Promise<RestorePlan> {
  const runtime=(await session.query("SELECT 1 FROM company_management.schema_migrations WHERE version='004_runtime'")).rows.length;
  if(!runtime)throw new PostgresReadError('runtime_migration_required');
  const {sql,targets}=await restorationSql(session),checksum=digest(sql);
  const receipt=(await session.query('SELECT checksum,details FROM company_management.schema_migrations WHERE version=$1',[VERSION])).rows[0];
  if(receipt) {
    if(receipt.checksum!==checksum)throw new PostgresReadError('restriction_restoration_changed');
    return {version:VERSION,status:'already_applied',checksum,sql,targets,details:receipt.details};
  }
  const replacement=await readReplacementPolicies(session,'external-responses'),policies=await readExistingPolicies(session,'external-responses');
  const rows=(await session.query('SELECT to_jsonb(r) AS data FROM noco.company_restrictions r ORDER BY id')).rows.map(r=>r.data as Record<string,unknown>);
  // Also reject inactive/future/channel-only rows: none may disappear just because they are currently filtered out.
  if(rows.length!==replacement.length || digest(policyHashes(replacement))!==digest(policyHashes(policies)))
    throw new PostgresReadError('restriction_equivalence_failed');
  const views=(await session.query("SELECT viewname,definition FROM pg_views WHERE schemaname='noco' AND viewname IN ('active_restrictions','client_company_summary') ORDER BY viewname")).rows;
  if(views.length!==2)throw new PostgresReadError('restriction_views_missing');
  const backup={rows,views,policies};
  return {version:VERSION,status:'pending',checksum,sql,targets,backupHash:digest(backup),backup};
}

/** Private backup/plan; caller persists this before apply. Never print its candidate data in logs. */
export const planRestoreRestrictions=(pool:SqlPool,database:CopyDatabase)=>createReadSession(pool,database)(inspect);

/** One transaction, explicit plan, no CASCADE, no new restriction storage. */
export async function restoreRestrictions(pool:SqlPool,database:CopyDatabase,reviewed:RestorePlan) {
  return writeTransaction(pool,database,async session=>{
    await session.query('SELECT pg_advisory_xact_lock(1789941001,1)');
    const ddl=await restorationSql(session);
    if(reviewed.version!==VERSION || reviewed.checksum!==digest(ddl.sql))throw new PostgresReadError('restriction_restoration_plan_changed');
    const done=(await session.query('SELECT checksum,details FROM company_management.schema_migrations WHERE version=$1',[VERSION])).rows[0];
    if(done) {
      if(done.checksum!==reviewed.checksum)throw new PostgresReadError('restriction_restoration_changed');
      return {status:'already_applied',details:done.details};
    }
    if(!reviewed.backup || reviewed.backupHash!==digest(reviewed.backup))throw new PostgresReadError('restriction_backup_required');
    await session.query("SET LOCAL lock_timeout='5s'");
    await session.query('LOCK TABLE '+[...new Set(ddl.locks)].sort().join(',')+' IN SHARE ROW EXCLUSIVE MODE');
    const current=await inspect(session);
    if(current.backupHash!==reviewed.backupHash)throw new PostgresReadError('restriction_backup_changed');
    await session.query(ddl.sql);
    const details={backupHash:reviewed.backupHash,restoredPolicies:current.backup!.policies.length,removed:removedRestrictionObjects,restoredTables:ddl.targets,completedAt:new Date().toISOString()};
    await session.query('INSERT INTO company_management.schema_migrations(version,checksum,details) VALUES($1,$2,$3::jsonb)',[VERSION,reviewed.checksum,JSON.stringify(details)]);
    return {status:'applied',details};
  });
}
