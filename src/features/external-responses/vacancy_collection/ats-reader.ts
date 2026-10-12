import type { PageDocument } from '../types.ts'
import { descriptionIssue } from './description-quality.ts'

export const cleanPostingHtml = (value: unknown) => String(value ?? '')
  .replace(/<a\b[^>]*href=["'](https?:\/\/(?:t\.me|telegram\.me)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/<!--[^]*?-->/g, '').replace(/<(script|style|video|audio|iframe|svg|canvas|object|template)\b[^>]*>[^]*?<\/\1\s*>/gi, '\n')
  .replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]|section|ul|ol))>/gi, '\n').replace(/<li\b[^>]*>/gi, '- ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[\t \r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
export async function readAts(url: string, fetchImpl: typeof fetch = fetch, previous?:PageDocument): Promise<PageDocument | undefined> {
  const u = new URL(url), parts = u.pathname.split('/').filter(Boolean)
  let endpoint: string | undefined, ats = '', org = parts[0], jobId = parts[1]
  if (u.hostname === 'jobs.ashbyhq.com' && org) { ats = 'ashby'; endpoint = `https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true` }
  if (u.hostname.endsWith('greenhouse.io') && !u.hostname.startsWith('boards-api') && org) {
    ats = 'greenhouse'; org = u.searchParams.get('for') ?? org; jobId = u.searchParams.get('token') ?? parts[2]
    endpoint = `https://boards-api.greenhouse.io/v1/boards/${org}/jobs${jobId ? `/${jobId}` : ''}?content=true`
  }
  if (/^jobs\.(eu\.)?lever\.co$/.test(u.hostname) && org) { ats = 'lever'; endpoint = `https://api.${u.hostname.includes('.eu.') ? 'eu.' : ''}lever.co/v0/postings/${org}${jobId ? `/${jobId}` : ''}?mode=json` }
  if (u.hostname.endsWith('.recruitee.com')) { ats = 'recruitee'; org = u.hostname.split('.')[0]; endpoint = `https://${u.hostname}/api/offers/` }
  if (!endpoint) return undefined
  const validator=previous?.httpValidator?.endpoint===endpoint?previous.httpValidator:undefined
  const headers:Record<string,string>|undefined=validator?.etag?{'If-None-Match':validator.etag}:validator?.lastModified?{'If-Modified-Since':validator.lastModified}:undefined
  const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(25_000),headers })
  if(response.status===304) {
    if(!validator||!previous)throw Error('Public ATS 304 without a validated prior snapshot')
    return {...previous,fetchedAt:undefined,method:ats,controls:[]}
  }
  if (!response.ok) throw Error(`Public ${ats} listing returned HTTP ${response.status}`)
  const data: any = await response.json()
  if (ats === 'recruitee' && !Array.isArray(data.offers)) throw Error('Public Recruitee response has no validated offers list')
  let jobs: any[] = []
  if (ats === 'ashby') jobs = data.jobs.map((j: any) => ({ company: org, title: j.title, publishedAt: typeof j.publishedAt === 'string' ? j.publishedAt : undefined, location: [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location)].filter(Boolean).join(' | '), description: cleanPostingHtml(j.descriptionHtml ?? j.descriptionPlain), url: j.jobUrl, applyUrl: j.applyUrl ?? j.jobUrl + '/application' })).filter((j: any) => !jobId || j.url.includes(jobId))
  if (ats === 'greenhouse') jobs = (data.jobs ?? [data]).map((j: any) => ({ company: org, title: j.title, publishedAt: typeof j.first_published === 'string' ? j.first_published : undefined, location: j.location?.name ?? '', description: cleanPostingHtml(j.content), url: /^https?:\/\//i.test(j.absolute_url ?? '') ? j.absolute_url : `https://${u.hostname}/${org}/jobs/${j.id}`, applyUrl: /^https?:\/\//i.test(j.absolute_url ?? '') ? j.absolute_url : `https://${u.hostname}/${org}/jobs/${j.id}` }))
  if (ats === 'lever') jobs = (Array.isArray(data) ? data : [data]).map((j: any) => ({ company: org, title: j.text, location: [j.categories?.location, j.workplaceType].filter(Boolean).join(' | '), description: cleanPostingHtml([j.descriptionPlain ?? j.description, ...(j.lists ?? []).map((l: any) => l.text + ': ' + l.content), j.additionalPlain].join('\n')), url: j.hostedUrl, applyUrl: j.applyUrl }))
  if (ats === 'recruitee') jobs = (data.offers ?? []).filter((j: any) => !parts[1] || j.slug === parts[1]).map((j: any) => ({ company: org, title: j.title, location: [j.city, j.country, j.remote ? 'Remote' : ''].filter(Boolean).join(' | '), description: cleanPostingHtml([j.description, j.requirements].join('\n')), url: j.careers_url ?? `https://${u.hostname}/o/${j.slug}`, applyUrl: j.careers_url ?? `https://${u.hostname}/o/${j.slug}` }))
  const etag=response.headers.get('etag')??undefined,lastModified=response.headers.get('last-modified')??undefined
  const validJobs = jobs.filter(j => {
    try { return typeof j.title==='string' && !!j.title.trim() && typeof j.url==='string' && /^https?:$/.test(new URL(j.url).protocol) }
    catch { return false }
  })
  const partial = validJobs.length !== jobs.length || validJobs.some(j=>descriptionIssue(j.description))
  const listingInventoryComplete=!jobId&&validJobs.length===jobs.length
  return { url, jobs: validJobs, links: [], listingInventoryComplete, completeListing: !jobId && !partial, partial, text: jobs.length ? jobs.map(j => j.title).join('\n') : 'No current postings at this URL', explicitlyEmpty: !jobs.length, method: ats, ...((etag||lastModified)?{httpValidator:{endpoint,etag,lastModified}}:{}) }
}
