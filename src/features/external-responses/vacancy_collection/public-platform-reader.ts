import type { PageDocument } from '../types.ts'
import { cleanPostingHtml } from './ats-reader.ts'

const PAGE_LIMIT = 100
const smartHosts = new Set(['jobs.smartrecruiters.com', 'careers.smartrecruiters.com'])
const httpUrl = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : undefined } catch { return undefined }
}
const postingId = (segment: string | undefined) => segment?.match(/^(\d+)(?:-|$)/)?.[1] ?? segment?.match(/^([0-9a-f]{8}-[0-9a-f-]{27})(?:-|$)/i)?.[1]
const locationText = (location: any) => [location?.city, location?.region, location?.country, location?.remote === true ? 'Remote' : ''].filter(Boolean).join(', ')

function smartRecruitersTarget(value: string) {
  const url = new URL(value), parts = url.pathname.split('/').filter(Boolean)
  if (smartHosts.has(url.hostname) && parts[0] && parts.length <= 2) {
    const id = postingId(parts[1])
    if (parts[1] && !id) return undefined
    const offset = Number(url.searchParams.get('offset') ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid SmartRecruiters listing offset')
    return { company: parts[0], postingId: id, offset, publicUrl: url.href }
  }
  if (url.hostname === 'api.smartrecruiters.com') {
    const match = url.pathname.match(/^\/v1\/companies\/([^/]+)\/postings(?:\/([^/]+))?\/?$/)
    if (!match) return undefined
    const offset = Number(url.searchParams.get('offset') ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid SmartRecruiters listing offset')
    return { company: decodeURIComponent(match[1]), postingId: match[2] ? decodeURIComponent(match[2]) : undefined, offset, publicUrl: url.href }
  }
  return undefined
}

/** One public SmartRecruiters list page or one detail. Pagination and details are separate PageReader reads. */
export async function readPublicPlatform(url: string, fetchImpl: typeof fetch = fetch): Promise<PageDocument | undefined> {
  const target = smartRecruitersTarget(url)
  if (!target) return undefined
  const root = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(target.company)}/postings`
  const endpoint = target.postingId ? `${root}/${encodeURIComponent(target.postingId)}` : `${root}?destination=PUBLIC&limit=${PAGE_LIMIT}&offset=${target.offset}`
  const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(25_000), redirect:'error' })
  if (!response.ok) throw Error(`Public SmartRecruiters ${target.postingId ? 'detail' : 'listing'} returned HTTP ${response.status}`)
  const data: any = await response.json()

  if (!target.postingId) {
    if (!Array.isArray(data?.content)) throw Error('Public SmartRecruiters response has no validated postings list')
    const total = data.totalFound, offset = data.offset, limit = data.limit
    const countsValid = Number.isSafeInteger(total) && total >= 0 && Number.isSafeInteger(offset) && offset === target.offset && Number.isSafeInteger(limit) && limit > 0 && limit <= PAGE_LIMIT
    const jobs: PageDocument['jobs'] = [], links: PageDocument['links'] = []
    let malformed = 0
    for (const item of data.content) {
      const title = typeof item?.name === 'string' ? item.name.trim() : ''
      const ref=httpUrl(item?.ref),reference=ref&&new URL(ref).hostname==='api.smartrecruiters.com'?smartRecruitersTarget(ref):undefined
      const bound=reference?.company===target.company&&reference.postingId===String(item?.id)&&(!item.company?.identifier||item.company.identifier===target.company)
      const postingUrl = httpUrl(item?.postingUrl) ?? (bound?`https://jobs.smartrecruiters.com/${encodeURIComponent(target.company)}/${reference!.postingId}`:undefined), applyUrl = httpUrl(item?.applyUrl)
      const host = postingUrl ? new URL(postingUrl).hostname : ''
      if (!title || !postingUrl || !smartHosts.has(host) || smartRecruitersTarget(postingUrl)?.company!==target.company) { malformed++; continue }
      jobs.push({ title, company: typeof item.company?.name === 'string' ? item.company.name : target.company, location: locationText(item.location), description: '', url: postingUrl, applyUrl: applyUrl ?? postingUrl, ...(typeof item.releasedDate === 'string' ? { publishedAt: item.releasedDate } : {}) })
      links.push({ text: title, url: postingUrl })
    }
    const consumed = target.offset + data.content.length
    const hasNext = countsValid && data.content.length > 0 && consumed < total
    if (hasNext) links.push({ text: 'Next page', url: `https://jobs.smartrecruiters.com/${encodeURIComponent(target.company)}?offset=${consumed}` })
    const inconsistent = !countsValid || (countsValid && (consumed > total || data.content.length === 0 && target.offset < total))
    return { url, jobs, links, text: jobs.length ? jobs.map(job => job.title).join('\n') : 'No current postings at this URL', explicitlyEmpty: countsValid && target.offset === 0 && total === 0 && data.content.length === 0, partial: malformed > 0 || inconsistent, method: 'smartrecruiters-listing' }
  }

  const title = typeof data?.name === 'string' ? data.name.trim() : ''
  const postingUrl = httpUrl(data?.postingUrl) ?? (smartHosts.has(new URL(target.publicUrl).hostname) ? target.publicUrl : undefined)
  const applyUrl = httpUrl(data?.applyUrl)
  const sections = data?.jobAd?.sections
  const description = sections && typeof sections === 'object'
    ? cleanPostingHtml(['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation'].flatMap(key => {
      const section = sections[key]
      return section && typeof section === 'object' ? [section.title, section.text] : []
    }).filter(Boolean).join('\n'))
    : ''
  const valid = !!title && !!postingUrl && !!applyUrl && !!description
  const jobs: PageDocument['jobs'] = valid ? [{ title, company: typeof data.company?.name === 'string' ? data.company.name : target.company, location: locationText(data.location), description, url: postingUrl!, applyUrl: applyUrl!, ...(typeof data.releasedDate === 'string' ? { publishedAt: data.releasedDate } : {}) }] : []
  return { url, jobs, links: [], text: description || title || 'Posting detail unavailable', partial: !valid, method: 'smartrecruiters-detail' }
}
