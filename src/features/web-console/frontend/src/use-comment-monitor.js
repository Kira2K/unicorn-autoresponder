import { onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { latestForAccount, monitorActive } from './comment-monitor-view'

export function useCommentMonitor() {
  const jobs = ref([])
  const errors = ref({})
  const loading = ref({})
  const now = ref(Date.now())
  let pollTimer
  let clockTimer
  async function load() {
    try {
      jobs.value = (await api.adminCommentMonitors()).jobs || []
      if (errors.value.page) errors.value = { ...errors.value, page: '' }
    }
    catch (error) { errors.value = { ...errors.value, page: error.message } }
  }
  const jobFor = account => latestForAccount(jobs.value, account.platformAccountId)
  async function toggle(account) {
    const id = account.platformAccountId
    const current = jobFor(account)
    const enabled = !monitorActive(current)
    if (enabled && !window.confirm(`Enable automatic LinkedIn replies for ${account.clientName} for 48 hours?`)) return
    loading.value = { ...loading.value, [id]: true }
    errors.value = { ...errors.value, [id]: '' }
    try {
      const job = await api.setAdminCommentMonitor(id, enabled)
      jobs.value = [job, ...jobs.value.filter(row => row.jobId !== job.jobId)]
      await load()
    } catch (error) { errors.value = { ...errors.value, [id]: error.message || 'Comment monitor failed.' } }
    finally { loading.value = { ...loading.value, [id]: false } }
  }
  async function resume(job) {
    loading.value = { ...loading.value, [job.platformAccountId]: true }
    try { await api.resumeAdminCommentMonitor(job.jobId); await load() }
    catch (error) { errors.value = { ...errors.value, [job.platformAccountId]: error.message } }
    finally { loading.value = { ...loading.value, [job.platformAccountId]: false } }
  }
  onMounted(() => {
    void load(); pollTimer = setInterval(load, 5000)
    clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
  })
  onUnmounted(() => { clearInterval(pollTimer); clearInterval(clockTimer) })
  return { errors, jobFor, jobs, loading, now, resume, toggle }
}
