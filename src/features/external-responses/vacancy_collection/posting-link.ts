import { postingIdentity } from '../infrastructure/posting-identity.ts'

/** An individual employer page may point to the same posting already seen in its ATS feed. */
export function resolvePostingLink<T extends { url: string; applyUrl?: string }>(job: T, page: { url: string; links: { text: string; url: string }[] }): T {
  const a = new URL(job.url), b = new URL(page.url)
  if (a.origin !== b.origin || a.pathname.replace(/\/$/, '') !== b.pathname.replace(/\/$/, '')) return job
  const targets = new Map<string, string>()
  for (const link of page.links) {
    if (!/^apply(?:\s+(?:now|for (?:this|the) (?:job|role|position)))?$/i.test(link.text.trim())) continue
    try {
      const id = postingIdentity(link.url)
      if (id.namespace && id.externalId) targets.set(`${id.namespace}:${id.externalId}`, link.url)
    } catch { /* Invalid links cannot establish identity. */ }
  }
  if (targets.size !== 1) return job
  const target = [...targets.values()][0]
  return { ...job, url: target, applyUrl: target }
}
