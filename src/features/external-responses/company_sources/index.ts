import { isLinkedInUrl } from '../infrastructure/navigation-policy.ts'
import { readGoogleSheetSources } from './google-sheet.ts'
import type { CompanySourceCatalog, Resource, SourceLayout, WorkbookSnapshot } from './types.ts'

const hostMatches = (host: string, domains: string[]) => domains.some(domain => host === domain || host.endsWith('.' + domain))
function route(resource: Resource, layout: SourceLayout): Resource {
  if (!resource.url) return resource
  let url: URL
  try { url = new URL(resource.url) } catch { return { ...resource, status: 'review', reason: 'invalid_url' } }
  if (['mailto:', 'tel:'].includes(url.protocol)) return { ...resource, kind: 'reference', status: 'deferred', reason: 'contact_outreach_not_enabled' }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return { ...resource, status: 'review', reason: 'invalid_url' }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (isLinkedInUrl(url.href)) return { ...resource, url: url.href, status: 'blocked', reason: 'linkedin_navigation_forbidden' }
  if (hostMatches(host, ['t.me', 'telegram.me'])) { url.protocol = 'https:'; return { ...resource, kind: 'telegram', url: url.href, status: 'deferred', reason: 'tg_responses_adapter_pending' } }
  if (hostMatches(host, layout.deferredHosts ?? [])) return { ...resource, url: url.href, status: 'deferred', reason: 'paused_source' }
  if (hostMatches(host, layout.separateWorkflowHosts ?? [])) return { ...resource, url: url.href, status: 'deferred', reason: 'separate_workflow' }
  if (hostMatches(host, ['docs.google.com', 'drive.google.com'])) return { ...resource, url: url.href, status: 'review', reason: 'nested_source_adapter_required' }
  if (resource.kind === 'company') return { ...resource, url: url.href, status: 'prepared', reason: 'website_collection_pending' }
  if (resource.kind === 'aggregator') return { ...resource, url: url.href, status: 'deferred', reason: 'aggregator_adapter_pending' }
  return { ...resource, url: url.href, status: 'review', reason: 'historical_seed_requires_refresh_and_company_listing' }
}

/** Pure source preparation: no network, DB, browser, AI, uploads or applications. */
export function processCompanySources(snapshot: WorkbookSnapshot, layout: SourceLayout): CompanySourceCatalog {
  const extracted = readGoogleSheetSources(snapshot, layout), unique = new Map<string, Resource>()
  for (const entry of extracted.entries) {
    const resource = route(entry, layout), key = resource.url ? `${resource.kind}:${resource.url}` : `missing:${unique.size}`
    const previous = unique.get(key)
    if (previous) previous.references.push(...resource.references)
    else unique.set(key, resource)
  }
  const entries = [...unique.values()], companyManifest = { sources: entries.filter(e => e.kind === 'company' && e.status === 'prepared').map(entry => ({
    name: entry.name, url: entry.url!, workbook: entry.references[0].workbook,
    provenance: entry.references.map(r => `${r.registryPath} -> ${r.workbook.fileId} / ${r.workbook.sheet}!${r.workbook.companyCell}:${r.workbook.careerCell}`).join('; ')
  })) }
  return { version: 1, fileId: snapshot.metadata.id, fileName: snapshot.metadata.title, fetchedAt: snapshot.fetchedAt, registryPath: snapshot.registryPath,
    entries, sheetAudit: extracted.sheetAudit, companyManifest,
    summary: { resources: entries.length, companySources: companyManifest.sources.length, duplicateOccurrences: extracted.entries.length - entries.length,
      review: entries.filter(e => e.status === 'review').length, deferred: entries.filter(e => e.status === 'deferred').length, blocked: entries.filter(e => e.status === 'blocked').length },
    readyForFullCollection: extracted.sheetAudit.every(s => ['processed', 'skipped'].includes(s.status)) && entries.every(e => e.status === 'prepared') }
}
export type * from './types.ts'
