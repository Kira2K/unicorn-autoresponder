const { createHash, randomUUID, timingSafeEqual } = require('node:crypto')
const { NOOP_LOGGER, toSafeErrorMetadata } = require('../core/reporting/logger.ts') as typeof import('../core/reporting/logger.ts')

type Logger = import('../core/reporting/logger.ts').Logger
type ProfilePlan = import('./types.ts').ProfilePlan
type ProfilePreview = import('./types.ts').ProfilePreview

type StoredPlan = {
  plan: ProfilePlan
  planHash: string
  expiresAt: number
  consumed: boolean
}

type PreviewStoreOptions = {
  ttlMilliseconds?: number
  clock?: () => Date
  logger?: Logger
}

class PreviewStoreError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PreviewStoreError'
    this.code = code
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function publicPreview(
  planId: string,
  planHash: string,
  expiresAt: number,
  plan: ProfilePlan,
): ProfilePreview {
  return {
    planId,
    planHash,
    expiresAt: new Date(expiresAt).toISOString(),
    account: clone(plan.account),
    identity: clone(plan.identity),
    ...(plan.sourceSnapshot ? { sourceSnapshot: clone(plan.sourceSnapshot) } : {}),
    steps: plan.steps.map(({ id, section, action, summary, before, after }) =>
      clone({ id, section, action, summary, before, after })),
    issues: clone(plan.issues),
  }
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

class InMemoryPreviewStore {
  private readonly plans = new Map<string, StoredPlan>()
  private readonly ttlMilliseconds: number
  private readonly clock: () => Date
  private readonly logger: Logger

  constructor(options: PreviewStoreOptions = {}) {
    this.ttlMilliseconds = options.ttlMilliseconds ?? 5 * 60 * 1000
    if (!Number.isInteger(this.ttlMilliseconds) || this.ttlMilliseconds <= 0) {
      throw new Error('Preview TTL must be a positive integer.')
    }
    this.clock = options.clock ?? (() => new Date())
    this.logger = options.logger ?? NOOP_LOGGER
  }

  create(plan: ProfilePlan): ProfilePreview {
    const immutablePlan = clone(plan)
    const planId = randomUUID()
    const expiresAt = this.clock().getTime() + this.ttlMilliseconds
    const planHash = createHash('sha256')
      .update(`${planId}:${expiresAt}:${JSON.stringify(immutablePlan)}`, 'utf8')
      .digest('hex')
    this.plans.set(planId, { plan: immutablePlan, planHash, expiresAt, consumed: false })
    this.logger.child({
      accountId: plan.account.accountId,
      planId,
    }).info('preview.created', 'Неизменяемый план сохранён.', {
      expiresAt: new Date(expiresAt).toISOString(),
      stepCount: plan.steps.length,
      warningCount: plan.issues.length,
    })
    return publicPreview(planId, planHash, expiresAt, immutablePlan)
  }

  get(planId: string): ProfilePreview | undefined {
    const stored = this.plans.get(planId)
    if (!stored || stored.consumed || stored.expiresAt <= this.clock().getTime()) return undefined
    return publicPreview(planId, stored.planHash, stored.expiresAt, stored.plan)
  }

  consume(planId: string, planHash: string, accountId: string): ProfilePlan {
    const stored = this.plans.get(planId)
    const logger = this.logger.child({ planId, accountId })
    try {
      if (!stored) throw new PreviewStoreError('preview_not_found', 'Preview plan не найден.')
      if (stored.consumed) throw new PreviewStoreError('preview_consumed', 'Preview plan уже был использован.')
      if (stored.expiresAt <= this.clock().getTime()) {
        this.plans.delete(planId)
        throw new PreviewStoreError('preview_expired', 'Preview plan истёк.')
      }
      if (!equalHash(stored.planHash, planHash)) {
        throw new PreviewStoreError('preview_hash_mismatch', 'Preview hash не совпадает.')
      }
      if (stored.plan.account.accountId !== accountId) {
        throw new PreviewStoreError('preview_account_mismatch', 'Preview принадлежит другому аккаунту.')
      }
      stored.consumed = true
      logger.info('preview.consumed', 'Подтверждённый план получен для выполнения.', {
        stepCount: stored.plan.steps.length,
      })
      return clone(stored.plan)
    } catch (error: unknown) {
      logger.warn('preview.consume_rejected', 'План не выдан на выполнение.', toSafeErrorMetadata(error))
      throw error
    }
  }
}

module.exports = {
  InMemoryPreviewStore,
  PreviewStoreError,
}
