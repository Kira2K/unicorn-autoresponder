import { createProfileFillerService } from './service.ts'
import { errorCode, errorStage, safeErrorMessage } from './errors.ts'
import { eligibleJobs, markDryRunPassed, markJobCompleted, markJobFailure,
  observeStatusTransitions, readState, writeState } from './state-store.ts'
import { reportProfileFillerResult } from './reporter.ts'
import type { ProfileFillerResult } from './types.ts'

export async function scanTransitions(options: { statePath?: string; refresh?: boolean } = {}) {
  const service = createProfileFillerService()
  const state = readState(options.statePath)
  const clients = await service.repository.listClients(options.refresh ?? true)
  const created = observeStatusTransitions(state, clients)
  writeState(state, options.statePath)
  return { state, created }
}

export async function runPending(options: { statePath?: string; scanOnly?: boolean } = {}) {
  const service = createProfileFillerService()
  const state = readState(options.statePath)
  const clients = await service.repository.listClients(true)
  const created = observeStatusTransitions(state, clients)
  writeState(state, options.statePath)
  if (options.scanOnly) return { created, results: [] as ProfileFillerResult[] }

  const results: ProfileFillerResult[] = []
  for (const job of eligibleJobs(state)) {
    const attempt = job.attemptCount + 1
    let executing = job.status === 'dry_run_passed'
    let prepared: Awaited<ReturnType<typeof service.prepare>> | undefined
    try {
      prepared = await service.prepare(job.clientId, job.market)
      if (job.status !== 'dry_run_passed') {
        const check = await service.dryRun(prepared, job.id)
        check.attempt = attempt
        markDryRunPassed(job, check.artifactDir)
        writeState(state, options.statePath)
        results.push(check)
        await reportProfileFillerResult(check).catch(error =>
          console.warn(`Profile filler Telegram dry-run report failed: ${safeErrorMessage(error)}`))
      }
      executing = true
      const result = await service.execute(prepared, job.id)
      result.attempt = attempt
      markJobCompleted(job, result.artifactDir)
      writeState(state, options.statePath)
      results.push(result)
      await reportProfileFillerResult(result).catch(error =>
        console.warn(`Profile filler Telegram result report failed: ${safeErrorMessage(error)}`))
    } catch (error) {
      const message = safeErrorMessage(error)
      if (errorCode(error) === 'profile_status_changed') {
        job.status = 'cancelled'
        job.updatedAt = new Date().toISOString()
      } else markJobFailure(job, errorCode(error), message)
      writeState(state, options.statePath)
      const result: ProfileFillerResult = {
        ok: false,
        dryRun: !executing,
        jobId: job.id,
        clientId: job.clientId,
        clientName: job.clientName,
        market: job.market,
        dolphinProfileId: prepared?.client.dolphinProfileId,
        stage: errorStage(error),
        code: errorCode(error),
        attempt: job.attemptCount,
        message,
        artifactDir: String((error as any)?.details?.artifactDir ?? job.dryRunArtifact ?? '') || undefined
      }
      results.push(result)
      await reportProfileFillerResult(result).catch(reportError =>
        console.warn(`Profile filler Telegram error report failed: ${safeErrorMessage(reportError)}`))
    }
  }
  return { created, results }
}
