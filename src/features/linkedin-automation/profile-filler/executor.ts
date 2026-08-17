const {
  differs,
  experienceMatches,
  educationMatches,
  normalizeEducation,
  normalizeExperience
} = require('./planner.ts') as typeof import('./planner.ts')
const {
  DEFAULT_LINKEDIN_TIMING_POLICY,
  randomDelayMilliseconds,
  validateTimingPolicy
} = require('../core/safety/timing-policy.ts') as typeof import('../core/safety/timing-policy.ts')
const {
  NOOP_LOGGER,
  toSafeErrorMetadata
} = require('../core/reporting/logger.ts') as typeof import('../core/reporting/logger.ts')

type FillResult = import('./types.ts').FillResult
type PlanStep = import('./types.ts').PlanStep
type ProfileClient = import('./types.ts').ProfileClient
type ProfilePlan = import('./types.ts').ProfilePlan
type VerificationSpec = import('./types.ts').VerificationSpec
type Logger = import('../core/reporting/logger.ts').Logger
type RandomInt = import('../core/safety/timing-policy.ts').RandomInt
type TimingPolicy = import('../core/safety/timing-policy.ts').TimingPolicy
type JsonObject = Record<string, unknown>

type ExecutorOptions = {
  timingPolicy?: TimingPolicy
  verificationAttempts?: number
  randomInt?: RandomInt
  wait?: (milliseconds: number) => Promise<void>
  onProgress?: (message: string) => void
  logger?: Logger
  jobId?: string
  shouldCancel?: () => boolean
}

type VerificationOptions = {
  attempts: number
  timingPolicy: TimingPolicy
  randomInt?: RandomInt
  wait: (milliseconds: number) => Promise<void>
  onProgress?: (message: string) => void
  logger: Logger
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getSpecifics(profile: JsonObject): JsonObject {
  return isObject(profile.specifics) ? profile.specifics : {}
}

function getSection(profile: JsonObject, name: string): JsonObject[] {
  const value = getSpecifics(profile)[name]
  return Array.isArray(value) ? value.filter(isObject) : []
}

function nameValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!isObject(value)) return undefined
  return typeof value.name === 'string' ? value.name : undefined
}

function matchesExpected(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false
    return expected.every(expectedItem =>
      actual.some(actualItem => matchesExpected(actualItem, expectedItem)))
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return false
    return Object.entries(expected).every(([key, expectedValue]) =>
      matchesExpected(actual[key], expectedValue))
  }
  return Object.is(actual, expected)
}

function sectionsFor(spec: VerificationSpec): string[] {
  if (spec.kind === 'experience') return ['linkedin_experience']
  if (spec.kind === 'education') return ['linkedin_education']
  if (spec.kind === 'skills') return ['linkedin_skills']
  return []
}

function verifyProfile(profile: JsonObject, spec: VerificationSpec): boolean {
  if (spec.kind === 'headline') return String(profile.description ?? '') === spec.expected
  if (spec.kind === 'about') return String(profile.bio ?? '') === spec.expected
  if (spec.kind === 'skills') {
    const names = new Set(
      getSection(profile, 'skills')
        .map(item => nameValue(item)?.toLocaleLowerCase())
        .filter((name): name is string => Boolean(name))
    )
    return spec.expected.every(name => names.has(name.toLocaleLowerCase()))
  }
  if (spec.kind === 'experience') {
    const entries = getSection(profile, 'experience')
    const target = spec.id
      ? entries.find(item => String(item.id ?? '') === spec.id)
      : entries.find(item => experienceMatches(item, {
          company: spec.expected.company,
          jobTitle: spec.expected.jobTitle,
          startDate: spec.expected.startDate
        }))
    if (!target) return false
    return !differs(normalizeExperience(target), {
      company: spec.expected.company,
      job_title: spec.expected.jobTitle,
      employment_type: spec.expected.employmentType,
      location: spec.expected.location,
      workplace_type: spec.expected.workplaceType,
      start_date: `${spec.expected.startDate.year}-${String(spec.expected.startDate.month).padStart(2, '0')}`,
      end_date: spec.expected.endDate
        ? `${spec.expected.endDate.year}-${String(spec.expected.endDate.month).padStart(2, '0')}`
        : undefined,
      description: spec.expected.description,
      skills: spec.expected.skills
    })
  }
  if (spec.kind === 'education') {
    const entries = getSection(profile, 'education')
    const target = spec.id
      ? entries.find(item => String(item.id ?? '') === spec.id)
      : entries.find(item => educationMatches(item, {
          school: spec.expected.school,
          startDate: spec.expected.startDate
        }))
    if (!target) return false
    return !differs(normalizeEducation(target), {
      school: spec.expected.school,
      degree: spec.expected.degree,
      field_of_study: spec.expected.fieldOfStudy,
      start_date: `${spec.expected.startDate.year}-${String(spec.expected.startDate.month).padStart(2, '0')}`,
      end_date: spec.expected.endDate
        ? `${spec.expected.endDate.year}-${String(spec.expected.endDate.month).padStart(2, '0')}`
        : undefined,
      grade: spec.expected.grade,
      activities: spec.expected.activities,
      description: spec.expected.description,
      skills: spec.expected.skills
    })
  }
  if (spec.kind === 'open_to_work') {
    const specifics = getSpecifics(profile)
    return specifics.is_open_to_work === true &&
      isObject(specifics.open_to_work) &&
      matchesExpected(specifics.open_to_work, spec.expected)
  }
  return false
}

async function verifyStep(
  client: ProfileClient,
  accountId: string,
  step: PlanStep,
  options: VerificationOptions
): Promise<boolean> {
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const range = attempt === 1
      ? options.timingPolicy.firstReadBack
      : options.timingPolicy.repeatedReadBack
    const delay = randomDelayMilliseconds(range, options.randomInt)
    options.onProgress?.(`Пауза ${delay} мс перед read-back ${attempt}/${options.attempts}.`)
    options.logger.debug('step.readback.delay_scheduled', 'Запланирована пауза перед read-back.', {
      attempt,
      attempts: options.attempts,
      delayMilliseconds: delay,
    })
    await options.wait(delay)
    options.logger.info('step.readback.started', 'Выполняется проверочное чтение профиля.', {
      attempt,
      attempts: options.attempts,
      sections: sectionsFor(step.verification),
    })
    const profile = await client.getOwnProfile(accountId, sectionsFor(step.verification))
    if (verifyProfile(profile, step.verification)) {
      options.logger.info('step.readback.verified', 'Read-back подтвердил изменение.', { attempt })
      return true
    }
    options.logger.warn('step.readback.mismatch', 'Read-back пока не подтвердил изменение.', { attempt })
  }
  return false
}

async function executeProfilePlan(
  client: ProfileClient,
  plan: ProfilePlan,
  options: ExecutorOptions = {}
): Promise<FillResult> {
  const startedAt = new Date().toISOString()
  const results: FillResult['steps'] = []
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const timingPolicy = options.timingPolicy ?? DEFAULT_LINKEDIN_TIMING_POLICY
  validateTimingPolicy(timingPolicy)
  const logger = (options.logger ?? NOOP_LOGGER).child({
    accountId: plan.account.accountId,
    ...(options.jobId ? { jobId: options.jobId } : {}),
  })
  const verifyOptions = {
    attempts: Math.max(1, options.verificationAttempts ?? 5),
    timingPolicy,
    randomInt: options.randomInt,
    wait,
    onProgress: options.onProgress,
    logger
  }

  logger.info('execution.started', 'Выполнение ProfilePlan начато.', {
    stepCount: plan.steps.length,
  })

  let cancelled = false

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]
    const stepLogger = logger.child({ stepId: step.id })
    if (options.shouldCancel?.()) {
      cancelled = true
      stepLogger.warn('execution.cancelled', 'Выполнение остановлено до следующей записи.')
      break
    }
    const previousStep = plan.steps[index - 1]
    const delayRange = index === 0
      ? timingPolicy.firstWrite
      : step.section === 'skills' && previousStep?.section === 'skills'
        ? timingPolicy.skillsBatch
        : timingPolicy.ordinaryWrite
    const delay = randomDelayMilliseconds(delayRange, options.randomInt)
    options.onProgress?.(`Пауза ${delay} мс перед изменением.`)
    stepLogger.debug('step.write.delay_scheduled', 'Запланирована пауза перед записью.', {
      delayMilliseconds: delay,
      section: step.section,
      action: step.action,
    })
    await wait(delay)

    if (options.shouldCancel?.()) {
      cancelled = true
      stepLogger.warn('execution.cancelled', 'Выполнение остановлено после паузы, до записи.')
      break
    }

    options.onProgress?.(`[${index + 1}/${plan.steps.length}] ${step.summary}`)
    const stepStartedAt = new Date().toISOString()
    stepLogger.info('step.write.started', 'Начато изменение раздела профиля.', {
      position: index + 1,
      totalSteps: plan.steps.length,
      section: step.section,
      action: step.action,
    })

    let writeError: unknown
    let writeFailed = false
    try {
      await client.updateOwnProfile(plan.account.accountId, step.payload)
      stepLogger.info('step.write.succeeded', 'Адаптер принял запрос; требуется read-back.')
    } catch (error: unknown) {
      writeFailed = true
      writeError = error
      stepLogger.warn(
        'step.write.uncertain',
        'Запись завершилась ошибкой; перед итоговым статусом обязателен read-back.',
        toSafeErrorMetadata(error),
      )
    }

    if (writeFailed) {
      let verifiedAfterError = false
      try {
        verifiedAfterError = await verifyStep(client, plan.account.accountId, step, {
          ...verifyOptions,
          logger: stepLogger,
        })
      } catch (readBackError: unknown) {
        stepLogger.error(
          'step.readback.failed_after_write_error',
          'Read-back после неопределённой ошибки записи тоже завершился ошибкой.',
          toSafeErrorMetadata(readBackError),
        )
      }

      if (verifiedAfterError) {
        results.push({
          stepId: step.id,
          section: step.section,
          status: 'verified',
          message: 'Запись вернула ошибку, но изменение подтверждено обязательным read-back.',
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
        })
        stepLogger.warn(
          'step.completed_after_write_error',
          'Шаг подтверждён read-back после неопределённой ошибки записи.',
        )
        if (options.shouldCancel?.()) {
          cancelled = true
          stepLogger.warn('execution.cancelled', 'Отмена применена после обязательного read-back.')
          break
        }
        continue
      }

      const safeWriteError = toSafeErrorMetadata(writeError)
      results.push({
        stepId: step.id,
        section: step.section,
        status: 'failed',
        message: String(safeWriteError.message ?? 'Запись не подтверждена read-back.'),
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
      })
      stepLogger.error(
        'step.failed',
        'Ошибка записи не была подтверждена обязательным read-back.',
        safeWriteError,
      )
      break
    }

    try {
      const verified = await verifyStep(client, plan.account.accountId, step, {
        ...verifyOptions,
        logger: stepLogger,
      })
      if (!verified) {
        results.push({
          stepId: step.id,
          section: step.section,
          status: 'failed',
          message: 'Изменение отправлено, но read-back не подтвердил результат.',
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
        })
        stepLogger.error('step.failed', 'Изменение не подтверждено read-back.')
        break
      }
      results.push({
        stepId: step.id,
        section: step.section,
        status: 'verified',
        message: 'Изменение подтверждено чтением профиля.',
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
      })
      stepLogger.info('step.completed', 'Шаг подтверждён и завершён.')
      if (options.shouldCancel?.()) {
        cancelled = true
        stepLogger.warn('execution.cancelled', 'Отмена применена после обязательного read-back.')
        break
      }
    } catch (error: unknown) {
      const safeError = toSafeErrorMetadata(error)
      results.push({
        stepId: step.id,
        section: step.section,
        status: 'failed',
        message: String(safeError.message ?? 'Неизвестная ошибка.'),
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
      })
      stepLogger.error('step.failed', 'Read-back завершился ошибкой.', safeError)
      break
    }
  }

  const failed = results.some(result => result.status === 'failed')
  const result: FillResult = {
    accountId: plan.account.accountId,
    identity: plan.identity,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: !plan.steps.length ? 'no_changes' : failed ? 'failed' : cancelled ? 'cancelled' : 'verified',
    steps: results
  }
  logger.info('execution.completed', 'Выполнение ProfilePlan завершено.', {
    status: result.status,
    completedSteps: results.length,
    totalSteps: plan.steps.length,
  })
  return result
}

module.exports = {
  executeProfilePlan,
  verifyProfile,
  verifyStep
}
