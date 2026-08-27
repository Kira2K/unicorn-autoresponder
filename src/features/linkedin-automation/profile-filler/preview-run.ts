const { createHash } = require('node:crypto') as typeof import('node:crypto')
const { buildProfilePlan } = require('./planner.ts') as typeof import('./planner.ts')
const { logAction } = require('./log-action.ts') as typeof import('./log-action.ts')
const { requestedSections, resolveProfileAccount } = require('./profile-account.ts') as {
  requestedSections(profile: import('./input-types.ts').ProfileInput): string[]
  resolveProfileAccount(repository: any, client: ProfileClient, platformAccountId: number,
    sections: string[]): Promise<{ account: import('./plan-types.ts').ProfileAccount;
      profile: import('./input-types.ts').JsonObject }>
}
const { profileErrorCode, profileErrorDetails } = require('./errors.ts') as typeof import('./errors.ts')
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
}) {
  const { client, repository, store, job, input, issues, update, release, logger, generation } = options
  let released = false
  let activeStage = 'account_profile_read'
  const unlock = () => {
    if (!released) {
      released = true
      logger.event('operation_release', 'started')
      release()
      logger.event('operation_release', 'succeeded')
    }
  }
  logger.event('preview', 'started', { issueCount: issues.length,
    fatalCount: issues.filter(item => item.level === 'fatal').length })
  logger.event('account_profile_read', 'started')
  void resolveProfileAccount(repository, client, job.platformAccountId, requestedSections(input))
    .then(async ({ account, profile }) => {
      logger.event('account_profile_read', 'succeeded')
      update({ accountId: account.accountId, phase: 'building_preview' })
      activeStage = 'plan_build'
      logger.event('plan_build', 'started')
      const plan = await buildProfilePlan(client, account, input, profile, issues, logger)
      if (generation) plan.generation = generation
      logger.event('plan_build', 'succeeded', { stepCount: plan.steps.length,
        issueCount: plan.issues.length })
      const hash = planHash(plan)
      const now = new Date().toISOString()
      activeStage = 'preview_persist'
      logger.event('preview_persist', 'started')
      await store.update(job.jobId, {
        accountId: account.accountId, status: 'preview_ready', phase: 'preview_ready',
        plan, planHash: hash, checkpoint: null, errorCode: '', updatedAt: now
      })
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
      const code = profileErrorCode(error)
      if (activeStage !== 'preview') logger.event(activeStage, 'failed', profileErrorDetails(error))
      logger.event('preview', 'failed', profileErrorDetails(error))
      update({ status: 'failed', phase: 'preview_failed', errorCode: code,
        updatedAt: now, finishedAt: now })
      await logAction(logger, 'preview_failure_persist', () => store.update(job.jobId,
        { status: 'failed', phase: 'preview_failed', errorCode: code,
          updatedAt: now, finishedAt: now }), { errorCode: code }).catch(() => undefined)
    })
    .finally(unlock)
}

module.exports = { planHash, runPreview }
