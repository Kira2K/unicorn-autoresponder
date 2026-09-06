import type { ProfileJob } from './job-types.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { profileErrorDetails } from './errors.ts'

export function canRecoverVerification(job: ProfileJob) {
  return ['running', 'verifying'].includes(job.status) && Boolean(job.plan && job.result &&
    job.result.steps.some(step => step.writeIntent &&
      (job.status === 'verifying' || step.status !== 'verified')))
}

export function createVerificationRecovery(options: {
  list(): Promise<ProfileJob[]>
  isActive(id: string): boolean
  recover(job: ProfileJob): Promise<ProfileJob>
  resume(job: ProfileJob): Promise<boolean>
  logger: ProfileLogger
  schedule?: (action: () => void) => void
}) {
  let started: Promise<void> | undefined
  const schedule = options.schedule ?? (action => { setTimeout(action, 30_000).unref() })
  const retry = (action: () => Promise<void>) => schedule(() => { void action() })
  async function restore(job: ProfileJob) {
    if (options.isActive(job.jobId)) return
    try {
      const recovered = await options.recover(job)
      if (recovered.status !== 'verifying') return
      if (await options.resume(recovered)) return
    } catch (error) {
      options.logger.event('verification_recovery', 'failed', profileErrorDetails(error))
    }
    retry(() => restore(job))
  }
  async function scan() {
    try {
      const pending = (await options.list()).filter(canRecoverVerification)
      options.logger.event('verification_recovery_scan', 'succeeded', { stepCount: pending.length })
      for (const job of pending) await restore(job)
    } catch (error) {
      options.logger.event('verification_recovery_scan', 'failed', profileErrorDetails(error))
      retry(scan)
    }
  }
  return { start: () => started ??= scan() }
}
