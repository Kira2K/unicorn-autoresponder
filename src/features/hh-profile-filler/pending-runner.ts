import { createProfileFillerService } from './service.ts'
import { errorCode, errorStage, safeErrorMessage } from './errors.ts'
import { deferJobWithoutAttempt, eligibleJobs, markDryRunPassed, markJobCompleted, markJobFailure,
  observeStatusTransitions, readState, writeState } from './state-store.ts'
import { reportProfileFillerResult } from './reporter.ts'
import { assertTerminalSuccess, PROFILE_CONTRACT_VERSION } from './contract.ts'
import type { ProfileFillerJobStatus, ProfileFillerResult } from './types.ts'

export function shouldReportProfileFillerStatus(status: ProfileFillerJobStatus): boolean {
  return status === 'completed' || status === 'exhausted' || status === 'cancelled'
}

export async function scanTransitions(options: { statePath?: string; refresh?: boolean } = {}) {
  const service = createProfileFillerService()
  const state = readState(options.statePath)
  const clients = await service.repository.listClients(options.refresh ?? true)
  const created = observeStatusTransitions(state, clients)
  writeState(state, options.statePath)
  return { state, created }
}

export async function runPending(options: { statePath?: string; scanOnly?: boolean; deferTelegram?: boolean } = {}) {
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
      job.dolphinProfileName = prepared.client.dolphinProfileName
      {
        const check = await service.dryRun(prepared, job.id)
        check.attempt = attempt
        markDryRunPassed(job, check.artifactDir)
        writeState(state, options.statePath)
        results.push(check)
      }
      executing = true
      const result = await service.execute(prepared, job.id)
      assertTerminalSuccess(result)
      result.attempt = attempt
      markJobCompleted(job, result.artifactDir)
      writeState(state, options.statePath)
      results.push(result)
      if (!options.deferTelegram) await reportProfileFillerResult(result).catch(error =>
        console.warn(`Profile filler Telegram result report failed: ${safeErrorMessage(error)}`))
    } catch (error) {
      const message = safeErrorMessage(error)
      const code = errorCode(error)
      if (code === 'profile_status_changed') {
        job.status = 'cancelled'
        job.updatedAt = new Date().toISOString()
      } else if (code === 'profile_noco_rate_limited') {
        deferJobWithoutAttempt(job, code, message,
          Number((error as any)?.details?.retryAfterMs))
      } else markJobFailure(job, code, message)
      writeState(state, options.statePath)
      const result: ProfileFillerResult = {
        ok: false,
        dryRun: false,
        scope: executing ? 'full' : 'dry-run',
        scopeComplete: false,
        operationComplete: false,
        jobId: job.id,
        clientId: job.clientId,
        clientName: job.clientName,
        market: job.market,
        dolphinProfileId: prepared?.client.dolphinProfileId ?? (error as any)?.details?.dolphinProfileId,
        dolphinProfileName: prepared?.client.dolphinProfileName ?? job.dolphinProfileName ??
          (error as any)?.details?.dolphinProfileName,
        operationId: job.id, contractVersion: PROFILE_CONTRACT_VERSION,
        stage: errorStage(error),
        code,
        attempt: job.attemptCount,
        message,
        artifactDir: String((error as any)?.details?.artifactDir ?? job.dryRunArtifact ?? '') || undefined
      }
      results.push(result)
      if (!options.deferTelegram && shouldReportProfileFillerStatus(job.status)) {
        await reportProfileFillerResult(result).catch(reportError =>
          console.warn(`Profile filler Telegram final error report failed: ${safeErrorMessage(reportError)}`))
      }
    }
  }
  return { created, results }
}
