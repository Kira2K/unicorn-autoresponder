import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { createRequire } from 'node:module';
import { createWorkingCatalog } from '../../../integrations/postgres/working-catalog.mts';
import { workingReads } from '../../../integrations/postgres/working-reads.mts';
import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { captureLegacySnapshot,digest } from '../legacy-snapshot.mts';
import { readPolicies } from '../restrictions/read.mts';
import { hhPolicy } from '../restrictions/hh.mts';
const require=createRequire(import.meta.url);
const {getBlockedCompaniesForClientMarket}=require('../../../platform/db/noco/noco-db.ts');
const {compactCompanyName}=require('../../../../shared/company-stop-list.ts');

export async function currentLegacy(session:SqlSession) {
  const catalog=createWorkingCatalog((await session.query("SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
  const snapshot=await captureLegacySnapshot({...workingReads(session,catalog),listTables:()=>catalog.list().map(t=>catalog.get(t.id))});
  const archived=(await session.query('SELECT source_table_id,source_key,payload_sha256 FROM company_management.legacy_records')).rows;
  if(snapshot.records.length!==archived.length)throw new PostgresReadError('legacy_snapshot_changed');
  for(const r of snapshot.records)if(!archived.some(a=>a.source_table_id===r.tableId&&a.source_key===r.key&&a.payload_sha256===digest(r)))throw new PostgresReadError('legacy_snapshot_changed');
  return {catalog,snapshot};
}
/** Compare every old student/market decision; no raw candidate text in the result. */
export async function auditRestrictionCutover(session:SqlSession) {
  const {snapshot}=await currentLegacy(session);
  const rows=await readPolicies(session,'hh'),resolve=hhPolicy(rows);
  const clients=new Set(['-1',...snapshot.records.flatMap(r=>r.clientKeys)]);
  const oldCompanies=new Map(snapshot.records.filter(r=>r.kind==='company').map(r=>[r.key,r.values.company_name]));
  const restrictions=snapshot.records.filter(r=>r.kind==='restriction').map(r=>({Id:Number(r.key),clients_id:Number(r.clientKeys[0]),market:r.values.market,
    rel_restrictions_blocked_companies:r.companyKeys.map(id=>({Id:Number(id),company_name:oldCompanies.get(id)}))}));
  let compared=0,additions=0;
  for(const id of clients)for(const market of ['Ru','En']) {
    const client={Id:Number(id),stop_list_company:snapshot.records.find(r=>r.kind==='student_stop_list'&&r.clientKeys[0]===id)?.values.stop_list_company};
    const old=getBlockedCompaniesForClientMarket(client,market).map((c:{name:string})=>compactCompanyName(c.name));
    const decision=resolve(client,market),next=decision.companies.map(c=>compactCompanyName(c.name));
    if(decision.holdReason||old.some((name:string)=>!next.includes(name)))throw new PostgresReadError('hh_restriction_coverage_lost');
    additions+=next.filter(name=>!old.includes(name)).length;compared++;
  }
  const external=await readPolicies(session,'external-responses');
  for(const r of snapshot.records.filter(r=>['restriction','student_stop_list'].includes(r.kind))) {
    if(r.clientKeys.length!==1)throw new PostgresReadError('restriction_student_review_required');
    const values=r.kind==='student_stop_list'?[r.values.stop_list_company]:[r.values.from_legend_resume_companies,r.values.currently_interviewing_companies,r.values.offer_companies];
    for(const value of values.filter(v=>typeof v==='string'&&v.trim())) {
      if(!external.some(p=>p.client_id===r.clientKeys[0]&&Object.values(p.context).includes(value)))throw new PostgresReadError('restriction_text_coverage_lost');
    }
  }
  return {studentMarketComparisons:compared,removedBlocks:0,additionalAliases:additions,rawRecords:snapshot.records.length};
}
