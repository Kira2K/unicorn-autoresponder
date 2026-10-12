/** Business relations move together; receipts and raw import evidence remain private. */
export const BUSINESS_TABLES = ['companies','company_identifiers','company_restrictions','vacancies','applications','client_company_events','sources'] as const;
export const BUSINESS_VIEWS = ['active_restrictions','client_company_summary','company_directory'] as const;
export const INTERNAL_TABLES = ['schema_migrations','legacy_records','directory_imports'] as const;
export const RELOCATION_VERSION = '003_noco_business';
export type BusinessSchema = 'company_management'|'noco';

export function companyRelation(schema:BusinessSchema,name:string):string {
  if ((BUSINESS_TABLES as readonly string[]).includes(name) || (BUSINESS_VIEWS as readonly string[]).includes(name)) return schema+'.'+name;
  if ((INTERNAL_TABLES as readonly string[]).includes(name)) return 'company_management.'+name;
  throw Error('unknown_company_relation');
}
