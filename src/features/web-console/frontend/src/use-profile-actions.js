import { ref } from 'vue'
import { profileRequestError } from './profile-generation-view.js'
import { canStopProfileGeneration, canApplyProfile } from './profile-workflow-view.js'

export function useProfileActions(api, session, draft) {
  const pending = ref(false)
  /** @type {import('vue').Ref<import('./profile-ui-types.ts').ProfileUiConfirmation | null>} */
  const confirmation = ref(null)
  async function request(operation) {
    if (pending.value || session.active.value || session.loading.value) return
    pending.value = true
    session.error.value = ''
    try {
      await session.ready()
      await operation()
    } catch (caught) { session.error.value = profileRequestError(caught) }
    finally { pending.value = false }
  }
  async function preview() {
    return request(async () => {
      if (session.job.value?.preview?.generation) return
      const analysis = await draft.analyze()
      if (!analysis.valid) { session.error.value = 'Исправьте ошибки документа перед подготовкой.'; return }
      session.observe(await api.startAdminProfilePreview(session.account.value.platformAccountId, draft.document.value))
    })
  }
  function generate(file) {
    return request(async () => session.observe(
      await api.startAdminProfileGeneration(session.account.value.platformAccountId, file)))
  }
  function askConfirmation(kind) {
    const job = session.job.value
    if (pending.value || session.active.value || !job) return
    if (kind === 'apply' && (job.status !== 'preview_ready' || draft.dirty.value ||
      !canApplyProfile(job))) return
    if (kind === 'rollback' && !job.rollbackAvailable) return
    confirmation.value = { kind, jobId: job.jobId, planHash: job.planHash, job }
  }
  function confirm() {
    const selected = confirmation.value
    if (!selected) return
    return request(async () => {
      const job = session.job.value
      if (job?.jobId !== selected.jobId || job.planHash !== selected.planHash || draft.dirty.value) {
        confirmation.value = null
        session.error.value = 'План изменился. Проверьте его и подтвердите заново.'
        return
      }
      if (selected.kind === 'apply' && (job.status !== 'preview_ready' ||
        !canApplyProfile(job))) return
      if (selected.kind === 'rollback' && !job.rollbackAvailable) return
      const result = selected.kind === 'apply'
        ? await api.applyAdminProfileJob(selected.jobId, selected.planHash)
        : await api.rollbackAdminProfileJob(selected.jobId)
      confirmation.value = null
      session.observe(result)
    })
  }
  function resume() {
    return request(async () => session.observe(await api.resumeAdminProfileJob(session.job.value.jobId)))
  }
  async function stopGeneration() {
    const job = session.trackedJob?.value ?? session.job.value
    if (pending.value || !canStopProfileGeneration(job)) return
    pending.value = true
    session.error.value = ''
    try {
      const result = await api.stopAdminProfileGeneration(job.jobId)
      session.observe(result)
      session.close()
    } catch (error) { session.error.value = profileRequestError(error) }
    finally { pending.value = false }
  }
  return { pending, confirmation, request, preview, generate, resume, confirm, stopGeneration,
    apply: () => askConfirmation('apply'), rollback: () => askConfirmation('rollback') }
}
