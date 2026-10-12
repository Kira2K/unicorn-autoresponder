import type { PageDocument } from '../types.ts'
import { cleanPostingHtml } from './ats-reader.ts'

const employerSubdomain = (hostname: string, suffix: string) => hostname.endsWith(suffix) && hostname.length > suffix.length && !['www', 'app', 'api', 'support', 'static', 'staticfe', 'assets'].includes(hostname.slice(0, -suffix.length).split('.').pop() ?? '')
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const safeDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
const locationText = (value: any) => {
  const location = value?.location
  const parts = [clean(location?.name), clean(location?.city), clean(location?.state), clean(location?.province), clean(location?.country?.name ?? location?.country)]
  const unique = [...new Set(parts.filter(Boolean))]
  if (location?.is_remote === true || value?.isRemote === true) unique.push('Remote')
  return unique.join(', ')
}

function target(value: string) {
  const url = new URL(value)
  if (!/^https:$/.test(url.protocol) || url.username || url.password) return undefined
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (employerSubdomain(url.hostname, '.breezy.hr') && path === '/') return { kind: 'breezy' as const, url, endpoint: new URL('/json', url).href }
  if (employerSubdomain(url.hostname, '.bamboohr.com') && ['/careers', '/jobs'].includes(path)) return { kind: 'bamboohr' as const, url, endpoint: new URL('/careers/list', url).href }
  if (employerSubdomain(url.hostname, '.bamboohr.com') && /^\/careers\/\d+$/.test(path)) return { kind: 'bamboohr-detail' as const, url, endpoint: new URL(path + '/detail', url).href }
  return undefined
}

function sameHostDetail(value: unknown, listing: URL, pattern: RegExp) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value, listing)
    return url.protocol === 'https:' && url.hostname === listing.hostname && !url.username && !url.password && pattern.test(url.pathname) ? url.href : undefined
  } catch { return undefined }
}

/** Public metadata listings and separately budgeted BambooHR detail reads. */
export async function readPublicBoard(url: string, fetchImpl: typeof fetch = fetch): Promise<PageDocument | undefined> {
  const board = target(url)
  if (!board) return undefined
  const response = await fetchImpl(board.endpoint, { redirect: 'error', signal: AbortSignal.timeout(25_000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw Error(`Public ${board.kind} listing returned HTTP ${response.status}`)
  const data: any = await response.json()
  if (board.kind === 'bamboohr-detail') {
    const job = data?.result?.jobOpening
    const postingUrl = sameHostDetail(job?.jobOpeningShareUrl, board.url, /^\/careers\/\d+\/?$/)
    const bound = postingUrl && new URL(postingUrl).pathname.replace(/\/$/, '') === board.url.pathname.replace(/\/$/, '')
    const title = clean(job?.jobOpeningName), description = cleanPostingHtml(clean(job?.description))
    if (!bound || !title || !description || job?.jobOpeningStatus !== 'Open') return { url, jobs: [], links: [], text: 'Posting detail unavailable', partial: true, method: board.kind }
    return { url, jobs: [{title, description, location: locationText(job), company: '', url: postingUrl, applyUrl: postingUrl}], links: [], text: description, partial: false, method: board.kind }
  }
  const rows = board.kind === 'bamboohr' ? data?.result : data
  if (!Array.isArray(rows)) throw Error(`Public ${board.kind} response has no validated postings list`)

  const jobs: PageDocument['jobs'] = [], links: PageDocument['links'] = []
  let malformed = 0
  for (const row of rows) {
    const title = clean(board.kind === 'bamboohr' ? row?.jobOpeningName : row?.name)
    let detailUrl: string | undefined
    if (board.kind === 'bamboohr') {
      const id = clean(row?.id)
      detailUrl = /^\d+$/.test(id) ? new URL(`/careers/${id}`, board.url).href : undefined
    } else {
      const id = clean(row?.id), friendlyId = clean(row?.friendly_id)
      const expected = friendlyId && friendlyId.startsWith(id + '-') ? friendlyId : id
      const supplied = sameHostDetail(row?.url, board.url, /^\/p\/[0-9a-f]+(?:-[^/?#]+)?\/?$/i)
      detailUrl = expected && supplied && new URL(supplied).pathname.replace(/^\/p\//, '').replace(/\/$/, '') === expected ? supplied : undefined
    }
    if (!title || !detailUrl) { malformed++; continue }
    const location = locationText(row)
    jobs.push({ title, company: clean(row?.company?.name), description: '', location, url: detailUrl, applyUrl: detailUrl, ...(safeDate(row?.published_date) ? { publishedAt: safeDate(row.published_date) } : {}) })
    links.push({ text: title, url: detailUrl })
  }

  const total = board.kind === 'bamboohr' ? data?.meta?.totalCount : rows.length
  const countValid = Number.isSafeInteger(total) && total >= 0 && (board.kind !== 'bamboohr' || total === rows.length)
  const partial = malformed > 0 || !countValid
  return {
    url: board.url.href,
    jobs,
    links,
    text: jobs.length ? jobs.map(job => job.title).join('\n') : 'No current postings at this URL',
    explicitlyEmpty: !partial && total === 0 && rows.length === 0,
    partial,
    method: `${board.kind}-listing`
  }
}
