/** Follow only the application iframe actually rendered by the matching SumUp posting. */
export function observedSumupApplicationUrl(pageUrl: string, frameUrls: string[]): string {
  const posting = new URL(pageUrl)
  const jobId = sumupPostingId(posting)
  if (!jobId) throw Error('Unsupported SumUp posting route')
  const matches = frameUrls.filter(value => {
    try { return new URL(value, posting).pathname === '/embed/job_app' }
    catch { return false }
  })
  if (matches.length !== 1) throw Error('Observed SumUp application iframe unavailable or ambiguous')
  const observed = new URL(matches[0], posting)
  if (observed.protocol !== 'https:' || observed.hostname !== 'job-boards.greenhouse.io' || observed.searchParams.get('for') !== 'sumup' || observed.searchParams.get('token') !== jobId) throw Error('Observed SumUp application iframe does not match the posting')
  return observed.toString()
}

/** Accept only the two official SumUp position URL shapes and a matching gh_jid. */
export function sumupPostingId(posting: URL): string | undefined {
  if (posting.protocol !== 'https:' || !['sumup.com', 'www.sumup.com'].includes(posting.hostname)) return undefined
  const jobId = posting.pathname.match(/^\/careers\/positions\/(?:[^/]+\/[^/]+\/[^/]+\/)?(\d+)\/?$/)?.[1]
  if (!jobId || posting.searchParams.has('gh_jid') && posting.searchParams.get('gh_jid') !== jobId) return undefined
  return jobId
}

/** Resolve a legacy route through the official board record, keeping the frozen job ID. */
export async function currentSumupPostingUrl(pageUrl: string, read: (url: string) => Promise<{ status: number; body: unknown }>, check?: (job: Record<string, unknown>) => void): Promise<string> {
  const jobId = sumupPostingId(new URL(pageUrl))
  if (!jobId) throw Error('Unsupported SumUp posting route')
  const result = await read(`https://boards-api.greenhouse.io/v1/boards/sumup/jobs/${jobId}?content=true`)
  if (result.status === 404) throw Error('posting_closed')
  if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw Error('sumup_current_job_unavailable')
  const job = result.body as { id?: number | string; absolute_url?: string }
  if (String(job.id) !== jobId || typeof job.absolute_url !== 'string' || sumupPostingId(new URL(job.absolute_url)) !== jobId) throw Error('Official SumUp job identity mismatch')
  check?.(result.body as Record<string, unknown>)
  return job.absolute_url
}

export function safeApplicationEvidenceUrl(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.delete('validityToken')
  return parsed.toString()
}
