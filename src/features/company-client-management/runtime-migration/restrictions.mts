import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import type { LegacyRecord } from '../legacy-snapshot.mts';
import { createRequire } from 'node:module';

/** Preserve source text verbatim and native ownership; never infer a company identity. */
export async function migrateRestrictionText(session:SqlSession) {
  // Directory consolidation may rename a company. Preserve the actual legacy HH match name as an alias.
  await session.query(`UPDATE noco.company_restrictions r SET hh_names=ARRAY[l.payload->'values'->>'company_name']
    FROM noco.companies c JOIN company_management.legacy_records l ON l.id=c.legacy_record_id
    WHERE r.company_id=c.id AND r.legacy_record_id IS NOT NULL AND nullif(l.payload->'values'->>'company_name','') IS NOT NULL`);
  const rows=(await session.query("SELECT id::text,payload FROM company_management.legacy_records WHERE kind IN ('restriction','student_stop_list') ORDER BY id")).rows;
  let inserted=0;
  for(const row of rows) {
    const record=row.payload as LegacyRecord;
    if(record.clientKeys.length!==1)throw new PostgresReadError('restriction_student_review_required');
    const student=record.clientKeys[0];
    const stop=record.kind==='student_stop_list';
    const context=stop?{storedRestriction:record.values.stop_list_company}:{
      fromResume:record.values.from_legend_resume_companies,
      interviewing:record.values.currently_interviewing_companies,
      offers:record.values.offer_companies,sourceIssues:record.issues
    };
    // Already linked companies keep their existing rules. This extra policy retains unlinked text.
    if(!Object.values(context).some(v=>typeof v==='string'&&v.trim()))continue;
    const market=String(record.values.market??'').toLowerCase();
    const names=stop?String(record.values.stop_list_company??'').split(/[,;\n]/).map(v=>v.trim().replace(/^["'`]+|["'`]+$/g,'').trim()).filter(Boolean):[];
    const result=await session.query(`INSERT INTO noco.company_restrictions
      (client_id,scope,reason,instruction,context,market,channels,legacy_record_id,source,import_key,hh_names)
      VALUES($1,'contextual','legacy_context','Do not apply where these stored restrictions forbid it. Unresolved meaning or identity requires review.',$2::jsonb,$3,$4::text[],$5,$6::jsonb,$7,$8::text[])
      ON CONFLICT(import_key) DO NOTHING RETURNING id`,
      [student,JSON.stringify(context),['ru','en'].includes(market)?market:'all',stop?['all']:['external-responses'],row.id,
        JSON.stringify({legacyRecordId:row.id,tableId:record.tableId,key:record.key}),`legacy-context:${row.id}`,names]);
    inserted+=result.rows.length;
  }
  const {getBlockedCompaniesForClientMarket}=createRequire(import.meta.url)('../../../platform/db/noco/noco-db.ts');
  const names=getBlockedCompaniesForClientMarket({Id:-1},'Ru').map((c:{name:string})=>c.name);
  if(names.length) {
    const result=await session.query(`INSERT INTO noco.company_restrictions(is_global,scope,reason,instruction,context,hh_names,import_key,review_status,source)
      VALUES(true,'contextual','imported_global_stop_list','Do not apply to the companies named in this policy.',$1::jsonb,$2::text[],'runtime-global-stop-list','verified',$3::jsonb)
      ON CONFLICT(import_key) DO NOTHING RETURNING id`,[JSON.stringify({blockedCompanies:names}),names,JSON.stringify({origin:'existing HH global policy'})]);
    inserted+=result.rows.length;
  }
  return inserted;
}
