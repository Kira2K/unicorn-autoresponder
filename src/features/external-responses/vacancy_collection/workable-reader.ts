import type { PageDocument } from '../types.ts'
import { cleanPostingHtml } from './ats-reader.ts'
import { descriptionIssue } from './description-quality.ts'

const HOST = 'apply.workable.com'
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function target(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== HOST || url.port || url.username || url.password) return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 1 && !(parts.length === 3 && parts[1].toLowerCase() === 'j')) return undefined
  let org: string
  try { org = decodeURIComponent(parts[0] ?? '') } catch { return undefined }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(org)) return undefined
  if (['api','j','login','signin','signup','register','privacy','terms','backend'].includes(org.toLowerCase())) return undefined
  const jobId = parts.length === 3 && /^[0-9a-f]+$/i.test(parts[2]) ? parts[2].toUpperCase() : undefined
  if (parts.length === 3 && !jobId) return undefined
  return { url, org, jobId }
}

function actualJobUrl(value: unknown, org: string, id: string, apply: boolean) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== HOST || url.port || url.username || url.password) return undefined
    const escapedOrg = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const suffix = apply ? '\\/apply' : ''
    const match = url.pathname.match(new RegExp(`^(?:/${escapedOrg})?/j/([0-9a-f]+)${suffix}/?$`, 'i'))
    return match?.[1].toUpperCase() === id ? url.href : undefined
  } catch { return undefined }
}

function locationText(row: any) {
  const locations = Array.isArray(row?.locations) ? row.locations : []
  const values = locations.map((location: any) => [clean(location?.city), clean(location?.region), clean(location?.country)].filter(Boolean).join(', ')).filter(Boolean)
  if (!values.length) values.push([clean(row?.city), clean(row?.state), clean(row?.country)].filter(Boolean).join(', '))
  if (row?.telecommuting === true) values.push('Remote')
  return [...new Set(values.filter(Boolean))].join(' | ')
}

/** Reads Workable's public employer widget. Scoped detail paths still use the employer-bound full feed. */
export async function readWorkable(url: string, fetchImpl: typeof fetch = fetch): Promise<PageDocument | undefined> {
  const requested = target(url)
  if (!requested) return undefined
  const endpoint = `https://${HOST}/api/v1/widget/accounts/${encodeURIComponent(requested.org)}?details=true`
  const response = await fetchImpl(endpoint, { redirect: 'error', signal: AbortSignal.timeout(25_000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw Error(`Public Workable listing returned HTTP ${response.status}`)
  const data: any = await response.json()
  if (!Array.isArray(data?.jobs)) throw Error('Public Workable response has no validated jobs list')

  const counts = new Map<string, number>()
  for (const row of data.jobs) {
    const id = clean(row?.shortcode).toUpperCase()
    if (/^[0-9A-F]+$/.test(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const jobs: PageDocument['jobs'] = []
  let malformed = 0
  for (const row of data.jobs) {
    const id = clean(row?.shortcode).toUpperCase()
    if (!/^[0-9A-F]+$/.test(id) || counts.get(id) !== 1) { malformed++; continue }
    if (requested.jobId && id !== requested.jobId) continue
    const title = clean(row?.title)
    const postingUrl = actualJobUrl(row?.url, requested.org, id, false)
    const applyUrl = actualJobUrl(row?.application_url, requested.org, id, true)
    if (!title || !postingUrl || !applyUrl) { malformed++; continue }
    const description = cleanPostingHtml([row?.description, row?.requirements, row?.benefits].filter(value => typeof value === 'string' && value.trim()).join('\n'))
    jobs.push({
      company: clean(data?.name) || requested.org,
      title,
      location: locationText(row),
      description,
      url: postingUrl,
      applyUrl,
      ...(clean(row?.published_on) ? { publishedAt: clean(row.published_on) } : {})
    })
  }

  const missingDetail = !!requested.jobId && jobs.length !== 1
  const partial = malformed > 0 || missingDetail || jobs.some(job => !!descriptionIssue(job.description))
  const fullBoard = !requested.jobId
  return {
    url: requested.url.href,
    jobs,
    links: [],
    text: jobs.length ? jobs.map(job => job.title).join('\n') : fullBoard && data.jobs.length === 0 ? 'No current postings at this URL' : 'Posting detail unavailable',
    explicitlyEmpty: fullBoard && !partial && data.jobs.length === 0,
    completeListing: fullBoard && !partial,
    partial,
    method: requested.jobId ? 'workable-detail' : 'workable-listing'
  }
}
