const { profileErrorCode, profileErrorDetails } = require('../errors.ts') as typeof import('../errors.ts')
const { logAction } = require('../log-action.ts') as typeof import('../log-action.ts')
const { profileDocument } = require('../profile-document.ts') as typeof import('../profile-document.ts')
const { logValidationFields } = require('../validation-logging.ts') as
  typeof import('../validation-logging.ts')
const { LINKEDIN_GUIDE } = require('./guide-rules.ts') as typeof import('./guide-rules.ts')
const { persistStage } = require('./job-stage.ts') as typeof import('./job-stage.ts')
const { createGenerationRuntime } = require('./runtime.ts') as {
  createGenerationRuntime(value?: any, logger?: any, job?: import('../job-types.ts').ProfileJob): any
}
const { preparationCall, preparationClient, preparationWait, checkPreparation,
  releasePreparation, stoppedPhase, GENERATION_STOPPED } = require('./cancellation.ts') as typeof import('./cancellation.ts')
const { validateWithRepair } = require('./validate-with-repair.ts') as
  typeof import('./validate-with-repair.ts')
const { metricFactCount } = require('./metric-claims.ts') as typeof import('./metric-claims.ts')
const { assignFactIds } = require('./fact-ids.ts') as typeof import('./fact-ids.ts')
const { groundAndPreview } = require('./ground-and-preview.ts') as
  { groundAndPreview(options: any, checkpoint: any): Promise<boolean> }

async function runGeneration(options: any) {
  const { job, repository, generationRepository, store, update, release, logger } = options
  let handedToPreview = false
  try {
    checkPreparation(job)
    options = { ...options, client: preparationClient(job, options.client),
      catalogRetry: { ...options.runtime?.catalogRetry,
        sleep: (ms: number) => preparationWait(job, ms, options.runtime?.catalogRetry?.sleep) } }
    const runtime = await logAction(logger, 'generation_runtime_init', () =>
      preparationCall(job, () => createGenerationRuntime(options.runtime, logger, job)))
    const context = options.cv ? { account: options.account } :
      await logAction(logger, 'generation_context_read', () =>
        preparationCall(job, () => generationRepository.getGenerationContext(job.platformAccountId, options.account)))
    const profile = await logAction(logger, 'dolphin_proxy_read', () =>
      preparationCall(job, () => runtime.loadProfile(context.account.dolphinProfileId)))
    const country = await logAction(logger, 'proxy_country_resolve', () =>
      preparationCall(job, () => runtime.resolveCountry(profile?.proxy)))
    const cv = options.cv ?? await logAction(logger, 'cv_download', () =>
      preparationCall(job, () => runtime.loadCv(context.cvUrl)))
    if (options.cv) logger.event('cv_upload_select', 'succeeded')
    await logAction(logger, 'generation_stage', () =>
      persistStage({ job, store, update }, 'generating_cv', 'extracting_cv_facts', 'memory'),
      { operation: 'extracting_cv_facts' })
    const facts = assignFactIds(await logAction(logger, 'cv_fact_extraction', () =>
      runtime.generator.extractFacts(cv)))
    logger.event('cv_metric_index', 'succeeded', { stepCount: metricFactCount(facts) })
    await logAction(logger, 'generation_stage', () =>
      persistStage({ job, store, update }, 'generating_profile', 'generating_profile', 'memory'),
      { operation: 'generating_profile' })
    const generated = await logAction(logger, 'profile_generation', () =>
      runtime.generator.generateProfile(facts, country))
    await logAction(logger, 'generation_stage', () =>
      persistStage({ job, store, update }, 'validating', 'validating_profile', 'memory'),
      { operation: 'validating_profile' })
    const validated = await validateWithRepair({ generated, facts, country,
      generator: runtime.generator, logger })
    logValidationFields(logger, profileDocument(validated.value), validated.issues)
    logger.event('generated_validation_summary', 'succeeded', {
      issueCount: validated.issues.length,
      fatalCount: validated.issues.filter((item: any) => item.level === 'fatal').length
    })
    const generation = { model: runtime.config.model, guideRevision: LINKEDIN_GUIDE.revision,
      cvRevision: options.cv ? cv.revision : `${context.cvRevision}:${cv.revision}`,
      proxyCountry: country,
      generatedAt: new Date().toISOString() }
    const checkpoint = { version: 1 as const, stage: 'resolving_job_titles' as const,
      profile: validated.value, issues: validated.issues, generation, catalogParameters: {} }
    await logAction(logger, 'generation_checkpoint_persist', async () => {
      checkPreparation(job)
      const patch = { checkpoint, status: 'validating', phase: 'resolving_job_titles', updatedAt: new Date().toISOString() }
      await store.update(job.jobId, patch)
      update(patch)
    })
    handedToPreview = await groundAndPreview({ ...options, account: context.account, generator: runtime.generator }, checkpoint)
  } catch (error) {
    const now = new Date().toISOString()
    const phase = stoppedPhase(job, 'generation_failed')
    const code = phase === 'generation_stopped' ? GENERATION_STOPPED : profileErrorCode(error)
    logger.event('profile_generation', 'failed', profileErrorDetails(error))
    update({ status: 'failed', phase, errorCode: code,
      updatedAt: now, finishedAt: now })
    await store.update(job.jobId, { status: 'failed', phase, errorCode: code,
      updatedAt: now, finishedAt: now }).catch(() => undefined)
  } finally {
    if (!handedToPreview) {
      releasePreparation(job)
      logger.event('operation_release', 'started'); release()
      logger.event('operation_release', 'succeeded')
    }
  }
}

module.exports = { runGeneration }
