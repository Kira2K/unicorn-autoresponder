import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { createPostgresClient } from '../../integrations/postgres/working-client.mts';
import { PostgresReadError } from '../../integrations/postgres/contracts.mts';
const { TABLES }=createRequire(import.meta.url)('../../integrations/noco/core/schema.ts');
export type LegacyKind='company'|'restriction'|'application'|'student_stop_list';
export type LegacyRecord={kind:LegacyKind;tableId:string;key:string;values:Record<string,unknown>;sourceJson?:string;clientKeys:string[];companyKeys:string[];issues:string[]};
export type LegacySnapshot={version:1;capturedAt:string;records:LegacyRecord[]};
export type LegacyReader=Pick<Awaited<ReturnType<typeof createPostgresClient>>,'listTables'|'listRecords'|'listRelated'>;
export const sourceTables:Record<LegacyKind,string>={company:TABLES.companies.id,restriction:TABLES.restrictions.id,application:TABLES.applications.id,student_stop_list:TABLES.clients.id};
const keyValid=(key:unknown):key is string=>typeof key==='string' && key.length<=19 && /^[1-9][0-9]*$/.test(key) && BigInt(key)<=9223372036854775807n;
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function inspectSnapshot(value:unknown) {
  const s=value as LegacySnapshot;
  if(!s || s.version!==1 || !Number.isFinite(Date.parse(s.capturedAt)) || !Array.isArray(s.records))throw new PostgresReadError('invalid_legacy_snapshot');
  const keys=new Set<string>();
  for(const r of s.records) {
    if(!r || !Object.hasOwn(sourceTables,r.kind) || r.tableId!==sourceTables[r.kind] || !keyValid(r.key) || !r.values || typeof r.values!=='object' || Array.isArray(r.values) ||
      !Array.isArray(r.clientKeys) || !r.clientKeys.every(keyValid) || !Array.isArray(r.companyKeys) || !r.companyKeys.every(keyValid) ||
      new Set(r.clientKeys).size!==r.clientKeys.length || new Set(r.companyKeys).size!==r.companyKeys.length ||
      !Array.isArray(r.issues) || !r.issues.every(i=>typeof i==='string') || (r.sourceJson!==undefined && typeof r.sourceJson!=='string'))throw new PostgresReadError('invalid_legacy_record');
    const key=r.tableId+':'+r.key;
    if(keys.has(key))throw new PostgresReadError('duplicate_legacy_source');
    keys.add(key);
  }
  return {checksum:digest(s),records:s.records.length,byKind:Object.fromEntries(Object.keys(sourceTables).map(k=>[k,s.records.filter(r=>r.kind===k).length]))};
}

/** Current SQL records and native links only. No fuzzy matching or legacy status interpretation. */
export async function captureLegacySnapshot(reader:LegacyReader,at=new Date().toISOString()):Promise<LegacySnapshot> {
  const tables=reader.listTables(),records:LegacyRecord[]=[];
  async function all(tableId:string,fieldId?:string,parentKey?:string[]) {
    let after:string[]|undefined; const result=[];
    do {
      const page=fieldId ? await reader.listRelated(tableId,fieldId,parentKey!,{limit:100,after}) : await reader.listRecords(tableId,{limit:100,after});
      result.push(...page.records); after=page.nextKey??undefined;
      if(result.length>100_000)throw new PostgresReadError('legacy_snapshot_limit');
    }while(after);
    return result;
  }
  for(const kind of Object.keys(sourceTables) as LegacyKind[]) {
    const tableId=sourceTables[kind],table=tables.find(t=>t.id===tableId);
    if(!table)throw new PostgresReadError('legacy_table_missing');
    for(const row of await all(tableId)) {
      if(row.key.length!==1)throw new PostgresReadError('unsupported_legacy_key');
      if(kind==='student_stop_list' && !String(row.data.stop_list_company??'').trim())continue;
      const record:LegacyRecord={kind,tableId,key:row.key[0],values:kind==='student_stop_list'?{stop_list_company:row.data.stop_list_company}:row.data,
        ...(kind==='student_stop_list'?{}:{sourceJson:row.sourceJson}),clientKeys:[],companyKeys:[],issues:[]};
      async function related(title:string,target:string) {
        const fields=table!.columns.filter(c=>c.title===title);
        if(fields.length!==1 || fields[0].colOptions?.fk_related_model_id!==target) {record.issues.push('missing_relation:'+title);return [];}
        const linked=await all(tableId,fields[0].id,row.key);
        if(linked.some(r=>r.key.length!==1))throw new PostgresReadError('unsupported_legacy_key');
        return linked.map(r=>r.key[0]);
      }
      if(kind==='restriction') {
        record.clientKeys=await related('rel_restrictions_client',TABLES.clients.id);
        record.companyKeys=await related('rel_restrictions_blocked_companies',TABLES.companies.id);
      } else if(kind==='application') {
        record.clientKeys=await related('rel_applications_client',TABLES.clients.id);
        record.companyKeys=await related('rel_applications_company',TABLES.companies.id);
      } else if(kind==='student_stop_list')record.clientKeys=[row.key[0]];
      records.push(record);
    }
  }
  const snapshot:LegacySnapshot={version:1,capturedAt:at,records};inspectSnapshot(snapshot);return snapshot;
}
