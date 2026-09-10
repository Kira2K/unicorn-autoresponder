const { createHash } = require('node:crypto') as typeof import('node:crypto')
const { buildProfilePlan } = require('./planner.ts') as typeof import('./planner.ts')
const { logAction } = require('./log-action.ts') as typeof import('./log-action.ts')
const { requestedSections, resolveProfileAccount } = require('./profile-account.ts') as {
  requestedSections(profile: import('./input-types.ts').ProfileInput): string[]
  resolveProfileAccount(repository: any, client: ProfileClient, platformAccountId: number,
    sections: string[], supplied?: import('../account-connection/types.ts').LinkedInAuthAccountRow):
    Promise<{ account: import('./plan-types.ts').ProfileAccount;
      profile: import('./input-types.ts').JsonObject }>
}
const { profileErrorCode, profileErrorDetails } = require('./errors.ts') as typeof import('./errors.ts')
const { previewSaveFailure } = require('./preview-save-state.ts') as typeof import('./preview-save-state.ts')
const { isRetryableCatalogFailure, withCatalogRetry } = require('./generation/catalog-retry.ts') as
  typeof import('./generation/catalog-retry.ts')
const { preparationClient, preparationWait, checkPreparation, releasePreparation,
  stoppedPhase, GENERATION_STOPPED } = require('./generation/cancellation.ts') as typeof import('./generation/cancellation.ts')
type ProfileJob = import('./job-types.ts').ProfileJob
type ProfileClient = import('./plan-types.ts').ProfileClient
type ProfileLogger = import('./profile-logger.ts').ProfileLogger

function planHash(plan: unknown) {
  return createHash('sha256').update(JSON.stringify(plan), 'utf8').digest('hex')
}

function runPreview(options: {
  client: ProfileClient
  repository: any
  store: any
  job: ProfileJob
  input: import('./input-types.ts').ProfileInput
  issues: import('./input-types.ts').ValidationIssue[]
  update(patch: Partial<ProfileJob>): void
  release(): void
  logger: ProfileLogger
  generation?: import('./generation/types.ts').GenerationMetadata
  account?: import('../account-connection/types.ts').LinkedInAuthAccountRow
  catalogParameters?: import('./parameter-search.ts').ParameterSearchCache
  catalogRetry?: {
    sleep?: (milliseconds: number) => Promise<void>
    random?: () => number
    now?: () => number
    onRetry?: (retry: import('./generation/catalog-retry.ts').CatalogRetry) => Promise<void> | void
  }
}) {
  const { repository, store, job, input, issues, update, release, logger, generation } = options
  const client = preparationClient(job, options.client)
  let released = false
  let activeStage = 'account_profile_read'
  const unlock = () => {
    if (!released) {
      released = true
      releasePreparation(job)
      logger.event('operation_release', 'started')
      release()
      logger.event('operation_release', 'succeeded')
    }
  }
  logger.event('preview', 'started', { issueCount: issues.length,
    fatalCount: issues.filter(item => item.level === 'fatal').length })
  logger.event('account_profile_read', 'started')
  void resolveProfileAccount(repository, client, job.platformAccountId, requestedSections(input), options.account)
    .then(async ({ account, profile }) => {
      checkPreparation(job)
      logger.event('account_profile_read', 'succeeded')
      update({ accountId: account.accountId, phase: 'building_preview' })
      activeStage = 'plan_build'
      logger.event('plan_build', 'started')
      const build = () => buildProfilePlan(client, account, input, profile, issues, logger,
        options.catalogParameters)
      const plan = generation && job.checkpoint
        ? await withCatalogRetry(build, {
          logger, sleep: ms => preparationWait(job, ms, options.catalogRetry?.sleep), random: options.catalogRetry?.random,
          now: options.catalogRetry?.now,
          onRetry: async retry => {
            checkPreparation(job)
            job.checkpoint!.retry = { provider: 'unipile', ...retry }
            const now = new Date().toISOString()
            const patch = { status: 'retrying' as const, phase: 'retrying_profile_catalog',
              checkpoint: job.checkpoint, updatedAt: now }
            update(patch)
            await store.update(job.jobId, patch)
            await options.catalogRetry?.onRetry?.(retry)
          }
        })
        : await build()
      checkPreparation(job)
      if (generation) plan.generation = generation
      logger.event('plan_build', 'succeeded', { stepCount: plan.steps.length,
        issueCount: plan.issues.length })
      const hash = planHash(plan)
      const now = new Date().toISOString()
      activeStage = 'preview_persist'
      logger.event('preview_persist', 'started')
      if (job.checkpoint) job.checkpoint.pendingPreview = { plan, planHash: hash }
      await store.update(job.jobId, {
        accountId: account.accountId, status: 'preview_ready', phase: 'preview_ready',
        plan, planHash: hash, checkpoint: null, errorCode: '', updatedAt: now
      })
      checkPreparation(job)
      logger.event('preview_persist', 'succeeded')
      unlock()
      update({ status: 'preview_ready', phase: 'preview_ready', plan, planHash: hash,
        checkpoint: null, errorCode: undefined, updatedAt: now })
      activeStage = 'preview'
      logger.event('preview', 'succeeded', { stepCount: plan.steps.length,
        issueCount: plan.issues.length })
    })
    .catch(async error => {
      const now = new Date().toISOString()
      const phase = stoppedPhase(job, 'preview_failed')
      const code = phase === 'generation_stopped' ? GENERATION_STOPPED : profileErrorCode(error)
      if (activeStage !== 'preview') logger.event(activeStage, 'failed', profileErrorDetails(error))
      logger.event('preview', 'failed', profileErrorDetails(error))
      const retryableCatalog = Boolean(code !== GENERATION_STOPPED && generation && job.checkpoint &&
        isRetryableCatalogFailure(error))
      const patch = activeStage === 'preview_persist' && job.checkpoint?.pendingPreview && code !== GENERATION_STOPPED
        ? previewSaveFailure(job, error)
        : retryableCatalog
        ? { status: 'waiting_retry' as const, phase: 'waiting_unipile_retry',
          errorCode: code, updatedAt: now }
        : { status: 'failed' as const, phase, errorCode: code,
          updatedAt: now, finishedAt: now }
      update(patch)
      await logAction(logger, 'preview_failure_persist', () => store.update(job.jobId, patch),
        { errorCode: code }).catch(() => undefined)
    })
    .finally(unlock)
}

module.exports = { planHash, runPreview }
