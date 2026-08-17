const { NOOP_LOGGER } = require('../../core/reporting/logger.ts') as typeof import('../../core/reporting/logger.ts')

type JsonObject = import('../types.ts').JsonObject
type Logger = import('../../core/reporting/logger.ts').Logger
type ProfileClient = import('../types.ts').ProfileClient

type FakeOptions = {
  logger?: Logger
  failWriteAt?: number
  throwAfterMutationAt?: number
  suppressMutationAt?: number
  parameters?: Record<string, Array<{ id: string; name: string }>>
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function yearMonth(value: unknown): string | undefined {
  if (!isObject(value)) return undefined
  const year = Number(value.year)
  const month = Number(value.month)
  if (!Number.isInteger(year) || !Number.isInteger(month)) return undefined
  return `${year}-${String(month).padStart(2, '0')}`
}

function arraySection(specifics: JsonObject, name: string): JsonObject[] {
  const current = specifics[name]
  if (Array.isArray(current)) {
    const normalized = current.filter(isObject)
    specifics[name] = normalized
    return normalized
  }
  const created: JsonObject[] = []
  specifics[name] = created
  return created
}

class FakeProfileClient implements ProfileClient {
  readonly reads: Array<{ accountId: string; sections: string[] }> = []
  readonly writes: Array<{ accountId: string; sequence: number }> = []
  private readonly profiles = new Map<string, JsonObject>()
  private readonly logger: Logger
  private readonly options: FakeOptions

  constructor(profiles: Record<string, JsonObject>, options: FakeOptions = {}) {
    Object.entries(profiles).forEach(([accountId, profile]) => this.profiles.set(accountId, clone(profile)))
    this.logger = options.logger ?? NOOP_LOGGER
    this.options = options
  }

  async getOwnProfile(accountId: string, sections: string[] = []): Promise<JsonObject> {
    const profile = this.profiles.get(accountId)
    if (!profile) throw new Error(`Unknown fake account: ${accountId}`)
    this.reads.push({ accountId, sections: [...sections] })
    this.logger.child({ accountId }).info('fake_client.read', 'Fake profile read выполнен.', {
      sequence: this.reads.length,
      sections,
    })
    return clone(profile)
  }

  async updateOwnProfile(accountId: string, payload: JsonObject): Promise<unknown> {
    const profile = this.profiles.get(accountId)
    if (!profile) throw new Error(`Unknown fake account: ${accountId}`)
    const sequence = this.writes.length + 1
    this.writes.push({ accountId, sequence })
    this.logger.child({ accountId }).info('fake_client.write', 'Fake profile mutation получена.', { sequence })
    if (this.options.failWriteAt === sequence) throw new Error('Fake write failure; password=should-not-leak')
    if (this.options.suppressMutationAt === sequence) return { accepted: true }

    if (typeof payload.bio === 'string') profile.bio = payload.bio
    const specifics = isObject(profile.specifics) ? profile.specifics : {}
    profile.specifics = specifics
    const wrapper = isObject(payload.specifics) ? payload.specifics : {}
    const linkedIn = isObject(wrapper.linkedin) ? wrapper.linkedin : {}
    if (typeof linkedIn.headline === 'string') profile.description = linkedIn.headline
    if (Array.isArray(linkedIn.skills)) {
      const skills = arraySection(specifics, 'skills')
      const existing = new Set(skills.map(item => String(item.name ?? '').toLocaleLowerCase()))
      linkedIn.skills.filter(isObject).forEach(item => {
        const name = typeof item.name === 'string' ? item.name : undefined
        if (name && !existing.has(name.toLocaleLowerCase())) {
          skills.push({ name })
          existing.add(name.toLocaleLowerCase())
        }
      })
    }
    if (isObject(linkedIn.experience)) this.applyExperience(specifics, linkedIn.experience)
    if (isObject(linkedIn.education)) this.applyEducation(specifics, linkedIn.education)
    if (isObject(linkedIn.open_to_work)) {
      specifics.is_open_to_work = true
      specifics.open_to_work = clone(linkedIn.open_to_work)
    }
    if (this.options.throwAfterMutationAt === sequence) {
      throw new Error('Fake uncertain write after mutation.')
    }
    return { accepted: true }
  }

  async searchLinkedInParameters(
    accountId: string,
    type: 'JOB_TITLE' | 'LOCATION',
    keywords: string,
  ): Promise<Array<{ id: string; name: string }>> {
    if (!this.profiles.has(accountId)) throw new Error(`Unknown fake account: ${accountId}`)
    const key = `${type}:${keywords.toLocaleLowerCase()}`
    const matches = this.options.parameters?.[key] ?? [{
      id: `fake-${type.toLocaleLowerCase()}-${keywords.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: keywords,
    }]
    this.logger.child({ accountId }).info('fake_client.parameter_search', 'Fake parameter search выполнен.', {
      type,
      keywords,
      matchCount: matches.length,
    })
    return clone(matches)
  }

  snapshot(accountId: string): JsonObject {
    const profile = this.profiles.get(accountId)
    if (!profile) throw new Error(`Unknown fake account: ${accountId}`)
    return clone(profile)
  }

  private applyExperience(specifics: JsonObject, input: JsonObject): void {
    const entries = arraySection(specifics, 'experience')
    const id = typeof input.id === 'string' ? input.id : `experience-${entries.length + 1}`
    const item: JsonObject = {
      id,
      company: clone(input.company),
      job_title: clone(input.job_title),
      employment_type: input.employment_type,
      location: clone(input.location),
      workplace_type: input.workplace_type,
      start_date: yearMonth(input.start_date),
      end_date: yearMonth(input.end_date),
      description: input.description,
      skills: clone(input.skills ?? []),
    }
    const index = entries.findIndex(entry => String(entry.id ?? '') === id)
    if (input.operation === 'edit' && index >= 0) entries[index] = item
    else entries.push(item)
  }

  private applyEducation(specifics: JsonObject, input: JsonObject): void {
    const entries = arraySection(specifics, 'education')
    const id = typeof input.id === 'string' ? input.id : `education-${entries.length + 1}`
    const item: JsonObject = {
      id,
      school: clone(input.school),
      degree: clone(input.degree),
      field_of_study: clone(input.field_of_study),
      start_date: yearMonth(input.start_date),
      end_date: yearMonth(input.end_date),
      grade: input.grade,
      activities: input.activities,
      description: input.description,
      skills: clone(input.skills ?? []),
    }
    const index = entries.findIndex(entry => String(entry.id ?? '') === id)
    if (input.operation === 'edit' && index >= 0) entries[index] = item
    else entries.push(item)
  }
}

module.exports = { FakeProfileClient }
