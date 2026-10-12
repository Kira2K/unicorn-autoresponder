import type { VacancyCollection } from '../vacancy_collection/index.ts'
import type { CampaignScope } from '../stack_catalog/campaign.ts'

/** Reassess a saved company's full observed pool with current membership; never rewrite its old run. */
export function selectionContext(parent: VacancyCollection, input: { runId: string; companyId: string; scope: CampaignScope }): VacancyCollection {
  const sources = parent.sources.filter(s => s.database?.companyId === input.companyId)
  if (!sources.length) throw Error('saved_company_source_missing')
  const ids = new Set(sources.map(s => s.database!.sourceId))
  const audit = parent.audit.filter(a => ids.has(a.source.database?.sourceId ?? ''))
  if (sources.some(s => !audit.some(a => a.source.database?.sourceId === s.database!.sourceId))) throw Error('saved_company_coverage_missing')
  return {
    version: 1, runId: input.runId, scope: input.scope, sources: structuredClone(sources), audit: structuredClone(audit), createdAt: parent.createdAt,
    positions: structuredClone(parent.positions.filter(p => [p.source, ...(p.sources ?? [])].some(s => s.database?.companyId === input.companyId))),
  }
}
