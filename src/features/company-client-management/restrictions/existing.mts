import { createRequire } from 'node:module';
import { createWorkingCatalog } from '../../../integrations/postgres/working-catalog.mts';
import { workingReads } from '../../../integrations/postgres/working-reads.mts';
import { relation } from '../../../integrations/postgres/working-relations.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { SqlSession, RecordPage } from '../../../integrations/postgres/contracts.mts';
import type { PolicyRow } from './read.mts';
const require=createRequire(import.meta.url);
const {TABLES}=require('../../../integrations/noco/core/schema.ts');
const {getBlockedCompaniesForClientMarket}=require('../../../platform/db/noco/noco-db.ts');
const contextInstruction='Do not apply where these stored restrictions forbid it. Unresolved meaning or identity requires review.';
export const EXISTING_RESTRICTIONS_VERSION='005_existing_restrictions';
const names=(text:unknown)=>String(text??'').split(/[,;\n]/).map(v=>v.trim().replace(/^["'`]+|["'`]+$/g,'').trim()).filter(Boolean);

/** Read original editable relations/fields; normalized policies are in memory, never another SQL table. */
export async function readExistingPolicies(session:SqlSession,channel:'hh'|'external-responses',studentId?:string,market?:'en'|'ru'):Promise<PolicyRow[]> {
  const catalog=createWorkingCatalog((await session.query("SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
  const reader=workingReads(session,catalog), table=catalog.get(TABLES.restrictions.id), clients=catalog.get(TABLES.clients.id);
  const clientLink=table.columns.find(c=>c.title==='rel_restrictions_client'), companyLink=table.columns.find(c=>c.title==='rel_restrictions_blocked_companies');
  if(!clientLink || !companyLink || !clients.columns.some(c=>c.dataKey==='stop_list_company'))throw new PostgresReadError('existing_restriction_schema_required');
  const clientRelation=relation(catalog,table.id,clientLink.id);
  async function all(read:(after?:string[])=>Promise<RecordPage>) {
    const result:RecordPage['records']=[];let after:string[]|undefined;
    do {const page=await read(after);result.push(...page.records);after=page.nextKey??undefined;if(result.length>100_000)throw new PostgresReadError('restriction_source_limit');}while(after);
    return result;
  }
  const restrictions=await all(after=>studentId?reader.findRecords(table.id,clientRelation.child.column.dataKey,[studentId],{limit:100,after}):reader.listRecords(table.id,{limit:100,after}));
  const student=studentId?await reader.getRecord(clients.id,[studentId]):undefined;
  if(studentId&&!student)throw new PostgresReadError('restriction_student_missing');
  const students=studentId?[student!]:await all(after=>reader.listRecords(clients.id,{limit:100,after}));
  // Preserve explicit canonical employer bindings and aliases; never guess identity from a name.
  const mappings=(await session.query(`SELECT c.id::text,c.name,c.website,l.source_key FROM noco.companies c
    JOIN company_management.legacy_records l ON l.id=c.legacy_record_id WHERE l.kind='company'`)).rows;
  const companies=new Map(mappings.map(row=>[String(row.source_key),row]));
  const result:PolicyRow[]=[];
  function row(id:string,client_id:string|null,scope:'company'|'contextual',extra:Partial<PolicyRow>):PolicyRow {
    return {id,client_id,is_global:client_id===null,scope,company_id:null,company:null,website:null,reason:'legacy_context',action:'block_application',instruction:contextInstruction,context:{},hh_names:[],include_subsidiaries:false,market:'all',channels:['all'],...extra};
  }
  for(const record of restrictions) {
    const linked=await all(after=>reader.listRelated(table.id,clientLink.id,record.key,{limit:100,after}));
    if(linked.length!==1)throw new PostgresReadError('restriction_student_review_required');
    const clientId=linked[0].key[0],rawMarket=String(record.data.market??'').trim().toLowerCase(), ruleMarket=['ru','en'].includes(rawMarket)?rawMarket:'all';
    if(market && !['all',market].includes(ruleMarket))continue;
    const blocked=await all(after=>reader.listRelated(table.id,companyLink.id,record.key,{limit:100,after}));
    for(const company of blocked) {
      const mapping=companies.get(company.key[0]),name=String(company.data.company_name??'').trim();
      if(!name)throw new PostgresReadError('restriction_company_name_required');
      result.push(row(`existing:${record.key[0]}:${company.key[0]}`,clientId,'company',{company_id:mapping?String(mapping.id):null,company:mapping?String(mapping.name):name,website:mapping?.website as string|null??null,
        reason:'legacy_stop_list',instruction:'',hh_names:[name],market:ruleMarket,source:table.sqlTable}));
    }
    const context=JSON.parse(JSON.stringify({fromResume:record.data.from_legend_resume_companies,interviewing:record.data.currently_interviewing_companies,offers:record.data.offer_companies,sourceIssues:[]}));
    // Import-only review annotations are not business rules; current source fields remain authoritative.
    if(channel==='external-responses' && Object.values(context).some(v=>typeof v==='string'&&v.trim()))result.push(row(`existing-context:${record.key[0]}`,clientId,'contextual',{context,market:ruleMarket,channels:['external-responses'],source:table.sqlTable}));
  }
  for(const client of students) {
    const value=client.data.stop_list_company;
    if(typeof value==='string'&&value.trim())result.push(row(`student-stop:${client.key[0]}`,client.key[0],'contextual',{context:{storedRestriction:value},hh_names:names(value),source:clients.sqlTable+'.stop_list_company'}));
  }
  const globals=getBlockedCompaniesForClientMarket({Id:-1},'Ru').map((c:{name:string})=>c.name);
  if(globals.length)result.push(row('existing-global',null,'contextual',{reason:'imported_global_stop_list',instruction:'Do not apply to the companies named in this policy.',context:{blockedCompanies:globals},hh_names:globals,source:'existing HH global stop-list'}));
  return result;
}
