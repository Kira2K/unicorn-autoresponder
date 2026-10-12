/** Parse explicit ATS identities from observed URLs; never infer a board from a company name. */
export function postingIdentity(value: string): { platform: string | null; namespace: string | null; externalId: string | null } {
  const u = new URL(value), parts = u.pathname.split('/').filter(Boolean)
  const gh = u.searchParams.get('gh_jid') ?? (/(^|\.)greenhouse\.io$/.test(u.hostname) ? u.pathname.match(/\/jobs\/(\d+)(?:\/|$)/)?.[1] ?? u.searchParams.get('token') : null)
  if (gh && /^\d+$/.test(gh)) return { platform: 'greenhouse', namespace: 'greenhouse', externalId: gh }
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
  if (/^jobs\.(?:eu\.)?lever\.co$/.test(u.hostname) && uuid.test(parts[1] ?? '')) return { platform: 'lever', namespace: `lever:${parts[0].toLowerCase()}`, externalId: parts[1] }
  if (u.hostname === 'jobs.ashbyhq.com' && uuid.test(parts[1] ?? '')) return { platform: 'ashby', namespace: `ashby:${parts[0].toLowerCase()}`, externalId: parts[1] }
  if (u.hostname.endsWith('.bamboohr.com') && /^\/careers\/\d+\/?$/.test(u.pathname)) return { platform: 'bamboohr', namespace: `bamboohr:${u.hostname}`, externalId: parts[1] }
  if (u.hostname.endsWith('.recruitee.com')) return { platform: 'recruitee', namespace: null, externalId: null }
  return { platform: null, namespace: null, externalId: null }
}
