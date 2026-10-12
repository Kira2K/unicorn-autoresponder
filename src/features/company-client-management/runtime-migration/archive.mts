import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { createRequire } from 'node:module';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import { quoted,tableSql } from '../../../integrations/postgres/working-catalog.mts';
import { relation } from '../../../integrations/postgres/working-relations.mts';
import type { SqlPool,SqlSession,CopyDatabase } from '../../../integrations/postgres/contracts.mts';
import { currentLegacy,auditRestrictionCutover } from './audit.mts';
import { digest } from '../legacy-snapshot.mts';
import { EXISTING_RESTRICTIONS_VERSION } from '../restrictions/existing.mts';
const {TABLES}=createRequire(import.meta.url)('../../../integrations/noco/core/schema.ts');
async function inspect(session:SqlSession) {
  if((await session.query('SELECT 1 FROM company_management.schema_migrations WHERE version=$1',[EXISTING_RESTRICTIONS_VERSION])).rows.length)
    return {status:'restrictions_restored',checksum:'',targets:[] as string[],clientTable:'',stopColumn:''};
  const receipt=(await session.query("SELECT details FROM company_management.schema_migrations WHERE version='004_runtime'")).rows[0]?.details as Record<string,unknown>|undefined;
  if(!receipt)throw new PostgresReadError('runtime_migration_required');
  const {catalog}=await currentLegacy(session);
  const tables=new Map<string,string>();
  for(const id of [TABLES.companies.id,TABLES.restrictions.id,TABLES.applications.id]) {
    const table=catalog.get(id);tables.set(id,tableSql(table));
    for(const column of table.columns.filter(c=>c.colOptions?.type==='mm')) {
      const target=relation(catalog,table.id,column.id).junction;
      if(target)tables.set(target.table.id,tableSql(target.table));
    }
  }
  const clients=catalog.get(TABLES.clients.id),stop=clients.columns.find(c=>c.dataKey==='stop_list_company');
  if(!stop)throw new PostgresReadError('legacy_stop_list_column_required');
  const targets=[...tables.values()].sort(),clientTable=tableSql(clients),stopColumn=quoted(stop.sqlName);
  return {status:receipt.archive?'already_applied':'pending',checksum:digest({targets,clientTable,stopColumn}),targets,clientTable,stopColumn};
}
export const planArchive=(pool:SqlPool,database:CopyDatabase)=>createReadSession(pool,database)(inspect);
/** Archive in place: preserve IDs, foreign keys, historical readers and all records. */
export async function archiveLegacy(pool:SqlPool,database:CopyDatabase,checksum:string) {
  return writeTransaction(pool,database,async session=>{
    await session.query('SELECT pg_advisory_xact_lock(1789941001,1)');
    const plan=await inspect(session);
    if(plan.status==='restrictions_restored')throw new PostgresReadError('restrictions_already_restored');
    if(plan.checksum!==checksum)throw new PostgresReadError('archive_plan_changed');
    if(plan.status==='already_applied')return plan;
    await session.query("SET LOCAL lock_timeout='5s'");
    await session.query('LOCK TABLE '+[...plan.targets,plan.clientTable].join(',')+' IN SHARE ROW EXCLUSIVE MODE');
    const coverage=await auditRestrictionCutover(session);
    await session.query(`CREATE FUNCTION company_management.reject_archived_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Archived company data is read-only. Edit canonical noco companies, sources, company_restrictions or applications.' USING ERRCODE='23514'; END; $$`);
    for(const table of plan.targets) {
      await session.query(`CREATE TRIGGER archived_company_data BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION company_management.reject_archived_write()`);
      await session.query(`COMMENT ON TABLE ${table} IS 'ARCHIVED: immutable legacy company/client evidence; canonical business tables are noco.companies, noco.company_restrictions, noco.applications.'`);
    }
    await session.query(`CREATE FUNCTION company_management.reject_legacy_stop_edit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF TG_OP='INSERT' THEN
        IF nullif(btrim(NEW.${plan.stopColumn}),'') IS NOT NULL THEN
          RAISE EXCEPTION 'Legacy stop-list is archived. Edit noco.company_restrictions.' USING ERRCODE='23514'; END IF;
      ELSIF NEW.${plan.stopColumn} IS DISTINCT FROM OLD.${plan.stopColumn} THEN
        RAISE EXCEPTION 'Legacy stop-list is archived. Edit noco.company_restrictions.' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$`);
    await session.query(`CREATE TRIGGER archived_stop_list BEFORE INSERT OR UPDATE OF ${plan.stopColumn} ON ${plan.clientTable} FOR EACH ROW EXECUTE FUNCTION company_management.reject_legacy_stop_edit()`);
    await session.query(`COMMENT ON COLUMN ${plan.clientTable}.${plan.stopColumn} IS 'ARCHIVED read-only stop-list. Canonical policies live in noco.company_restrictions.'`);
    const result={checksum,targets:plan.targets,coverage,archivedAt:new Date().toISOString()};
    await session.query("UPDATE company_management.schema_migrations SET details=details||jsonb_build_object('archive',$1::jsonb) WHERE version='004_runtime'",[JSON.stringify(result)]);
    return {status:'applied',...result};
  });
}
