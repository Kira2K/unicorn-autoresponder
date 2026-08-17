const { NOOP_LOGGER, toSafeErrorMetadata } = require('../core/reporting/logger.ts') as typeof import('../core/reporting/logger.ts')
const { validateProfileFile } = require('./validator.ts') as typeof import('./validator.ts')
const { buildProfilePlan } = require('./planner.ts') as typeof import('./planner.ts')
const { executeProfilePlan } = require('./executor.ts') as typeof import('./executor.ts')
const { InMemoryPreviewStore } = require('./preview-store.ts') as typeof import('./preview-store.ts')
const { AccountJobManager } = require('./job-manager.ts') as typeof import('./job-manager.ts')
const {
  InMemoryProfileSnapshotStore,
  snapshotReference,
} = require('./profile-snapshot.ts') as typeof import('./profile-snapshot.ts')

type ConnectedAccount = import('../core/account/connected-account.ts').ConnectedAccount
type ExecutorOptions = Parameters<typeof import('./executor.ts').executeProfilePlan>[2]
type JobHandle<T> = import('./job-manager.ts').JobHandle<T>
type JobSnapshot = import('./job-manager.ts').JobSnapshot
type Logger = import('../core/reporting/logger.ts').Logger
type NamedParameter = import('./types.ts').NamedParameter
type PlanSection = import('./types.ts').PlanSection
type FillResult = import('./types.ts').FillResult
type ProfileClient = import('./types.ts').ProfileClient
type ProfilePlan = import('./types.ts').ProfilePlan
type ProfilePreview = import('./types.ts').ProfilePreview
type SectionReadState = import('./types.ts').SectionReadState
type ValidationIssue = import('./types.ts').ValidationIssue

type ServiceOptions = {
  client: ProfileClient
  logger?: Logger
  previewStore?: InstanceType<typeof InMemoryPreviewStore>
  snapshotStore?: InstanceType<typeof InMemoryProfileSnapshotStore>
  jobManager?: InstanceType<typeof AccountJobManager>
  executorOptions?: ExecutorOptions
}

type MutationInput = {
  planId: string
  planHash: string
  accountId: string
}

class ProfileValidationError extends Error {
  code = 'profile_validation_failed'
  issues: ValidationIssue[]

  constructor(message: string, issues: ValidationIssue[]) {
    super(message)
    this.name = 'ProfileValidationError'
    this.issues = structuredClone(issues)
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizedProfileUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return `${url.hostname.toLocaleLowerCase()}${url.pathname.replace(/\/+$/, '').toLocaleLowerCase()}`
  } catch {
    return value.replace(/[?#].*$/, '').replace(/\/+$/, '').toLocaleLowerCase()
  }
}

function identityIssue(account: ConnectedAccount, profile: Record<string, unknown>): ValidationIssue | undefined {
  const displayName = stringValue(profile.display_name)
  const profileUrl = stringValue(profile.profile_url)
  if (!displayName) {
    return { level: 'fatal', path: 'identity.display_name', message: 'Не удалось прочитать имя LinkedIn-профиля.' }
  }
  if (account.profileUrl && profileUrl && normalizedProfileUrl(account.profileUrl) !== normalizedProfileUrl(profileUrl)) {
    return { level: 'fatal', path: 'identity.profile_url', message: 'Прочитан другой LinkedIn-профиль.' }
  }
  if ((!account.profileUrl || !profileUrl) && account.displayName.trim().toLocaleLowerCase() !== displayName.toLocaleLowerCase()) {
    return { level: 'fatal', path: 'identity.display_name', message: 'Имя профиля не совпадает с ConnectedAccount.' }
  }
  return undefined
}

function requestedPlanSections(profile: import('./types.ts').ProfileInput): PlanSection[] {
  const sections: PlanSection[] = []
  if (profile.headline !== undefined) sections.push('headline')
  if (profile.about !== undefined) sections.push('about')
  if (profile.experience.length) sections.push('experience')
  if (profile.education.length) sections.push('education')
  if (profile.skills.add.length) sections.push('skills')
  if (profile.openToWork) sections.push('open_to_work')
  return sections
}

function providerSections(sections: PlanSection[]): string[] {
  const result: string[] = []
  if (sections.includes('experience')) result.push('linkedin_experience')
  if (sections.includes('education')) result.push('linkedin_education')
  if (sections.includes('skills')) result.push('linkedin_skills')
  return result
}

class ProfileFillerService {
  private readonly client: ProfileClient
  private readonly logger: Logger
  private readonly previews: InstanceType<typeof InMemoryPreviewStore>
  private readonly snapshots: InstanceType<typeof InMemoryProfileSnapshotStore>
  private readonly jobs: InstanceType<typeof AccountJobManager>
  private readonly executorOptions: ExecutorOptions

  constructor(options: ServiceOptions) {
    this.client = options.client
    this.logger = options.logger ?? NOOP_LOGGER
    this.previews = options.previewStore ?? new InMemoryPreviewStore({ logger: this.logger })
    this.snapshots = options.snapshotStore ?? new InMemoryProfileSnapshotStore({ logger: this.logger })
    this.jobs = options.jobManager ?? new AccountJobManager({ logger: this.logger })
    this.executorOptions = options.executorOptions ?? {}
  }

  startPreview(account: ConnectedAccount, profileFile: unknown): JobHandle<ProfilePreview> {
    const accountSnapshot = structuredClone(account)
    const profileFileSnapshot = structuredClone(profileFile)
    return this.jobs.enqueue({
      type: 'read_only',
      kind: 'profile_preview',
      accountId: accountSnapshot.accountId,
      run: async context => {
        const logger = this.logger.child({ jobId: context.jobId, accountId: accountSnapshot.accountId })
        logger.info('validation.started', 'Начата проверка profile.json.')
        const validation = validateProfileFile(profileFileSnapshot)
        for (const issue of validation.issues) {
          logger[issue.level === 'fatal' ? 'error' : 'warn'](
            'validation.issue',
            issue.message,
            { level: issue.level, path: issue.path, resolution: issue.resolution },
          )
        }
        if (!validation.value || validation.issues.some(issue => issue.level === 'fatal')) {
          throw new ProfileValidationError('profile.json не прошёл обязательную проверку.', validation.issues)
        }
        if (context.shouldCancel()) {
          const { JobCancelledError } = require('./job-manager.ts') as typeof import('./job-manager.ts')
          throw new JobCancelledError()
        }
        logger.info('validation.completed', 'profile.json нормализован.', {
          warningCount: validation.issues.length,
        })

        const planSections = requestedPlanSections(validation.value)
        const apiSections = providerSections(planSections)
        logger.info('profile.read.started', 'Начато чтение текущего профиля.', {
          planSections,
          apiSections,
        })
        const currentProfile = await this.client.getOwnProfile(accountSnapshot.accountId, apiSections)
        logger.info('profile.read.completed', 'Текущий профиль прочитан.', { sectionCount: apiSections.length })
        const mismatch = identityIssue(accountSnapshot, currentProfile)
        if (mismatch) {
          logger.error('identity.mismatch', mismatch.message, { path: mismatch.path })
          throw new ProfileValidationError('Не удалось подтвердить LinkedIn identity.', [mismatch])
        }
        logger.info('identity.verified', 'LinkedIn identity подтверждён.', {
          displayName: currentProfile.display_name,
          profileUrl: currentProfile.profile_url,
        })

        const snapshot = this.snapshots.save(
          accountSnapshot.accountId,
          currentProfile,
          planSections,
        )
        const sourceSnapshot = snapshotReference(snapshot)

        logger.info('planner.started', 'Начато построение diff-плана.')
        const plan = await buildProfilePlan(
          accountSnapshot,
          validation.value,
          snapshot.profile,
          validation.issues,
          {
            resolveParameter: (type, value) => this.resolveParameter(accountSnapshot.accountId, type, value, logger),
            sectionStatuses: Object.fromEntries(
              Object.entries(snapshot.sections).map(([section, state]) => [
                section,
                (state as SectionReadState).status,
              ]),
            ),
            sourceSnapshot,
          },
        )
        for (const step of plan.steps) {
          logger.child({ stepId: step.id }).info('planner.step_added', 'Шаг добавлен в план.', {
            section: step.section,
            action: step.action,
            summary: step.summary,
          })
        }
        logger.info('planner.completed', 'Diff-план построен.', {
          stepCount: plan.steps.length,
          issueCount: plan.issues.length,
        })
        return this.previews.create(plan)
      },
    })
  }

  startMutation(input: MutationInput): JobHandle<FillResult> {
    const inputSnapshot = structuredClone(input)
    return this.jobs.enqueue({
      type: 'mutation',
      kind: 'profile_fill',
      accountId: inputSnapshot.accountId,
      run: async context => {
        const logger = this.logger.child({
          jobId: context.jobId,
          accountId: inputSnapshot.accountId,
          planId: inputSnapshot.planId,
        })
        logger.info('mutation.confirmed', 'Получено подтверждение выполнения server-side плана.')
        const plan: ProfilePlan = this.previews.consume(
          inputSnapshot.planId,
          inputSnapshot.planHash,
          inputSnapshot.accountId,
        )
        if (!plan.sourceSnapshot) {
          throw new ProfileValidationError('У плана отсутствует сохранённый read snapshot.', [{
            level: 'fatal',
            path: 'source_snapshot',
            message: 'Mutation запрещён без сохранённого read snapshot.',
          }])
        }
        this.snapshots.verify(plan.sourceSnapshot, inputSnapshot.accountId)
        try {
          return await executeProfilePlan(this.client, plan, {
            ...this.executorOptions,
            logger,
            jobId: context.jobId,
            shouldCancel: context.shouldCancel,
          })
        } catch (error: unknown) {
          logger.error('mutation.failed', 'Выполнение подтверждённого плана завершилось ошибкой.', toSafeErrorMetadata(error))
          throw error
        } finally {
          this.snapshots.delete(plan.sourceSnapshot.snapshotId)
          logger.info('snapshot.released', 'Read snapshot удалён после завершения mutation.', {
            snapshotId: plan.sourceSnapshot.snapshotId,
          })
        }
      },
    })
  }

  getJob(jobId: string): JobSnapshot | undefined {
    return this.jobs.getJob(jobId)
  }

  waitFor<T>(jobId: string): Promise<T> {
    return this.jobs.waitFor<T>(jobId)
  }

  cancel(jobId: string): boolean {
    return this.jobs.cancel(jobId)
  }

  private async resolveParameter(
    accountId: string,
    type: 'JOB_TITLE' | 'LOCATION',
    value: NamedParameter,
    logger: Logger,
  ): Promise<{ id: string; name: string } | undefined> {
    if (value.id) return { id: value.id, name: value.name }
    if (!this.client.searchLinkedInParameters) {
      logger.warn('parameter_search.unavailable', 'Адаптер не поддерживает поиск LinkedIn parameter.', {
        type,
        name: value.name,
      })
      return undefined
    }
    logger.info('parameter_search.started', 'Начат поиск LinkedIn parameter.', { type, name: value.name })
    const matches = await this.client.searchLinkedInParameters(accountId, type, value.name)
    const exact = matches.filter(match => match.name.trim().toLocaleLowerCase() === value.name.trim().toLocaleLowerCase())
    const selected = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined
    logger[selected ? 'info' : 'warn'](
      selected ? 'parameter_search.resolved' : 'parameter_search.ambiguous',
      selected ? 'LinkedIn parameter однозначно определён.' : 'LinkedIn parameter не определён однозначно.',
      { type, name: value.name, matchCount: matches.length },
    )
    return selected
  }
}

module.exports = {
  ProfileFillerService,
  ProfileValidationError,
}
