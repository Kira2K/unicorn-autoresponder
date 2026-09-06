import type { SearchAudience } from './catalog.ts'

export const CONNECTION_AUDIENCE_SEQUENCE: readonly SearchAudience[] = [
  'recruiter', 'recruiter', 'technical', 'recruiter', 'recruiter',
  'technical', 'recruiter', 'recruiter', 'technical', 'recruiter'
]

function plannedCounts(total: number) {
  const counts: Record<SearchAudience, number> = { recruiter: 0, technical: 0 }
  for (let index = 0; index < total; index += 1) {
    counts[CONNECTION_AUDIENCE_SEQUENCE[index % CONNECTION_AUDIENCE_SEQUENCE.length]] += 1
  }
  return counts
}

export function nextConnectionAudience(sent: Record<SearchAudience, number>,
  quota: Record<SearchAudience, number>): SearchAudience | undefined {
  const remaining = (audience: SearchAudience) => sent[audience] < quota[audience]
  if (!remaining('recruiter') && !remaining('technical')) return undefined

  const expected = plannedCounts(sent.recruiter + sent.technical + 1)
  const deficits = (['recruiter', 'technical'] as const)
    .filter(remaining)
    .map(audience => ({ audience, deficit: expected[audience] - sent[audience] }))
    .sort((left, right) => right.deficit - left.deficit ||
      CONNECTION_AUDIENCE_SEQUENCE.indexOf(left.audience) -
      CONNECTION_AUDIENCE_SEQUENCE.indexOf(right.audience))
  return deficits[0]?.audience
}
