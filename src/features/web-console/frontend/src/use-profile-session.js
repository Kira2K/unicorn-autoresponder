import { computed, ref } from 'vue'
import { createProfileJobObserver } from './profile-job-observer.js'
import { isProfileActive } from './profile-workflow-view.js'
import { profileRequestError } from './profile-generation-view.js'

export function useProfileSession(api, draft) {
  const visible = ref(false)
  /** @type {import('vue').Ref<import('./profile-ui-types.ts').ProfileUiAccount | null>} */
  const account = ref(null)
  /** @type {import('vue').Ref<import('./profile-ui-types.ts').ProfileUiJob | null>} */
  const job = ref(null)
  /** @type {import('vue').Ref<import('./profile-ui-types.ts').ProfileUiJob | null>} */
  const trackedJob = ref(null)
  const history = ref([])
  const loading = ref(false)
  const error = ref('')
  const active = computed(() => isProfileActive(trackedJob.value))
  let version = 0
  let historyRequest = Promise.resolve()
  const observer = createProfileJobObserver({
    read: id => api.adminProfileJob(id),
    isTerminal: value => !isProfileActive(value),
    onValue(value) {
      trackedJob.value = value
      if (job.value?.jobId === value.jobId) {
        job.value = value
        if (!draft.dirty.value) draft.syncPreview(value.preview)
      }
      history.value = [value, ...history.value.filter(item => item.jobId !== value.jobId)]
      error.value = ''
    },
    onTerminal: () => loadHistory(),
    onError: caught => { error.value = profileRequestError(caught,
      'Не удалось обновить статус. Повторяем чтение; задание не остановлено.') }
  })
  async function loadHistory() {
    const token = version
    try {
      const response = await api.adminProfileJobs()
      if (token !== version) return
      history.value = response.jobs.filter(item => item.platformAccountId === account.value?.platformAccountId)
    } catch (caught) {
      if (token === version) error.value = profileRequestError(caught, 'Не удалось загрузить историю.')
    }
  }
  function observe(value) {
    trackedJob.value = value
    job.value = value
    draft.syncPreview(value.preview)
    observer.start(value.jobId)
  }
  function showHistory(value) {
    job.value = value
    draft.reset()
    draft.syncPreview(value.preview)
    if (active.value) return
    observe(value)
  }
  async function open(selected) {
    if (account.value?.platformAccountId === selected.platformAccountId) {
      visible.value = true
      if (trackedJob.value && job.value?.jobId !== trackedJob.value.jobId) {
        job.value = trackedJob.value
        draft.reset()
        draft.syncPreview(job.value.preview)
      }
      return
    }
    if (active.value) return
    version += 1
    const token = version
    observer.stop()
    account.value = selected
    job.value = null
    trackedJob.value = null
    history.value = []
    error.value = ''
    draft.reset()
    visible.value = true
    loading.value = true
    historyRequest = loadHistory()
    await historyRequest
    if (token !== version) return
    loading.value = false
    const running = history.value.find(isProfileActive)
    if (running) observe(running)
  }
  function reset() {
    if (active.value) return
    observer.stop()
    trackedJob.value = null
    job.value = null
    error.value = ''
    draft.reset()
  }
  return { visible, account, job, trackedJob, history, loading, error, active, open, observe,
    showHistory, reset, ready: () => historyRequest, close: () => { visible.value = false },
    dispose: () => { version += 1; observer.stop() } }
}
