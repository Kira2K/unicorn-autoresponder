import { computed, onUnmounted, ref } from 'vue'
import { api } from './api'
import { useProfileDraft } from './use-profile-draft'

const TERMINAL = new Set([
  'preview_ready', 'pending_verification', 'succeeded', 'failed', 'needs_expert_review'
])

export function useProfileFiller() {
  const visible = ref(false)
  const account = ref(null)
  const job = ref(null)
  const history = ref([])
  const error = ref('')
  const draft = useProfileDraft()
  let timer
  let historyRequest = Promise.resolve()
  const active = computed(() => ['previewing', 'running'].includes(job.value?.status))
  const blockingIssues = computed(() =>
    Boolean(job.value?.preview?.issues?.some(item => item.level === 'fatal')))

  async function loadHistory() {
    try {
      const response = await api.adminProfileJobs()
      history.value = response.jobs.filter(item =>
        item.platformAccountId === account.value?.platformAccountId)
    } catch (caught) { error.value = caught.message || 'Could not load Profile Filler history.' }
  }

  function open(selected) {
    account.value = selected; job.value = null; history.value = []; error.value = ''
    draft.reset(); visible.value = true; historyRequest = loadHistory()
  }

  async function selectFile(file) {
    error.value = ''; job.value = null
    try { await draft.load(file) }
    catch (caught) { draft.reset(); error.value = caught.message || 'Could not analyze the selected file.' }
  }
  function chooseFile(event) {
    void selectFile(event.target.files?.[0]); event.target.value = ''
  }
  function dropFile(event) { event.preventDefault(); void selectFile(event.dataTransfer?.files?.[0]) }
  function close() { if (!active.value) visible.value = false }

  async function poll(jobId) {
    try {
      job.value = await api.adminProfileJob(jobId)
      draft.syncPreview(job.value.preview)
      if (!TERMINAL.has(job.value.status)) timer = setTimeout(() => poll(jobId), 1000)
      else await loadHistory()
    } catch (caught) { error.value = caught.message || 'Could not refresh Profile Filler.' }
  }

  async function preview() {
    error.value = ''
    if (!draft.document.value) { error.value = 'Choose a profile JSON file first.'; return }
    try {
      const analysis = await draft.analyze()
      if (!analysis.valid) { error.value = 'Fix the blocking fields shown below.'; return }
      await historyRequest
      job.value = await api.startAdminProfilePreview(account.value.platformAccountId, draft.document.value)
      void poll(job.value.jobId)
    } catch (caught) { error.value = caught.message || 'Could not create preview.' }
  }

  async function apply() {
    if (draft.dirty.value) { error.value = 'Rebuild Preview before Apply.'; return }
    if (!window.confirm('Apply this exact preview to LinkedIn?')) return
    error.value = ''
    try {
      job.value = await api.applyAdminProfileJob(job.value.jobId, job.value.planHash)
      void poll(job.value.jobId)
    } catch (caught) { error.value = caught.message || 'Could not apply Profile Filler.' }
  }

  async function resolveIssues(fixes) {
    draft.fix(fixes)
    await preview()
  }

  function showHistory(item) { job.value = item; error.value = ''; draft.syncPreview(item.preview) }
  async function rollback() {
    if (!window.confirm('Restore the values saved before this change?')) return
    error.value = ''
    try {
      job.value = await api.rollbackAdminProfileJob(job.value.jobId); void poll(job.value.jobId)
    } catch (caught) { error.value = caught.message || 'Could not roll back Profile Filler.' }
  }

  onUnmounted(() => clearTimeout(timer))
  return { account, active, apply, blockingIssues, chooseFile, close,
    draft: draft.document, dirty: draft.dirty,
    dropFile, error, history, issues: draft.issues, job, open, preview, retryPreview: preview,
    resolveIssues, rollback, selectedFile: draft.selectedFile, showHistory, updateDraft: draft.update,
    validDraft: draft.valid, visible }
}
