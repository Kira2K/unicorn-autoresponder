import { createHash } from 'node:crypto';
import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { BUSINESS_TABLES,BUSINESS_VIEWS,companyRelation } from '../business-location.mts';
import type { BusinessSchema } from '../business-location.mts';
import { quoted } from '../../../integrations/postgres/working-catalog.mts';

/** Names/identities for the objects that SET SCHEMA moves, including indexes and owned sequences. */
export async function relocationObjects(session:SqlSession,schema:BusinessSchema,names:readonly string[]=[...BUSINESS_TABLES,...BUSINESS_VIEWS]) {
  return (await session.query(`WITH business AS (
    SELECT oid FROM pg_class WHERE relnamespace=to_regnamespace($1) AND relname=ANY($2::text[])
  ), moving AS (
    SELECT oid FROM business
    UNION SELECT indexrelid FROM pg_index WHERE indrelid IN (SELECT oid FROM business)
    UNION SELECT d.objid FROM pg_depend d JOIN pg_class c ON c.oid=d.objid
      WHERE d.refobjid IN (SELECT oid FROM business) AND d.classid='pg_class'::regclass
        AND d.refclassid='pg_class'::regclass AND c.relkind='S' AND d.deptype IN ('a','i')
  ) SELECT c.oid::text AS oid,c.relname AS name,c.relkind AS kind,c.relowner::text AS owner
    FROM pg_class c JOIN moving m ON m.oid=c.oid ORDER BY c.oid`,[schema,names])).rows;
}

/** Full-row fingerprints and structural OIDs; no contact/source payloads in normal reports. */
export async function captureRelocationState(session:SqlSession,schema:BusinessSchema,names?:readonly string[]) {
  const objects=await relocationObjects(session,schema,names);
  const records:Record<string,{count:number;sha256:string}>={};
  for(const name of names??[...BUSINESS_TABLES,'legacy_records','directory_imports']) {
    const table=names?schema+'.'+quoted(name):companyRelation(schema,name);
    const order=names?'row_to_json(t)::text':name==='directory_imports'?'checksum':'id';
    const rows=(await session.query(`SELECT row_to_json(t)::text AS record FROM ${table} t ORDER BY ${order}`)).rows;
    const hash=createHash('sha256');for(const row of rows)hash.update(String(row.record)+'\n');
    records[name]={count:rows.length,sha256:hash.digest('hex')};
  }
  const ids=objects.filter(o=>o.kind==='r'||o.kind==='v').map(o=>String(o.oid));
  const structure=(await session.query(`SELECT jsonb_build_object(
    'constraints',(SELECT jsonb_agg(to_jsonb(c)-'connamespace' ORDER BY c.oid) FROM pg_constraint c WHERE c.conrelid=ANY($1::oid[]) OR c.confrelid=ANY($1::oid[])),
    'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid=ANY($1::oid[]) AND a.attnum>0),
    'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid=ANY($1::oid[]))
  ) AS value`,[ids])).rows[0].value;
  const sequences:Record<string,unknown>={};
  for(const o of objects.filter(o=>o.kind==='S')) {
    // Names originate only from the owned sequences of the fixed business allowlist.
    const name='"'+String(o.name).replaceAll('"','""')+'"';
    sequences[String(o.oid)]=(await session.query(`SELECT last_value::text,is_called FROM ${schema}.${name}`)).rows[0];
  }
  return {objects,records,structure,sequences};
}
