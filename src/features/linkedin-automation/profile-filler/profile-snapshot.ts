const { createHash, randomUUID, timingSafeEqual } = require('node:crypto')
const { NOOP_LOGGER, toSafeErrorMetadata } = require('../core/reporting/logger.ts') as typeof import('../core/reporting/logger.ts')

type JsonObject = import('./types.ts').JsonObject
type Logger = import('../core/reporting/logger.ts').Logger
type PlanSection = import('./types.ts').PlanSection
type ProfileReadSnapshot = import('./types.ts').ProfileReadSnapshot
type ProfileSnapshotReference = import('./types.ts').ProfileSnapshotReference
type SectionReadState = import('./types.ts').SectionReadState
type SectionReadStatus = import('./types.ts').SectionReadStatus

type SnapshotStoreOptions = {
  ttlMilliseconds?: number
  clock?: () => Date
  logger?: Logger
}

const PLAN_SECTIONS: PlanSection[] = [
  'headline',
  'about',
  'experience',
  'education',
  'skills',
  'open_to_work',
]

const THROTTLE_KEYS: Partial<Record<PlanSection, string>> = {
  experience: 'linkedin_experience',
  education: 'linkedin_education',
  skills: 'linkedin_skills',
  open_to_work: 'linkedin_open_to_work',
}

class ProfileSnapshotStoreError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProfileSnapshotStoreError'
    this.code = code
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function getSpecifics(profile: JsonObject): JsonObject {
  return isObject(profile.specifics) ? profile.specifics : {}
}

function throttledSections(profile: JsonObject): Set<string> {
  const specifics = getSpecifics(profile)
  const raw = Array.isArray(profile.throttled_sections)
    ? profile.throttled_sections
    : Array.isArray(specifics.throttled_sections)
      ? specifics.throttled_sections
      : []
  return new Set(raw.filter((item): item is string => typeof item === 'string'))
}

function scalarStatus(profile: JsonObject, key: string): SectionReadStatus {
  if (!hasOwn(profile, key)) return 'missing'
  const value = profile[key]
  return value === undefined || value === null || value === '' ? 'empty' : 'complete'
}

function listState(
  section: PlanSection,
  specifics: JsonObject,
  key: string,
): Pick<SectionReadState, 'status' | 'itemCount'> {
  if (!hasOwn(specifics, key) || !Array.isArray(specifics[key])) return { status: 'missing' }
  const itemCount = (specifics[key] as unknown[]).length
  return { status: itemCount ? 'complete' : 'empty', itemCount }
}

function statusForSection(
  section: PlanSection,
  profile: JsonObject,
  throttled: Set<string>,
): Pick<SectionReadState, 'status' | 'itemCount'> {
  const throttleKey = THROTTLE_KEYS[section]
  if (throttleKey && throttled.has(throttleKey)) return { status: 'throttled' }
  if (section === 'headline') return { status: scalarStatus(profile, 'description') }
  if (section === 'about') return { status: scalarStatus(profile, 'bio') }

  const specifics = getSpecifics(profile)
  if (section === 'experience') return listState(section, specifics, 'experience')
  if (section === 'education') return listState(section, specifics, 'education')
  if (section === 'skills') return listState(section, specifics, 'skills')
  if (isObject(specifics.open_to_work)) return { status: 'complete' }
  if (specifics.is_open_to_work === false) return { status: 'empty' }
  return { status: 'missing' }
}

function buildSectionStates(
  profile: JsonObject,
  requestedSections: PlanSection[],
): Record<PlanSection, SectionReadState> {
  const requested = new Set(requestedSections)
  const throttled = throttledSections(profile)
  return Object.fromEntries(PLAN_SECTIONS.map(section => {
    if (!requested.has(section)) {
      return [section, { section, requested: false, status: 'not_requested' }]
    }
    return [section, {
      section,
      requested: true,
      ...statusForSection(section, profile, throttled),
    }]
  })) as Record<PlanSection, SectionReadState>
}

function snapshotReference(snapshot: ProfileReadSnapshot): ProfileSnapshotReference {
  return clone({
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    capturedAt: snapshot.capturedAt,
    expiresAt: snapshot.expiresAt,
    sections: snapshot.sections,
  })
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

class InMemoryProfileSnapshotStore {
  private readonly snapshots = new Map<string, ProfileReadSnapshot>()
  private readonly ttlMilliseconds: number
  private readonly clock: () => Date
  private readonly logger: Logger

  constructor(options: SnapshotStoreOptions = {}) {
    this.ttlMilliseconds = options.ttlMilliseconds ?? 10 * 60 * 1000
    if (!Number.isInteger(this.ttlMilliseconds) || this.ttlMilliseconds <= 0) {
      throw new Error('Profile snapshot TTL must be a positive integer.')
    }
    this.clock = options.clock ?? (() => new Date())
    this.logger = options.logger ?? NOOP_LOGGER
  }

  save(accountId: string, profile: JsonObject, requestedSections: PlanSection[]): ProfileReadSnapshot {
    this.purgeExpired()
    const snapshotId = randomUUID()
    const capturedAt = this.clock()
    const expiresAt = new Date(capturedAt.getTime() + this.ttlMilliseconds)
    const profileCopy = clone(profile)
    const sections = buildSectionStates(profileCopy, requestedSections)
    const snapshotHash = createHash('sha256')
      .update(`${snapshotId}:${accountId}:${expiresAt.toISOString()}:${JSON.stringify(profileCopy)}:${JSON.stringify(sections)}`, 'utf8')
      .digest('hex')
    const snapshot: ProfileReadSnapshot = {
      snapshotId,
      snapshotHash,
      accountId,
      capturedAt: capturedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      profile: profileCopy,
      sections,
    }
    this.snapshots.set(snapshotId, clone(snapshot))
    const logger = this.logger.child({ accountId })
    for (const state of Object.values(sections).filter(state => state.requested)) {
      logger[state.status === 'missing' || state.status === 'throttled' ? 'warn' : 'info'](
        'snapshot.section_status',
        'Зафиксирован статус прочитанного раздела.',
        { section: state.section, status: state.status, itemCount: state.itemCount },
      )
    }
    logger.info('snapshot.saved', 'Read snapshot сохранён в памяти.', {
      snapshotId,
      capturedAt: snapshot.capturedAt,
      expiresAt: snapshot.expiresAt,
      requestedSections,
    })
    return clone(snapshot)
  }

  verify(reference: ProfileSnapshotReference, accountId: string): ProfileReadSnapshot {
    this.purgeExpired()
    const logger = this.logger.child({ accountId })
    try {
      const stored = this.snapshots.get(reference.snapshotId)
      if (!stored) throw new ProfileSnapshotStoreError('snapshot_not_found', 'Read snapshot не найден или истёк.')
      if (stored.accountId !== accountId) {
        throw new ProfileSnapshotStoreError('snapshot_account_mismatch', 'Read snapshot принадлежит другому аккаунту.')
      }
      if (!equalHash(stored.snapshotHash, reference.snapshotHash)) {
        throw new ProfileSnapshotStoreError('snapshot_hash_mismatch', 'Read snapshot hash не совпадает.')
      }
      logger.info('snapshot.verified', 'Read snapshot проверен перед mutation.', {
        snapshotId: reference.snapshotId,
      })
      return clone(stored)
    } catch (error: unknown) {
      logger.warn('snapshot.verify_rejected', 'Read snapshot не прошёл проверку.', toSafeErrorMetadata(error))
      throw error
    }
  }

  delete(snapshotId: string): boolean {
    return this.snapshots.delete(snapshotId)
  }

  private purgeExpired(): void {
    const now = this.clock().getTime()
    for (const [snapshotId, snapshot] of this.snapshots) {
      if (Date.parse(snapshot.expiresAt) <= now) this.snapshots.delete(snapshotId)
    }
  }
}

module.exports = {
  buildSectionStates,
  InMemoryProfileSnapshotStore,
  ProfileSnapshotStoreError,
  snapshotReference,
}
