import { positionId } from '../infrastructure/identity.ts'
import { assertAllowedUrl } from '../infrastructure/navigation-policy.ts'
import type { DiscoveryStrategy, Position, Source, SourceAudit } from '../types.ts'
import { assertCampaignScope } from '../stack_catalog/campaign.ts'
import type { CampaignScope } from '../stack_catalog/campaign.ts'
import { CollectionPersistenceError } from './persistence-error.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { descriptionMarket } from './description-market.ts'
import { applicationDestinations } from './application-destinations.ts'
import { postingContent } from './posting-content.ts'
import { validateSourceDescriptions } from './source-quality.ts'
export type VacancyCollection = { version: 1; runId: string; sources: Source[]; positions: Position[]; audit: SourceAudit[]; createdAt: string; scope?: CampaignScope; titlePrecheck?:import('./title-precheck.ts').TitlePrecheckMetadata; sourceIssues?: string[]; deferredSources?: { id: string; companyId: string | null; reason: string }[]; scan?: {status:'running'|'interrupted'|'complete';configHash:string;companies:{id:string;name:string}[];startedAt:string;finishedAt?:string} }
export const sourceKey = (source: Source) => JSON.stringify([source.name, source.url, source.provenance ?? '', source.workbook ?? null])
export function collectionIssues(collection: VacancyCollection): string[] {
  if (!collection || collection.version !== 1 || !collection.sources?.length) return ['Company/source manifest required']
  const issues: string[] = []
  const keys = collection.sources.map(sourceKey)
  if (new Set(keys).size !== keys.length) issues.push('Duplicate manifest entries')
  for (const source of collection.sources) {
    const rows = collection.audit.filter(row => sourceKey(row.source) === sourceKey(source))
    if (rows.length !== 1 || rows[0].terminal === false || !['complete', 'partial', 'unavailable'].includes(rows[0].status) || rows[0].status === 'complete' && !rows[0].pages.length) issues.push(`${source.name}: source outcome missing or invalid`)
  }
  if (collection.audit.some(row => !keys.includes(sourceKey(row.source)))) issues.push('Audit contains an unexpected source')
  return issues
}
/** Coverage gaps do not veto fully inspected vacancies elsewhere. */
export function collectionCoverageGaps(collection: VacancyCollection): string[] {
  return [...(collection.sourceIssues ?? []), ...collection.audit.filter(row => row.status !== 'complete').map(row => `${row.source.name}: ${row.status}; ${row.issues.join('; ')}`)]
}
/** Collect the whole company manifest once, without candidate or stack filtering. Never applies. */
export async function collectVacancies(input: { runId: string; sources: Source[]; scope?: CampaignScope }, deps: { strategy: DiscoveryStrategy; checkpointPositions?: (positions: Position[]) => Promise<void> }): Promise<VacancyCollection> {
  if (!input.runId || !input.sources.length) throw Error('collection_manifest_required')
  if (input.scope) {
    assertCampaignScope(input.scope)
    if (!input.scope.stacks.length) return { version: 1, runId: input.runId, sources: structuredClone(input.sources), positions: [], audit: [], createdAt: new Date().toISOString(), scope: structuredClone(input.scope) }
  }
  for (const source of input.sources) { assertAllowedUrl(source.url); for (const url of source.listingUrls ?? []) assertAllowedUrl(url) }
  const sources = structuredClone(input.sources)
  const sourceKeys = new Set(sources.map(sourceKey)), retained = new Map<string, Position>()
  const saved = new Map<string, string>()
  const retain = async (rows: Position[]) => {
    const changed = new Map<string, Position>()
    for (const raw of rows) {
      assertAllowedUrl(raw.url); assertAllowedUrl(raw.applyUrl)
      const origins = [raw.source, ...(raw.sources ?? [])]
      if (origins.some(source => !sourceKeys.has(sourceKey(source)))) throw Error('vacancy_source_outside_manifest')
      const { fit: ignored, ...position } = structuredClone(raw); position.id = positionId(position.url)
      const content=postingContent(position.description)
      position.description=content.description
      if(content.publicationLabels.length)position.publicationLabels=[...new Set([...(position.publicationLabels??[]),...content.publicationLabels])]
      position.market = descriptionMarket(position.description)
      if (!position.applicationDestinations?.length) {
        const destinations = applicationDestinations(position)
        if (destinations.length) position.applicationDestinations = destinations
      }
      const previous = retained.get(position.id), preferred = !previous || position.description.length > previous.description.length ? position : previous
      const publishedAt=position.publishedAt??previous?.publishedAt
      if (!preferred.publishedAt && publishedAt) preferred.publishedAt=publishedAt
      preferred.publicationDates=[...new Set([...(previous?.publicationDates??[]),...(previous?.publishedAt?[previous.publishedAt]:[]),...(position.publicationDates??[]),...(position.publishedAt?[position.publishedAt]:[])])]
      preferred.sources = [...new Map([...(previous?.sources ?? []), ...origins].map(source => [sourceKey(source), source])).values()]
      preferred.applicationDestinations = [...new Map([...(previous?.applicationDestinations ?? []), ...(position.applicationDestinations ?? [])].map(route => [route.channel + ':' + route.address, route])).values()]
      retained.set(position.id, preferred)
      if (saved.get(position.id) !== digest(preferred)) changed.set(position.id, preferred)
    }
    if (changed.size && deps.checkpointPositions) {
      const positions = structuredClone([...changed.values()])
      try { await deps.checkpointPositions(positions) }
      catch (cause) { throw new CollectionPersistenceError(`collection_checkpoint_failed: ${cause instanceof Error ? cause.message : 'storage error'}`, { cause }) }
      for (const position of positions) saved.set(position.id, digest(position))
    }
  }
  const result = await deps.strategy.discover(sources, undefined, { positions: retain })
  if (result.audit.some(row => !sources.some(source => sourceKey(source) === sourceKey(row.source)))) throw Error('unexpected_source_audit')
  const audit = sources.map(source => {
    const rows = result.audit.filter(row => sourceKey(row.source) === sourceKey(source))
    return rows.length === 1 ? rows[0] : { source, status: 'unavailable' as const, terminal: false, pages: [], found: 0, issues: ['Missing or ambiguous source audit'] }
  })
  // Compatibility with third-party strategies that only return a final result.
  await retain(result.positions)
  // Apply the shared extraction gate to resumed/cached strategies too, not only fresh browser reads.
  const positions=[...retained.values()]
  return { version: 1, runId: input.runId, sources, positions, audit:validateSourceDescriptions(audit,positions), createdAt: new Date().toISOString(), ...(input.scope ? { scope: structuredClone(input.scope) } : {}) }
}
export { createWebsiteStrategy, createDialogStrategy } from './discover.ts'
export { createSkillStrategy } from './strategies/job-hunting.ts'
export { readSources } from './sources.ts'
