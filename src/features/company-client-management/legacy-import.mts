import { PostgresReadError } from '../../integrations/postgres/contracts.mts';
import type { CopyDatabase,SqlPool,SqlSession } from '../../integrations/postgres/contracts.mts';
import { writeTransaction } from '../../integrations/postgres/working-session.mts';
import { inspectCompanySchema } from './schema.mts';
import { digest,inspectSnapshot } from './legacy-snapshot.mts';
import type { LegacySnapshot,LegacyRecord } from './legacy-snapshot.mts';
import { EXISTING_RESTRICTIONS_VERSION } from './restrictions/existing.mts';

const text=(value:unknown)=>typeof value==='string'?value.trim():'';
async function archive(session:SqlSession,record:LegacyRecord) {
  const hash=digest(record);
  const inserted=(await session.query(`INSERT INTO company_management.legacy_records(source_table_id,source_key,kind,payload,payload_sha256)
    VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(source_table_id,source_key) DO NOTHING RETURNING id::text`,
    [record.tableId,record.key,record.kind,JSON.stringify(record),hash])).rows[0];
  if(inserted)return {id:String(inserted.id),fresh:true};
  const existing=(await session.query('SELECT id::text,payload_sha256 FROM company_management.legacy_records WHERE source_table_id=$1 AND source_key=$2',[record.tableId,record.key])).rows[0];
  if(!existing || existing.payload_sha256!==hash)throw new PostgresReadError('legacy_source_changed');
  return {id:String(existing.id),fresh:false};
}

/** Copies reviewed source IDs and their native relations; never rewrites the legacy tables. */
export async function importLegacySnapshot(pool:SqlPool,database:CopyDatabase,snapshot:LegacySnapshot,expectedChecksum:string) {
  snapshot=structuredClone(snapshot);
  const plan=inspectSnapshot(snapshot);
  if(!expectedChecksum || expectedChecksum!==plan.checksum)throw new PostgresReadError('legacy_plan_changed');
  return writeTransaction(pool,database,async session=>{
    await session.query('SELECT pg_advisory_xact_lock(1789941001,1)');
    const schema=await inspectCompanySchema(session);
    if(schema.status!=='applied')throw new PostgresReadError('company_schema_required');
    if((await session.query('SELECT 1 FROM company_management.schema_migrations WHERE version=$1',[EXISTING_RESTRICTIONS_VERSION])).rows.length)
      throw new PostgresReadError('legacy_import_closed_after_restoration');
    const counts={importedSources:0,existingSources:0,companies:0,restrictions:0,applications:0,events:0};
    const companies=new Map<string,string>();
    // Source IDs establish identity; identical names deliberately remain separate companies.
    const records=[...snapshot.records.filter(r=>r.kind==='company'),...snapshot.records.filter(r=>r.kind!=='company')];
    for(const record of records) {
      const archived=await archive(session,record);
      const issues=[...record.issues];
      const source={legacyRecordId:archived.id,tableId:record.tableId,key:record.key,importedAt:snapshot.capturedAt};
      if(!archived.fresh) {
        counts.existingSources++;
        if(record.kind==='company') {
          const existing=(await session.query(`SELECT id::text FROM ${schema.businessSchema}.companies WHERE legacy_record_id=$1`,[archived.id])).rows[0];
          if(existing)companies.set(record.key,String(existing.id));
        }
        continue; // Never overwrite operator corrections, revocations or later recruitment events.
      }
      counts.importedSources++;
      if(record.kind==='company') {
        const name=text(record.values.company_name);
        if(!name)issues.push('missing_company_name');
        else {
          const created=(await session.query(`INSERT INTO ${schema.businessSchema}.companies(name,legacy_record_id,source) VALUES($1,$2,$3::jsonb) RETURNING id::text`,[name,archived.id,JSON.stringify(source)])).rows[0];
          companies.set(record.key,String(created.id));counts.companies++;
        }
      } else {
        const clientKey=record.clientKeys.length===1?record.clientKeys[0]:undefined;
        const clientExists=clientKey && (await session.query(`SELECT 1 AS found FROM ${schema.clientTable} WHERE ${schema.clientKey}=$1::bigint`,[clientKey])).rows.length===1;
        if(!clientExists)issues.push('missing_or_ambiguous_client');
        const companyIds=record.companyKeys.map(key=>companies.get(key));
        if(record.kind!=='student_stop_list' && (!companyIds.length || companyIds.some(id=>!id)))issues.push('unresolved_company_link');
        if(record.kind==='restriction') {
          const rawMarket=text(record.values.market).toLowerCase();
          const market=rawMarket==='ru'||rawMarket==='en'?rawMarket:'all';
          if(!['','all','both','ru','en'].includes(rawMarket))issues.push('unresolved_market_scope');
          // Reasons in old multi-company text fields cannot be attributed to linked IDs without name matching.
          issues.push('legacy_reason_requires_review');
          if(clientExists)for(const companyId of companyIds.filter((id):id is string=>!!id)) {
            await session.query(`INSERT INTO ${schema.businessSchema}.company_restrictions(client_id,company_id,reason,market,legacy_record_id,source)
              VALUES($1,$2,'legacy_stop_list',$3,$4,$5::jsonb)`,[clientKey,companyId,market,archived.id,JSON.stringify(source)]);
            counts.restrictions++;
          }
        } else if(record.kind==='application') {
          if(companyIds.length!==1)issues.push('ambiguous_application_company');
          if(clientExists && companyIds.length===1 && companyIds[0]) {
            const app=(await session.query(`INSERT INTO ${schema.businessSchema}.applications(client_id,company_id,channel,submission_status,legacy_record_id,source)
              VALUES($1,$2,'legacy','unknown',$3,$4::jsonb) RETURNING id::text`,[clientKey,companyIds[0],archived.id,JSON.stringify(source)])).rows[0];
            counts.applications++;
            await session.query(`INSERT INTO ${schema.businessSchema}.client_company_events(client_id,company_id,application_id,event_type,assertion_status,source,evidence,legacy_record_id)
              VALUES($1,$2,$3,'legacy_status','legacy_unverified',$4::jsonb,$5::jsonb,$6)`,
              [clientKey,companyIds[0],app.id,JSON.stringify(source),JSON.stringify({status_raw:record.values.status_raw??null}),archived.id]);
            counts.events++;
          }
          issues.push('legacy_application_status_unverified');
        } else issues.push('unresolved_student_stop_list');
      }
      await session.query('UPDATE company_management.legacy_records SET review_status=$2,issues=$3::jsonb WHERE id=$1',
        [archived.id,issues.length?'needs_review':'imported',JSON.stringify([...new Set(issues)])]);
    }
    const review=(await session.query("SELECT source_table_id,source_key,kind,issues FROM company_management.legacy_records WHERE review_status='needs_review' ORDER BY id")).rows;
    return {...counts,checksum:plan.checksum,needsReview:review.length,review};
  });
}
