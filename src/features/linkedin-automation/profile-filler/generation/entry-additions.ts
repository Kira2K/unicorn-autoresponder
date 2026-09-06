import type { ValidationIssue } from '../input-types.ts'

export type GeneratedEntry = { fact_id?: unknown; description?: unknown; skills?: unknown }

export function normalizedEntries(value: unknown): GeneratedEntry[] {
  return Array.isArray(value) ? value.map(item => item && typeof item === 'object' &&
    !Array.isArray(item) ? item : {}) : []
}

export function indexEntries(entries: GeneratedEntry[], expected: Set<string>, path: string) {
  const result = new Map<string, GeneratedEntry>()
  const issues: ValidationIssue[] = []
  entries.forEach((entry, index) => {
    const id = typeof entry.fact_id === 'string' ? entry.fact_id : ''
    if (!id || !expected.has(id)) {
      issues.push({ level: 'fatal', path: `${path}[${index}].fact_id`,
        message: id ? `Unknown CV fact ID: ${id}.` : 'CV fact ID is missing.',
        resolution: 'Regenerate only the missing or invalid CV fact IDs.' })
      return
    }
    if (result.has(id)) {
      issues.push({ level: 'fatal', path: `${path}[${index}].fact_id`,
        message: `Duplicate CV fact ID: ${id}.`,
        resolution: 'Return exactly one generated addition for this CV fact ID.' })
      return
    }
    result.set(id, entry)
  })
  for (const id of expected) {
    if (!result.has(id)) issues.push({ level: 'fatal', path,
      message: `Generated addition is missing for CV fact ID: ${id}.`,
      resolution: 'Generate the missing CV fact ID without changing CV facts.' })
  }
  return { result, issues }
}
