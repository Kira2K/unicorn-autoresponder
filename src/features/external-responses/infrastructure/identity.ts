import { createHash } from 'node:crypto'
import type { HistoryEntry, Position } from '../types.ts'

export function canonicalUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Only HTTP(S) source URLs are supported')
  // Actual numeric vacancy-panel anchors identify separate postings on one careers page.
  if(!/^#(?:vacancy[-_]description|job|vacancy|position)[-_]\d+$/i.test(url.hash))url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|source$|ref$|referrer$)/i.test(key)) url.searchParams.delete(key)
  url.pathname = url.pathname.replace(/\/(application|apply|thanks)\/?$/, '').replace(/\/$/, '') || '/'
  if (/^(jobs\.ashbyhq\.com|jobs\.(eu\.)?lever\.co)$/.test(url.hostname) && url.pathname.split('/').filter(Boolean).length === 2) url.search = ''
  const gh = url.searchParams.get('gh_jid')
  if (/^(?:jobs|careers)\.smartrecruiters\.com$/.test(url.hostname)) {
    const parts=url.pathname.split('/').filter(Boolean),id=parts[1]?.match(/^(\d+)(?:-|$)/)?.[1]??parts[1]?.match(/^([0-9a-f]{8}-[0-9a-f-]{27})(?:-|$)/i)?.[1]
    if(parts.length===2&&id)return `smartrecruiters:${decodeURIComponent(parts[0]).toLowerCase()}:${id.toLowerCase()}`
  }
  if (gh) return `greenhouse:${gh}`
  if (url.hostname.endsWith('greenhouse.io')) {
    const id = url.pathname.match(/\/jobs\/(\d+)/)?.[1] ?? url.searchParams.get('token')
    if (id) return `greenhouse:${id}`
  }
  url.searchParams.sort()
  return url.toString()
}
export function positionId(url: string) { return createHash('sha256').update(canonicalUrl(url)).digest('hex').slice(0, 24) }
const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
function postingNamespace(url: string) {
  if (/^greenhouse:\d+$/.test(url)) return 'greenhouse'
  const smart = url.match(/^(smartrecruiters:[^:]+):[^:]+$/)
  if (smart) return smart[1]
  return url.match(/^(https:\/\/jobs\.(?:ashbyhq\.com|(?:eu\.)?lever\.co)\/[^/]+)\/[0-9a-f]{8}-[0-9a-f-]{27}\/?$/i)?.[1]
}
export function isDuplicate(p: Position, history: HistoryEntry[]) {
  const target = canonicalUrl(p.url)
  return history.some(h => {
    if (h.status === 'blocked') return false
    const previous = canonicalUrl(h.url)
    if (previous === target) return true
    // Separate authoritative ATS posting IDs remain distinct even with identical titles.
    if (postingNamespace(previous) && postingNamespace(previous) === postingNamespace(target)) return false
    return normalized(h.company) === normalized(p.company) && normalized(h.title) === normalized(p.title)
  })
}
