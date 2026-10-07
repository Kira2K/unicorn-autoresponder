import type { EmployerCandidate, EmployerSelectionOutcome } from './types.ts'

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function parseStopListCompany(value: unknown): string[] {
  const unique = new Set<string>()
  const result: string[] = []
  for (const item of String(value ?? '').split(',')) {
    const name = item.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
    const key = normalized(name)
    if (!key || unique.has(key)) continue
    unique.add(key)
    result.push(name)
  }
  return result
}

export function mergeEmployerCandidates(...groups: EmployerCandidate[][]): EmployerCandidate[] {
  const merged = new Map<string, EmployerCandidate>()
  for (const candidate of groups.flat()) {
    const name = candidate.name.trim()
    const key = normalized(name)
    if (!key) continue
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { name, sources: [...new Set(candidate.sources)] })
      continue
    }
    existing.sources = [...new Set([...existing.sources, ...candidate.sources])]
  }
  return [...merged.values()]
}

type EmployerAlias = { queries: string[]; official: RegExp }

const EMPLOYER_ALIASES: EmployerAlias[] = [
  { queries: ['aws', 'amazon web services'],
    official: /^Amazon Web Services(?:\s+Россия)?$/i },
  { queries: ['rbi', 'raiffeisen bank', 'raiffeisen bank international'],
    official: /^Raiffeisen Bank International AG(?:\s+Австрия)?$/i },
  { queries: ['yandex', 'яндекс'], official: /^Яндекс(?:\s+Москва)?$/i },
  { queries: ['wildberries'], official: /^RWB\s*\(Wildberries\s*&\s*Russ\)$/i }
]

export type EmployerOption = { officialName: string; text: string }

export function resolveOfficialEmployerOptions(candidate: string,
  options: EmployerOption[]): EmployerOption[] {
  const candidateKey = normalized(candidate)
  const alias = EMPLOYER_ALIASES.find(item => item.queries.some(query =>
    normalized(query) === candidateKey))
  if (alias) return options.filter(option => alias.official.test(option.officialName.trim()))
  return options.filter(option => normalized(option.officialName) === candidateKey)
}

export function employerNameKey(value: unknown): string {
  return normalized(value)
}

export type EmployerCandidateInspection =
  | { status: 'selected' | 'unselected'; officialName: string }
  | { status: 'skipped'; reason: 'not_found' | 'ambiguous' | 'employer_search_unavailable' }

export class EmployerSelectionNotPersistedError extends Error {
  readonly candidate: string
  readonly officialName: string

  constructor(candidate: string, officialName: string) {
    super(`Employer selection was not persisted: ${officialName}`)
    this.name = 'EmployerSelectionNotPersistedError'
    this.candidate = candidate
    this.officialName = officialName
  }
}

export async function applyEmployerCandidatesOneAtATime(
  candidates: EmployerCandidate[], operations: {
    inspect(candidate: EmployerCandidate): Promise<EmployerCandidateInspection>
    selectAndSave(candidate: EmployerCandidate, officialName: string): Promise<void>
  }): Promise<EmployerSelectionOutcome[]> {
  const outcomes: EmployerSelectionOutcome[] = []
  for (const candidate of candidates) {
    const inspected = await operations.inspect(candidate)
    if (inspected.status === 'skipped') {
      outcomes.push({ candidate: candidate.name, sources: candidate.sources,
        status: 'skipped', reason: inspected.reason })
      continue
    }
    if (inspected.status === 'selected') {
      outcomes.push({ candidate: candidate.name, sources: candidate.sources,
        status: 'existing', officialName: inspected.officialName })
      continue
    }
    await operations.selectAndSave(candidate, inspected.officialName)
    const persisted = await operations.inspect(candidate)
    if (persisted.status !== 'selected' || persisted.officialName !== inspected.officialName) {
      throw new EmployerSelectionNotPersistedError(candidate.name, inspected.officialName)
    }
    outcomes.push({ candidate: candidate.name, sources: candidate.sources,
      status: 'added', officialName: inspected.officialName })
  }
  return outcomes
}
