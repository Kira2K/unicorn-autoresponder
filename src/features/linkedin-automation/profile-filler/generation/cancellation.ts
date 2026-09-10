import { setTimeout as sleep } from 'node:timers/promises'
import { codedError } from '../errors.ts'
import type { ProfileJob } from '../job-types.ts'
import type { ProfileClient } from '../plan-types.ts'

export const GENERATION_STOPPED = 'profile_generation_stopped'
export const PREPARATION_STATUSES = new Set([
  'generating_cv', 'generating_profile', 'validating', 'previewing', 'retrying', 'waiting_retry'
])
const controls = new WeakMap<ProfileJob, AbortController>()
export function preparationSignal(job: ProfileJob) {
  let control = controls.get(job)
  if (!control) { control = new AbortController(); controls.set(job, control) }
  return control.signal
}
export function checkPreparation(job: ProfileJob) {
  if (job.errorCode === GENERATION_STOPPED || controls.get(job)?.signal.aborted) {
    throw codedError(GENERATION_STOPPED, 'Подготовка остановлена пользователем.')
  }
}
export function cancelPreparation(job: ProfileJob) {
  const active = controls.has(job)
  controls.get(job)?.abort()
  job.errorCode = GENERATION_STOPPED
  return active
}
export function releasePreparation(job: ProfileJob) { controls.delete(job) }
export async function preparationCall<T>(job: ProfileJob, action: () => T | Promise<T>): Promise<T> {
  preparationSignal(job)
  checkPreparation(job)
  try { return await action() }
  finally { checkPreparation(job) }
}
export async function preparationWait(job: ProfileJob, milliseconds: number,
  wait?: (milliseconds: number) => Promise<void>) {
  return preparationCall(job, () => wait ? wait(milliseconds) :
    sleep(milliseconds, undefined, { signal: preparationSignal(job) }).then(() => undefined))
}
export function preparationClient(job: ProfileJob, client: ProfileClient): ProfileClient {
  return {
    getAccount: id => preparationCall(job, () => client.getAccount(id)),
    getOwnProfile: (id, sections, options) => preparationCall(job, () => client.getOwnProfile(id, sections, options)),
    searchParameters: (id, type, keywords) => preparationCall(job, () => client.searchParameters(id, type, keywords)),
    updateOwnProfile: () => Promise.reject(codedError('profile_preparation_write_forbidden',
      'Подготовка Preview не может изменять LinkedIn.'))
  }
}
export function stoppedPhase(job: ProfileJob, fallback: string) {
  return job.errorCode === GENERATION_STOPPED || controls.get(job)?.signal.aborted
    ? 'generation_stopped' : fallback
}
