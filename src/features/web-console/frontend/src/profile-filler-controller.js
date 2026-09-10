import { computed, ref } from 'vue'
import { cvUploadError } from './profile-cv-upload.js'
import { useProfileDraft } from './use-profile-draft.js'
import { profileUploadEvents } from './profile-upload-events.js'
import { jobElapsedSeconds, jobRetrySeconds } from './profile-job-timing.js'
import { useProfileSession } from './use-profile-session.js'
import { useProfileActions } from './use-profile-actions.js'
import { canApplyProfile } from './profile-workflow-view.js'
import { useProfileFields } from './use-profile-fields.js'

export function createProfileFiller(api) {
  const draft = useProfileDraft(api)
  const session = useProfileSession(api, draft)
  const fields = useProfileFields(api, session)
  const dirty = computed(() => draft.dirty.value || fields.dirty.value)
  const actions = useProfileActions(api, session, { ...draft, dirty })
  /** @type {import('vue').Ref<import('./profile-ui-types.ts').ProfileUiSource>} */
  const source = ref('drive')
  const cvFile = ref(null)
  const clock = ref(Date.now())
  const clockTimer = setInterval(() => { clock.value = Date.now() }, 1000)
  const busy = computed(() => session.active.value || actions.pending.value || Boolean(fields.saving.value) || session.loading.value)
  const elapsedSeconds = computed(() => jobElapsedSeconds(session.job.value, clock.value))
  const retrySeconds = computed(() => jobRetrySeconds(session.job.value, clock.value))
  const blockingIssues = computed(() => !canApplyProfile(session.job.value))
  function selectCv(file) {
    if (busy.value) return
    const error = cvUploadError(file)
    session.error.value = error
    if (!error) { cvFile.value = file; source.value = 'upload' }
  }
  function selectFile(file) {
    return actions.request(async () => {
      try { await draft.load(file); source.value = 'json' }
      catch { session.error.value = 'Не удалось прочитать JSON. Проверьте формат и размер до 250 КБ.' }
    })
  }
  function generate() {
    if (source.value === 'upload' && !cvFile.value) {
      session.error.value = 'Выберите CV в формате PDF или DOCX.'
      return
    }
    return actions.generate(source.value === 'upload' ? cvFile.value : undefined)
  }
  function restartGeneration() {
    if (busy.value) return
    session.reset()
    fields.reset()
    source.value = cvFile.value ? 'upload' : 'drive'
  }
  async function resolveIssues(fixes) {
    if (busy.value || session.job.value?.preview?.generation) return
    draft.fix(fixes)
    await actions.preview()
  }
  function open(account) {
    if (actions.pending.value || fields.saving.value || session.loading.value) return
    if (session.account.value?.platformAccountId !== account.platformAccountId && !session.active.value) {
      source.value = 'drive'
      cvFile.value = null
    }
    return session.open(account)
  }
  function showHistory(job) {
    if (fields.saving.value || fields.dirty.value) {
      session.error.value = 'Завершите исправление полей или отмените правки перед переходом в историю.'
      return
    }
    session.showHistory(job)
  }
  const upload = profileUploadEvents(selectFile, selectCv)
  function dispose() { fields.dispose(); session.dispose(); clearInterval(clockTimer) }
  return { ...session, ...actions, ...upload, open, showHistory, generate, source, cvFile, busy,
    draft: draft.document, dirty, fields, manualDirty: draft.dirty, issues: draft.issues, selectedFile: draft.selectedFile,
    validDraft: draft.valid, updateDraft: draft.update, elapsedSeconds, retrySeconds, blockingIssues,
    retryPreview: actions.preview, restartGeneration, resolveIssues, dispose }
}
