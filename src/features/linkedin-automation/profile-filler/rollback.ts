const { createHash, randomUUID } = require('node:crypto') as typeof import('node:crypto')
const { codedError, profileErrorDetails } = require('./errors.ts') as typeof import('./errors.ts')
const { logAction } = require('./log-action.ts') as typeof import('./log-action.ts')
const { linkedInPayload } = require('./payloads.ts') as typeof import('./payloads.ts')
const { publicProfileJob } = require('./job-types.ts') as typeof import('./job-types.ts')
const { resolveProfileAccount } = require('./profile-account.ts') as {
  resolveProfileAccount(repository: any, client: ProfileClient, id: number, sections: string[]):
    Promise<{ account: ProfileAccount; profile: JsonObject }>
}
const { runMutation } = require('./mutation-run.ts') as typeof import('./mutation-run.ts')
const { createProfileLogger } = require('./profile-logger.ts') as typeof import('./profile-logger.ts')
const { verifyProfile } = require('./verify.ts') as typeof import('./verify.ts')
type JsonObject = import('./input-types.ts').JsonObject
type ProfileAccount = import('./plan-types.ts').ProfileAccount
type ProfileClient = import('./plan-types.ts').ProfileClient
type ProfileJob = import('./job-types.ts').ProfileJob
type PlanStep = import('./plan-types.ts').PlanStep
type ProfilePlan = import('./plan-types.ts').ProfilePlan

function reverseStep(step: PlanStep): PlanStep {
  const value = String(step.before ?? '')
  if (step.section === 'headline') return {
    ...step, summary: 'Вернуть предыдущий Headline', before: step.after, after: value,
    payload: linkedInPayload('headline', value), verification: { kind: 'headline', expected: value }
  }
  if (step.section === 'about') return {
    ...step, summary: 'Вернуть предыдущий About', before: step.after, after: value,
    payload: { bio: value }, verification: { kind: 'about', expected: value }
  }
  throw codedError('profile_rollback_unsupported', `Rollback is not supported for ${step.section}.`)
}

function rollbackPlan(original: ProfileJob, account: ProfileAccount, profile: JsonObject): ProfilePlan {
  if (!original.plan?.steps.length || original.plan.kind !== 'apply') {
    throw codedError('profile_rollback_not_available', 'This job cannot be rolled back.')
  }
  if (!original.plan.steps.every(step => ['headline', 'about'].includes(step.section))) {
    throw codedError('profile_rollback_unsupported', 'This job contains fields without safe rollback.')
  }
  if (!original.plan.steps.every(step => verifyProfile(profile, step.verification))) {
    throw codedError('profile_rollback_state_changed', 'LinkedIn changed after this job.')
  }
  const steps = [...original.plan.steps].reverse().map(reverseStep)
  return {
    kind: 'rollback', rollbackOf: original.jobId, account,
    identity: original.plan.identity, issues: [],
    snapshot: { capturedAt: new Date().toISOString(),
      values: Object.fromEntries(steps.map(step => [step.id, structuredClone(step.before)])) },
    steps
  }
}

async function startRollback(options: any) {
  const { client, repository, store, jobs, sourceJobId, acquire, executorOptions } = options
  const jobId = randomUUID()
  const logger = executorOptions?.logger ?? createProfileLogger({ jobId })
  let release: undefined | (() => void)
  logger.event('rollback_request', 'started')
  try {
    const original: ProfileJob = jobs.get(sourceJobId) ??
      await logAction(logger, 'source_job_read', () => store.get(sourceJobId))
    if (!original || original.status !== 'succeeded') {
      throw codedError('profile_rollback_not_available', 'Only a successful job can be rolled back.')
    }
    const prior = (await logAction(logger, 'rollback_history_read', () => store.list()))
      .find((job: ProfileJob) => job.plan?.rollbackOf === sourceJobId &&
        ['running', 'succeeded'].includes(job.status))
    if (prior) throw codedError('profile_already_rolled_back', 'This job was already rolled back.')
    const acquired = await logAction(logger, 'operation_gate', () =>
      acquire('profile_rollback', sourceJobId))
    release = acquired
    const resolved = await logAction(logger, 'account_profile_read', () =>
      resolveProfileAccount(repository, client, original.platformAccountId, []))
    logger.event('rollback_plan_build', 'started')
    const plan = rollbackPlan(original, resolved.account, resolved.profile)
    logger.event('rollback_plan_build', 'succeeded', { stepCount: plan.steps.length })
    const now = new Date().toISOString()
    const job: ProfileJob = {
      jobId, platformAccountId: original.platformAccountId,
      accountId: resolved.account.accountId, clientName: original.clientName,
      status: 'running', phase: 'starting', plan,
      planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
      createdAt: now, updatedAt: now
    }
    await logAction(logger, 'job_create', () => store.create(job)); jobs.set(job.jobId, job)
    runMutation({ client, store, job, update: (patch: Partial<ProfileJob>) => Object.assign(job, patch),
      release: acquired, executorOptions: { ...executorOptions, logger } })
    logger.event('rollback_request', 'succeeded', { stepCount: plan.steps.length })
    return publicProfileJob(job)
  } catch (error) {
    logger.event('rollback_request', 'failed', profileErrorDetails(error))
    release?.()
    throw error
  }
}

module.exports = { reverseStep, rollbackPlan, startRollback }
