import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { CopyDatabase,SqlPool,SqlSession } from '../../../integrations/postgres/contracts.mts';
import { inspectCompanySchema } from '../schema.mts';
import { digest } from '../legacy-snapshot.mts';
import { inspectDirectorySnapshot } from './snapshot.mts';
import type { DirectorySnapshot } from './types.mts';
import { companyRelation } from '../business-location.mts';
import type { BusinessSchema } from '../business-location.mts';
import { EXISTING_RESTRICTIONS_VERSION } from '../restrictions/existing.mts';

const version='002_directory';
const historyTables=['company_identifiers','company_restrictions','vacancies','applications','client_company_events','legacy_records'];
const tables=['companies',...historyTables,'schema_migrations'];
type State=Record<string,string[]>;
type Summary={activeCompanies:number;legacyReferences:number;sources:number;notifyOnly:number;reusedIds:number;insertedCompanies:number;preserved:Record<string,number>};
type Plan={database:CopyDatabase;status:'pending'|'already_applied';checksum:string;inputChecksum:string;sqlChecksum:string;deployment:{allowed:boolean;missingPrivileges:string[]};counts:{existingCompanies:number;sourceCompanies:number;sources:number;reusedIds:number};summary?:Summary};
async function capture(session:SqlSession,schema:BusinessSchema,names=tables):Promise<State>{
  const state:State={};
  // JSON text preserves bigint values and original timestamps without JS number/date coercion.
  for(const name of names) state[name]=(await session.query('SELECT row_to_json(t)::text AS record FROM '+companyRelation(schema,name)+' t ORDER BY '+(name==='schema_migrations'?'version':'id'))).rows.map(r=>String(r.record));
  return state;
}
async function inspect(session:SqlSession,database:CopyDatabase,snapshot:DirectorySnapshot){
  const input=inspectDirectorySnapshot(snapshot),core=await inspectCompanySchema(session);
  if(core.status!=='applied')throw new PostgresReadError('company_schema_required');
  const sql=(await readFile(new URL('../migrations/002_directory.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  const sqlChecksum=createHash('sha256').update(sql).digest('hex');
  const migration=(await session.query('SELECT checksum FROM company_management.schema_migrations WHERE version=$1',[version])).rows[0];
  if(migration&&migration.checksum!==sqlChecksum)throw new PostgresReadError('company_schema_version_mismatch');
  if(migration){
    const receipt=(await session.query('SELECT plan_checksum,summary FROM company_management.directory_imports WHERE checksum=$1',[input.checksum])).rows[0];
    if(receipt) return {plan:{database,status:'already_applied',checksum:String(receipt.plan_checksum),inputChecksum:input.checksum,sqlChecksum,deployment:{allowed:true,missingPrivileges:[]},counts:{existingCompanies:0,sourceCompanies:input.companies,sources:input.sources,reusedIds:input.existingMappings},summary:receipt.summary as Summary} satisfies Plan,sql,before:{} as State,migrated:true};
    const active=(await session.query(`SELECT count(*)::int AS n FROM ${core.businessSchema}.company_directory`)).rows[0];
    if(Number(active.n)!==0)throw new PostgresReadError('directory_already_initialized');
  }
  if((await session.query('SELECT 1 FROM company_management.schema_migrations WHERE version=$1',[EXISTING_RESTRICTIONS_VERSION])).rows.length)
    throw new PostgresReadError('directory_import_closed_after_restoration');
  const permission=(await session.query(`SELECT has_schema_privilege('company_management','CREATE') AS schema_create,
    pg_has_role(c.relowner,'USAGE') AS owns_companies,
    has_table_privilege('company_management.schema_migrations','INSERT') AS ledger_insert
    FROM pg_class c WHERE c.oid='${core.businessSchema}.companies'::regclass`)).rows[0];
  const missingPrivileges=[['schema_create','CREATE on company_management'],['owns_companies','ownership of companies'],['ledger_insert','INSERT on migration ledger']].filter(([key])=>permission?.[key]!==true).map(([,label])=>label);
  const before=await capture(session,core.businessSchema),existing=before.companies.map(v=>JSON.parse(v) as {id:string|number;name:string;import_key?:string});
  for(const c of snapshot.companies.filter(c=>c.existingId)){
    const target=existing.find(v=>String(v.id)===c.existingId);
    if(!target||target.name!==c.expectedExistingName||target.import_key)throw new PostgresReadError('directory_mapping_changed');
  }
  const checksum=digest({input:input.checksum,sql:sqlChecksum,before});
  return {plan:{database,status:'pending',checksum,inputChecksum:input.checksum,sqlChecksum,deployment:{allowed:!missingPrivileges.length,missingPrivileges},counts:{existingCompanies:existing.length,sourceCompanies:input.companies,sources:input.sources,reusedIds:input.existingMappings}} satisfies Plan,sql,before,migrated:!!migration};
}

/** Explicit, read-only preflight. Existing ID mappings come from the reviewed input, never a matcher. */
export async function planDirectory(pool:SqlPool,database:CopyDatabase,snapshot:DirectorySnapshot):Promise<Plan>{
  inspectDirectorySnapshot(snapshot);
  return createReadSession(pool,database)(async session=>(await inspect(session,database,snapshot)).plan);
}

const columns='existing_id bigint,import_key text,name text,website text,comment text,markets text[],tags text[],languages text[],aliases text[],contacts jsonb,application_route text,provenance jsonb';
/** One transaction for additive DDL, authoritative source import, history verification and receipt. */
export async function applyDirectory(pool:SqlPool,database:CopyDatabase,value:DirectorySnapshot,expectedChecksum:string){
  const snapshot=structuredClone(value);inspectDirectorySnapshot(snapshot);
  if(!/^[a-f0-9]{64}$/.test(expectedChecksum))throw new PostgresReadError('reviewed_checksum_required');
  return writeTransaction(pool,database,async session=>{
    await session.query('SELECT pg_advisory_xact_lock(1789941001,1)');
    await session.query("SET LOCAL lock_timeout='5s'");
    const schema=(await inspectCompanySchema(session)).businessSchema;
    const initial=(await inspect(session,database,snapshot)).plan;
    if(initial.checksum!==expectedChecksum)throw new PostgresReadError('directory_plan_changed');
    if(initial.status==='already_applied')return {status:'already_applied' as const,checksum:initial.inputChecksum,summary:initial.summary!};
    await session.query('LOCK TABLE '+tables.map(t=>companyRelation(schema,t)).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
    const {plan,sql,before,migrated}=await inspect(session,database,snapshot);
    if(plan.checksum!==expectedChecksum)throw new PostgresReadError('directory_plan_changed');
    if(plan.status==='already_applied')return {status:'already_applied' as const,checksum:plan.inputChecksum,summary:plan.summary!};
    if(!plan.deployment.allowed)throw new PostgresReadError('directory_permission_denied');
    if(!migrated){
      await session.query(sql);
      await session.query('INSERT INTO company_management.schema_migrations(version,checksum) VALUES($1,$2)',[version,plan.sqlChecksum]);
    }
    const payload=snapshot.companies.map(c=>({existing_id:c.existingId??null,import_key:snapshot.source.fileId+':'+c.key,name:c.name,
      website:snapshot.sources.find(s=>s.companyKey===c.key&&s.type==='website'&&s.disposition==='enabled')?.url??null,
      comment:c.comment,markets:c.markets,tags:c.tags,languages:c.languages,aliases:c.aliases,contacts:c.contacts,application_route:c.applicationRoute,
      provenance:{...c.provenance,fileId:snapshot.source.fileId,sourceKey:c.key,capturedAt:snapshot.source.capturedAt,workbookSha256:snapshot.source.workbookSha256,importChecksum:plan.inputChecksum}}));
    const serialized=JSON.stringify(payload);
    await session.query(`UPDATE ${schema}.companies c SET name=p.name,website=p.website,directory_status='active',import_key=p.import_key,
      comment=p.comment,markets=p.markets,tags=p.tags,languages=p.languages,aliases=p.aliases,contacts=p.contacts,application_route=p.application_route,
      source=c.source||jsonb_build_object('directory',p.provenance)
      FROM jsonb_to_recordset($1::jsonb) AS p(${columns}) WHERE c.id=p.existing_id`,[serialized]);
    await session.query(`INSERT INTO ${schema}.companies(name,website,directory_status,import_key,comment,markets,tags,languages,aliases,contacts,application_route,source)
      SELECT name,website,'active',import_key,comment,markets,tags,languages,aliases,contacts,application_route,jsonb_build_object('directory',provenance)
      FROM jsonb_to_recordset($1::jsonb) AS p(${columns}) WHERE existing_id IS NULL`,[serialized]);
    const imported=(await session.query(`SELECT id::text,import_key FROM ${schema}.company_directory ORDER BY id`)).rows;
    const idByKey=new Map(imported.map(c=>[String(c.import_key),String(c.id)]));
    const sourceRows=snapshot.sources.map(s=>({import_key:snapshot.source.fileId+':'+s.key,company_id:s.companyKey?idByKey.get(snapshot.source.fileId+':'+s.companyKey):null,
      name:s.name,type:s.type,url:s.url,disposition:s.disposition,comment:s.comment,provenance:{...s.provenance,fileId:snapshot.source.fileId,sourceKey:s.key,importChecksum:plan.inputChecksum}}));
    if(sourceRows.some((s,i)=>snapshot.sources[i].companyKey!==null&&!s.company_id))throw new PostgresReadError('directory_company_link_missing');
    await session.query(`INSERT INTO ${schema}.sources(import_key,company_id,name,type,url,disposition,comment,provenance)
      SELECT import_key,company_id,name,type,url,disposition,comment,provenance FROM jsonb_to_recordset($1::jsonb)
      AS p(import_key text,company_id bigint,name text,type text,url text,disposition text,comment text,provenance jsonb)`,[JSON.stringify(sourceRows)]);
    const preserved=await capture(session,schema,historyTables);
    if(historyTables.some(t=>digest(before[t])!==digest(preserved[t])))throw new PostgresReadError('directory_history_changed');
    const counts=(await session.query(`SELECT (SELECT count(*)::int FROM ${schema}.company_directory) AS active,
      (SELECT count(*)::int FROM ${schema}.companies WHERE directory_status='legacy_reference') AS legacy,
      (SELECT count(*)::int FROM ${schema}.sources) AS sources,
      (SELECT count(*)::int FROM ${schema}.company_directory WHERE application_route='notify_only') AS notify`)).rows[0];
    if(counts.active!==snapshot.companies.length||counts.sources!==snapshot.sources.length||counts.notify!==snapshot.companies.filter(c=>c.applicationRoute==='notify_only').length)throw new PostgresReadError('directory_totals_mismatch');
    const summary:Summary={activeCompanies:Number(counts.active),legacyReferences:Number(counts.legacy),sources:Number(counts.sources),notifyOnly:Number(counts.notify),reusedIds:plan.counts.reusedIds,insertedCompanies:snapshot.companies.length-plan.counts.reusedIds,preserved:Object.fromEntries(historyTables.map(t=>[t,before[t].length]))};
    await session.query('INSERT INTO company_management.directory_imports(checksum,plan_checksum,source_file_id,snapshot,before_state,summary) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)',[plan.inputChecksum,expectedChecksum,snapshot.source.fileId,JSON.stringify(snapshot),JSON.stringify(before),JSON.stringify(summary)]);
    return {status:'applied' as const,checksum:plan.inputChecksum,summary};
  });
}
