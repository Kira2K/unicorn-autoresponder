import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { latestConnectionRun } from './connection-inviter-view'

export function useConnectionInviter() {
  const runs = ref([])
  const stacks = ref([])
  const readiness = ref({})
  const history = ref({})
  const errors = ref({})
  const loading = ref({})
  const stackDrafts = ref({})
  const timers = new Map()
  const active = computed(() => runs.value.some(run => run.status === 'running'))
  const runFor = account => latestConnectionRun(runs.value, account.platformAccountId)
  const stackFor = account => readiness.value[account.platformAccountId]?.stack || account.primaryStack || ''

  async function load() {
    try {
      const [runResponse, stackResponse] = await Promise.all([
        api.adminConnectionRuns(), api.adminConnectionStacks()
      ])
      runs.value = runResponse.runs || []; stacks.value = stackResponse.stacks || []
      if (errors.value.page) errors.value = { ...errors.value, page: '' }
    } catch (error) { errors.value = { ...errors.value, page: error.message } }
  }

  async function ensure(account) {
    const id = account.platformAccountId
    if (readiness.value[id]) return
    try {
      const result = await api.adminConnectionReadiness(id)
      readiness.value = { ...readiness.value, [id]: result }
      if (result.stackId) stackDrafts.value = { ...stackDrafts.value, [id]: result.stackId }
    } catch (error) { errors.value = { ...errors.value, [id]: error.message } }
  }

  async function poll(account, runId) {
    try {
      const run = await api.adminConnectionRun(runId)
      runs.value = [run, ...runs.value.filter(row => row.runId !== run.runId)]
      if (run.status === 'running') timers.set(runId, setTimeout(() => poll(account, runId), 1000))
      else {
        timers.delete(runId)
        history.value = { ...history.value,
          [account.platformAccountId]: (await api.adminConnectionHistory(account.platformAccountId)).items || [] }
      }
    } catch (error) {
      timers.delete(runId); errors.value = { ...errors.value, [account.platformAccountId]: error.message }
    }
  }

  async function start(account, safeRecruiterOnly = false) {
    const id = account.platformAccountId
    const mode = safeRecruiterOnly ? 'recruiters only' : 'the planned 70/30 mix'
    if (!window.confirm(`Send today's LinkedIn connection quota for ${account.clientName} (${mode})?`)) return
    loading.value = { ...loading.value, [id]: true }; errors.value = { ...errors.value, [id]: '' }
    try {
      const run = await api.startAdminConnectionRun(id, safeRecruiterOnly)
      runs.value = [run, ...runs.value.filter(row => row.runId !== run.runId)]
      if (run.status === 'running') void poll(account, run.runId)
      else history.value = { ...history.value,
        [id]: (await api.adminConnectionHistory(id)).items || [] }
    } catch (error) { errors.value = { ...errors.value, [id]: error.message || 'Connection run failed.' } }
    finally { loading.value = { ...loading.value, [id]: false } }
  }

  async function saveStack(account) {
    const id = account.platformAccountId; const stackId = Number(stackDrafts.value[id])
    if (!stackId) return
    loading.value = { ...loading.value, [id]: true }; errors.value = { ...errors.value, [id]: '' }
    try {
      const result = await api.saveAdminConnectionStack(id, stackId)
      readiness.value = { ...readiness.value, [id]: result }
      await start(account, false)
    } catch (error) { errors.value = { ...errors.value, [id]: error.message }
    } finally { loading.value = { ...loading.value, [id]: false } }
  }

  onMounted(load)
  onUnmounted(() => { for (const timer of timers.values()) clearTimeout(timer) })
  return { active, ensure, errors, history, loading, load, readiness, runFor, runs, saveStack,
    stackDrafts, stackFor, stacks, start }
}
