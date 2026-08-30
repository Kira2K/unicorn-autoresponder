import { allFactMetrics, allowedExperienceMetrics, unsupportedMetrics } from './metric-claims.ts'

function withoutUnsupported(text: string, allowed: any[]) {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(sentence =>
    !unsupportedMetrics(sentence, allowed).length).join(' ').trim()
}

function trustedDescription(fact: any) {
  const candidates = [...(fact?.achievements ?? []), ...(fact?.responsibilities ?? [])]
  const trusted = candidates.filter(value => typeof value === 'string' && value.trim())
  if (fact?.technologies?.length) trusted.push(`Technologies: ${fact.technologies.join(', ')}.`)
  return trusted.join(' ').slice(0, 2000) ||
    `Worked as ${fact?.job_title || 'a specialist'} at ${fact?.company || 'the company'}.`
}

function safeAbout(facts: any) {
  const role = facts.target_roles?.[0] || 'Software Engineer'
  const industry = facts.industries?.slice(0, 3).join(', ') || 'software products'
  const skills = facts.skills?.slice(0, 10).join(', ') || 'modern engineering practices'
  return [
    `${role} focused on building reliable and maintainable solutions.`,
    `Professional experience includes work with ${industry}.`,
    `Core skills include ${skills}.`,
    'Open to relevant roles and professional conversations.'
  ].join('\n\n')
}

export function applyMetricFallback(document: any, facts: any) {
  const result = structuredClone(document); const profile = result?.profile
  if (!profile) return result
  ;(profile.experience ?? []).forEach((entry: any, index: number) => {
    const fact = facts.experience?.[index]; if (!fact) return
    const clean = withoutUnsupported(String(entry.data?.description ?? ''),
      allowedExperienceMetrics(fact))
    entry.data.description = clean || trustedDescription(fact)
  })
  const cleanAbout = withoutUnsupported(String(profile.about ?? ''), allFactMetrics(facts))
  profile.about = cleanAbout.split(/\n\s*\n/).filter(Boolean).length >= 4
    ? cleanAbout : safeAbout(facts)
  return result
}
