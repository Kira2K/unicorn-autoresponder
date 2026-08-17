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

type FillResult = import('./types.ts').FillResult
type PlanStep = import('./types.ts').PlanStep
type ProfilePlan = import('./types.ts').ProfilePlan
type VerificationSpec = import('./types.ts').VerificationSpec
type RandomInt = import('../core/safety/timing-policy.ts').RandomInt
type TimingPolicy = import('../core/safety/timing-policy.ts').TimingPolicy
type JsonObject = Record<string, unknown>

type ProfileClient = {
  updateOwnProfile(accountId: string, payload: Record<string, unknown>): Promise<unknown>
  getOwnProfile(accountId: string, sections?: string[]): Promise<JsonObject>
}

type ExecutorOptions = {
  timingPolicy?: TimingPolicy
  verificationAttempts?: number
  randomInt?: RandomInt
  wait?: (milliseconds: number) => Promise<void>
  onProgress?: (message: string) => void
}

type VerificationOptions = {
  attempts: number
  timingPolicy: TimingPolicy
  randomInt?: RandomInt
  wait: (milliseconds: number) => Promise<void>
  onProgress?: (message: string) => void
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
    return specifics.is_open_to_work === true || isObject(specifics.open_to_work)
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
    await options.wait(delay)
    const profile = await client.getOwnProfile(accountId, sectionsFor(step.verification))
    if (verifyProfile(profile, step.verification)) return true
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
  const verifyOptions = {
    attempts: Math.max(1, options.verificationAttempts ?? 5),
    timingPolicy,
    randomInt: options.randomInt,
    wait,
    onProgress: options.onProgress
  }

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]
    const previousStep = plan.steps[index - 1]
    const delayRange = index === 0
      ? timingPolicy.firstWrite
      : step.section === 'skills' && previousStep?.section === 'skills'
        ? timingPolicy.skillsBatch
        : timingPolicy.ordinaryWrite
    const delay = randomDelayMilliseconds(delayRange, options.randomInt)
    options.onProgress?.(`Пауза ${delay} мс перед изменением.`)
    await wait(delay)

    try {
      options.onProgress?.(`[${index + 1}/${plan.steps.length}] ${step.summary}`)
      await client.updateOwnProfile(plan.account.accountId, step.payload)
      const verified = await verifyStep(client, plan.account.accountId, step, verifyOptions)
      if (!verified) {
        results.push({
          stepId: step.id,
          section: step.section,
          status: 'failed',
          message: 'Изменение отправлено, но read-back не подтвердил результат.'
        })
        break
      }
      results.push({
        stepId: step.id,
        section: step.section,
        status: 'verified',
        message: 'Изменение подтверждено чтением профиля.'
      })
    } catch (error: unknown) {
      results.push({
        stepId: step.id,
        section: step.section,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
      break
    }
  }

  const failed = results.some(result => result.status === 'failed')
  return {
    accountId: plan.account.accountId,
    identity: plan.identity,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: !plan.steps.length ? 'no_changes' : failed ? 'failed' : 'verified',
    steps: results
  }
}

module.exports = {
  executeProfilePlan,
  verifyProfile,
  verifyStep
}
