import type { GenerationCheckpoint } from './types.ts'

export function validCheckpoint(value: unknown): value is GenerationCheckpoint {
  const item = value as any
  return item?.version === 1 && item.stage === 'resolving_job_titles' &&
    item.profile && typeof item.profile === 'object' && Array.isArray(item.issues) &&
    item.generation && typeof item.generation.model === 'string' &&
    typeof item.generation.guideRevision === 'string' &&
    typeof item.generation.cvRevision === 'string' &&
    typeof item.generation.proxyCountry === 'string' &&
    typeof item.generation.generatedAt === 'string'
}
