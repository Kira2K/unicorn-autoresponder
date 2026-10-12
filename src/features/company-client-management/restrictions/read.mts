import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { readExistingPolicies,EXISTING_RESTRICTIONS_VERSION } from './existing.mts';
export type PolicyRow={id:string;client_id:string|null;is_global:boolean;scope:'company'|'contextual';company_id:string|null;company:string|null;website:string|null;reason:string;action:string;instruction:string;context:Record<string,unknown>;hh_names:string[];include_subsidiaries:boolean;market:string;channels:string[];source?:string};
/** Explicit cutover receipt selects original storage; failures never silently disable restrictions. */
export async function readPolicies(session:SqlSession,channel:'hh'|'external-responses',studentId?:string,market?:'en'|'ru'):Promise<PolicyRow[]> {
  const ledger=(await session.query("SELECT to_regclass('company_management.schema_migrations') AS ledger")).rows[0]?.ledger;
  if(ledger && (await session.query('SELECT 1 FROM company_management.schema_migrations WHERE version=$1',[EXISTING_RESTRICTIONS_VERSION])).rows.length)return readExistingPolicies(session,channel,studentId,market);
  return readReplacementPolicies(session,channel,studentId,market);
}
/** Historical storage only: needed for pre-cutover operation and migration equivalence checks. */
export async function readReplacementPolicies(session:SqlSession,channel:'hh'|'external-responses',studentId?:string,market?:'en'|'ru'):Promise<PolicyRow[]> {
  const rows=(await session.query(`SELECT r.id::text,r.client_id::text,r.is_global,r.scope,r.company_id::text,c.name AS company,c.website,
    r.reason,r.action,r.instruction,r.context,r.hh_names,r.include_subsidiaries,r.market,r.channels
    FROM noco.active_restrictions r LEFT JOIN noco.companies c ON c.id=r.company_id
    WHERE ('all'=ANY(r.channels) OR $1=ANY(r.channels))
      AND ($1<>'hh' OR r.scope='company' OR cardinality(r.hh_names)>0)
      AND ($2::bigint IS NULL OR r.is_global OR r.client_id=$2::bigint)
      AND ($3::text IS NULL OR r.market IN ('all',$3)) ORDER BY r.id`,[channel,studentId??null,market??null])).rows;
  return rows as PolicyRow[];
}
