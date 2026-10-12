import type { DatabaseRead } from '../infrastructure/database.ts'
import type { Source } from '../types.ts'
import { assertAllowedUrl } from '../infrastructure/navigation-policy.ts'
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts'

/** Only explicit source→company IDs establish identity. Aggregators never become employers. */
export function loadDatabaseSources(read: DatabaseRead, options: { companyIds?: string[] } = {}) {
  return read(async session => {
    if (options.companyIds && (!options.companyIds.length || options.companyIds.some(id=>!/^\d+$/.test(id)))) throw new PostgresReadError('explicit_company_scope_required')
    const companies = (await session.query("SELECT id::text,name,application_route,source FROM noco.companies WHERE directory_status='active' AND merged_into_id IS NULL" + (options.companyIds ? ' AND id=ANY($1::bigint[])' : '') + ' ORDER BY id', options.companyIds ? [options.companyIds] : [])).rows
    if (options.companyIds?.some(id=>!companies.some(c=>c.id===id))) throw new PostgresReadError('unknown_or_inactive_company')
    const companyById = new Map(companies.map(company => [company.id, company]))
    const rows = (await session.query("SELECT id::text,company_id::text,name,type,url,disposition,provenance FROM noco.sources WHERE disposition<>'superseded'" + (options.companyIds ? ' AND company_id=ANY($1::bigint[])' : '') + ' ORDER BY id', options.companyIds ? [options.companyIds] : [])).rows
    const sources: Source[] = [], deferred: { id: string; companyId: string | null; reason: string }[] = []
    for (const row of rows) {
      const company = companyById.get(row.company_id)
      let reason = row.disposition === 'blocked_linkedin' || row.type === 'linkedin' ? 'linkedin_forbidden' : row.type !== 'website' ? 'adapter_required:' + row.type : !company ? 'company_mapping_required' : ''
      try { assertAllowedUrl(String(row.url)) } catch { reason = 'navigation_forbidden' }
      if (reason) { deferred.push({ id: String(row.id), companyId: row.company_id as string | null, reason }); continue }
      sources.push({ name: String(company!.name), url: String(row.url), provenance: JSON.stringify(row.provenance),
        database: { companyId: String(company!.id), sourceId: String(row.id), applicationRoute: company!.application_route as 'standard_workflow' | 'notify_only' } })
    }
    const issues = companies.filter(c => !sources.some(s => s.database!.companyId === c.id)).map(c => `company:${c.id}:no_supported_career_source`)
    return { sources, deferred, issues, companyIds: companies.map(c => String(c.id)), companies: companies.map(c=>({id:String(c.id),name:String(c.name)})) }
  })
}
