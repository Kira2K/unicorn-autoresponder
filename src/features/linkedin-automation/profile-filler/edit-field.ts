import type { ProfileJob } from './job-types.ts'
import type { ProfileClient } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'
import type { MutationStore } from './mutation-persistence.ts'
import { publicProfileJob } from './job-types.ts'
import { changeProfileField, type FieldChange } from './field-change.ts'
import { rebuildFieldPlan } from './field-plan.ts'
import { codedError, profileErrorDetails } from './errors.ts'
import { sameHash } from './job-state.ts'
import { createHash } from 'node:crypto'
import { selectField } from './field-selection.ts'

export async function editProfileField(options: {
  jobId: string; hash: string; change: FieldChange; jobs: Map<string, ProfileJob>
  client: ProfileClient; store: MutationStore & { get(id: string): Promise<ProfileJob | undefined> }
  acquire(kind: string, id: string, account: number): (() => void) | Promise<() => void>
  logger: ProfileLogger
}) {
  const { jobs, jobId, store, client, logger } = options
  const job = jobs.get(jobId) ?? await store.get(jobId)
  if (!job) throw codedError('profile_job_not_found', 'Задание не найдено.')
  if (job.status !== 'preview_ready' || !job.plan?.input || !job.planHash || job.result) {
    throw codedError('profile_job_not_ready', 'Редактирование доступно только до заполнения LinkedIn.')
  }
  if (!sameHash(job.planHash, options.hash)) throw codedError('profile_plan_hash_mismatch', 'Preview изменился. Обновите его.')
  const selection = 'enabled' in options.change ? selectField(job.plan.input, job.plan.disabledFields ?? [],
    options.change.path, options.change.enabled) : undefined
  const edit = 'value' in options.change ? changeProfileField(job.plan.input, options.change) : undefined
  const prepared = edit ?? { input: structuredClone(job.plan.input), section: selection!.section }
  const release = await options.acquire('profile_preview', jobId, job.platformAccountId)
  try {
    const latest = jobs.get(jobId) ?? job
    if (latest.status !== 'preview_ready' || latest.planHash !== options.hash) {
      throw codedError('profile_plan_hash_mismatch', 'Preview уже изменился или начал применяться.')
    }
    if (selection && JSON.stringify(selection.disabled) === JSON.stringify(job.plan.disabledFields ?? [])) {
      return publicProfileJob(job)
    }
    logger.event('field_edit', 'started', { fieldPath: options.change.path })
    const plan = await rebuildFieldPlan(client, job.plan, prepared.input, prepared.section, logger,
      selection ? '' : options.change.path, selection?.disabled)
    const previous = job.plan.fieldEdits?.find(edit => edit.path === options.change.path)
    if (edit) plan.fieldEdits = [...(job.plan.fieldEdits ?? []).filter(item => item.path !== options.change.path), {
      path: options.change.path, originalValue: previous ? previous.originalValue : edit.originalValue,
      value: edit.value, updatedAt: new Date().toISOString()
    }]
    const patch: Partial<ProfileJob> = { plan, planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
      updatedAt: new Date().toISOString() }
    try { await store.update(jobId, patch) }
    catch {
      Object.assign(job, { status: 'failed', phase: 'field_save_uncertain', errorCode: 'profile_state_persist_failed' })
      jobs.set(jobId, job)
      throw codedError('profile_state_persist_failed', 'Не удалось подтвердить сохранение правки. Apply заблокирован.')
    }
    Object.assign(job, patch)
    jobs.set(jobId, job)
    logger.event('field_edit', 'succeeded', { fieldPath: options.change.path })
    return publicProfileJob(job)
  } catch (error) {
    logger.event('field_edit', 'failed', { fieldPath: options.change.path, ...profileErrorDetails(error) })
    throw error
  } finally { release() }
}
