import { computed, onUnmounted, ref } from 'vue'
import { api } from './api'
import { cvUploadError } from './profile-cv-upload'
import { useProfileDraft } from './use-profile-draft'
import { profileUploadEvents } from './profile-upload-events'
import { jobElapsedSeconds, jobRetrySeconds } from './profile-job-timing'
import { useProfileSession } from './use-profile-session.js'
import { useProfileActions } from './use-profile-actions.js'

export function useProfileFiller() {
  const draft = useProfileDraft()
  const session = useProfileSession(api, draft)
  const actions = useProfileActions(api, session, draft)
  /** @type {import('vue').Ref<import('./profile-ui-types.ts').ProfileUiSource>} */
  const source = ref('drive')
  const cvFile = ref(null)
  const clock = ref(Date.now())
  const clockTimer = setInterval(() => { clock.value = Date.now() }, 1000)
  const busy = computed(() => session.active.value || actions.pending.value || session.loading.value)
  const elapsedSeconds = computed(() => jobElapsedSeconds(session.job.value, clock.value))
  const retrySeconds = computed(() => jobRetrySeconds(session.job.value, clock.value))
  const blockingIssues = computed(() => Boolean(session.job.value?.preview?.issues?.some(item => item.level === 'fatal')))
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
    source.value = cvFile.value ? 'upload' : 'drive'
  }
  async function resolveIssues(fixes) {
    if (busy.value || session.job.value?.preview?.generation) return
    draft.fix(fixes)
    await actions.preview()
  }
  function open(account) {
    if (actions.pending.value || session.loading.value) return
    if (session.account.value?.platformAccountId !== account.platformAccountId && !session.active.value) {
      source.value = 'drive'
      cvFile.value = null
    }
    void session.open(account)
  }
  const upload = profileUploadEvents(selectFile, selectCv)
  onUnmounted(() => { session.dispose(); clearInterval(clockTimer) })
  return { ...session, ...actions, ...upload, open, generate, source, cvFile, busy,
    draft: draft.document, dirty: draft.dirty, issues: draft.issues, selectedFile: draft.selectedFile,
    validDraft: draft.valid, updateDraft: draft.update, elapsedSeconds, retrySeconds, blockingIssues,
    retryPreview: actions.preview, restartGeneration, resolveIssues }
}
