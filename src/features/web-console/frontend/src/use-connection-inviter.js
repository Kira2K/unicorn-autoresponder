import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { stopAdminConnectionRun } from './connection-inviter-api'
import { connectionRunConfirmation, connectionStopConfirmation, connectionPauseFromError,
  latestConnectionRun } from './connection-inviter-view'

const EVENT_TYPES = ['snapshot', 'stage_changed', 'progress', 'timer_started', 'retry_scheduled',
  'retry_succeeded', 'invitation_sent', 'paused', 'stopped', 'partial', 'completed', 'uncertain']

export function useConnectionInviter() {
  const runs = ref([])
  const stacks = ref([])
  const readiness = ref({})
  const history = ref({})
  const errors = ref({})
  const loading = ref({})
  const pauses = ref({})
  const stackDrafts = ref({})
  const clock = ref(Date.now())
  const streams = new Map()
  const fallbackTimers = new Map()
  let readinessQueue = Promise.resolve()
  let clockTimer
  let destroyed = false
  const active = computed(() => runs.value.some(run => run.status === 'running'))
  const runFor = account => latestConnectionRun(runs.value, account.platformAccountId)
  const stackFor = account => readiness.value[account.platformAccountId]?.stack || account.primaryStack || ''
  const countdownFor = run => run?.nextActionAt ? Math.max(0, Date.parse(run.nextActionAt) - clock.value) : 0

  function upsertRun(run) {
    if (!run?.runId) return
    runs.value = [run, ...runs.value.filter(row => row.runId !== run.runId)]
  }

  function closeStream(runId) {
    streams.get(runId)?.close(); streams.delete(runId)
    clearTimeout(fallbackTimers.get(runId)); fallbackTimers.delete(runId)
  }

  async function refreshHistory(account) {
    history.value = { ...history.value,
      [account.platformAccountId]: (await api.adminConnectionHistory(account.platformAccountId)).items || [] }
  }

  async function fallback(account, runId) {
    try {
      const run = await api.adminConnectionRun(runId); upsertRun(run)
      if (run.status !== 'running') { closeStream(runId); await refreshHistory(account); return }
    } catch (error) {
      errors.value = { ...errors.value, [account.platformAccountId]: error.message }
    }
    fallbackTimers.set(runId, setTimeout(() => connect(account, runId), 15_000))
  }

  function connect(account, runId) {
    closeStream(runId)
    if (typeof EventSource === 'undefined') { void fallback(account, runId); return }
    const source = new EventSource(`/api/admin/linkedin/connection-runs/${encodeURIComponent(runId)}/events`,
      { withCredentials: true })
    streams.set(runId, source)
    const receive = event => {
      try {
        const payload = JSON.parse(event.data); const run = payload.run || payload?.run
        upsertRun(run)
        if (run?.status !== 'running') { closeStream(runId); void refreshHistory(account) }
      } catch { /* A malformed event is ignored; reconnect snapshot remains authoritative. */ }
    }
    for (const type of EVENT_TYPES) source.addEventListener(type, receive)
    source.onerror = () => {
      if (destroyed) return
      closeStream(runId); void fallback(account, runId)
    }
  }

  async function load() {
    try {
      const [runResponse, stackResponse] = await Promise.all([
        api.adminConnectionRuns(), api.adminConnectionStacks()
      ])
      runs.value = runResponse.runs || []; stacks.value = stackResponse.stacks || []
      if (errors.value.page) errors.value = { ...errors.value, page: '' }
    } catch (error) { errors.value = { ...errors.value, page: error.message } }
  }

  function ensure(account) {
    const id = account.platformAccountId
    const run = runFor(account)
    if (run?.status !== 'running' && Number(run?.counters?.sent || 0) > 0 &&
      history.value[id] === undefined) {
      void refreshHistory(account).catch(error => {
        errors.value = { ...errors.value, [id]: error.message }
      })
    }
    if (run?.status === 'running' && !streams.has(run.runId) && !fallbackTimers.has(run.runId)) {
      connect(account, run.runId)
    }
    if (readiness.value[id]) return
    const verified = account.unipileAccountId && account.unipileAccountStatus === 'running' &&
      account.lastVerifiedAt
    if (!verified) return
    readinessQueue = readinessQueue.then(async () => {
      if (readiness.value[id]) return
      try {
        const result = await api.adminConnectionReadiness(id)
        readiness.value = { ...readiness.value, [id]: result }
        if (result.stackId) stackDrafts.value = { ...stackDrafts.value, [id]: result.stackId }
      } catch (error) { errors.value = { ...errors.value, [id]: error.message } }
    })
    return readinessQueue
  }

  async function start(account, safeRecruiterOnly = false) {
    const id = account.platformAccountId
    if (!window.confirm(connectionRunConfirmation(account, runFor(account), safeRecruiterOnly))) return
    loading.value = { ...loading.value, [id]: true }; errors.value = { ...errors.value, [id]: '' }
    try {
      const run = await api.startAdminConnectionRun(id, safeRecruiterOnly)
      pauses.value = { ...pauses.value, [id]: null }; upsertRun(run)
      if (run.status === 'running') connect(account, run.runId)
      else await refreshHistory(account)
    } catch (error) {
      const pause = connectionPauseFromError(error)
      if (pause) pauses.value = { ...pauses.value, [id]: pause }
      else errors.value = { ...errors.value, [id]: error.message || 'Connection run failed.' }
    } finally { loading.value = { ...loading.value, [id]: false } }
  }

  async function stop(account) {
    const id = account.platformAccountId; const run = runFor(account)
    if (!run || !window.confirm(connectionStopConfirmation(account))) return
    loading.value = { ...loading.value, [id]: true }; errors.value = { ...errors.value, [id]: '' }
    try {
      const stopped = await stopAdminConnectionRun(run.runId); upsertRun(stopped)
      if (stopped.status === 'running') connect(account, stopped.runId)
    } catch (error) { errors.value = { ...errors.value, [id]: error.message || 'Stop failed.' }
    } finally { loading.value = { ...loading.value, [id]: false } }
  }

  async function saveStack(account) {
    const id = account.platformAccountId; const stackId = Number(stackDrafts.value[id])
    if (!stackId) return
    loading.value = { ...loading.value, [id]: true }; errors.value = { ...errors.value, [id]: '' }
    try {
      const result = await api.saveAdminConnectionStack(id, stackId)
      readiness.value = { ...readiness.value, [id]: result }; await start(account, false)
    } catch (error) { errors.value = { ...errors.value, [id]: error.message }
    } finally { loading.value = { ...loading.value, [id]: false } }
  }

  function destroy() {
    destroyed = true
    for (const runId of [...streams.keys(), ...fallbackTimers.keys()]) closeStream(runId)
  }

  onMounted(() => {
    window.addEventListener('pagehide', destroy)
    clockTimer = setInterval(() => { clock.value = Date.now() }, 1000); void load()
  })
  onUnmounted(() => {
    window.removeEventListener('pagehide', destroy); destroy()
    clearInterval(clockTimer)
  })
  return { active, connect, countdownFor, ensure, errors, history, loading, load, pauses, readiness, runFor,
    runs, saveStack, stackDrafts, stackFor, stacks, start, stop }
}
