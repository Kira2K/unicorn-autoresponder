import type { SqlSession } from '../../integrations/postgres/contracts.mts';

export type MigrationPermissions={allowed:boolean;missingPrivileges:string[]};

/** Read-only preflight for a new schema and its foreign key to the existing student table. */
export async function inspectMigrationPermissions(session:SqlSession,clientTable:string,clientKey:string):Promise<MigrationPermissions> {
  const row=(await session.query(`SELECT has_database_privilege(current_database(),'CREATE') AS create_schema,
    has_schema_privilege(c.relnamespace,'USAGE') AS use_client_schema,
    has_column_privilege(c.oid,$2::text,'REFERENCES') AS reference_client_key
    FROM pg_catalog.pg_class c WHERE c.oid=to_regclass($1)`,[clientTable,clientKey])).rows[0];
  const requirements=[
    ['create_schema','CREATE on database'],
    ['use_client_schema','USAGE on student schema'],
    ['reference_client_key','REFERENCES on student primary key']
  ] as const;
  const missingPrivileges=requirements.filter(([key])=>row?.[key]!==true).map(([,label])=>label);
  return {allowed:missingPrivileges.length===0,missingPrivileges};
}
