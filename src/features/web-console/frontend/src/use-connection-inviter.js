import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { stopAdminConnectionRun } from './connection-inviter-api'
import { connectionLocalDate, connectionPollDelay, connectionRunConfirmation, connectionStopConfirmation,
  connectionPauseFromError, connectionRunActive, latestConnectionRun } from './connection-inviter-view'

const EVENT_TYPES = ['snapshot', 'stage_changed', 'progress', 'timer_started', 'retry_scheduled',
  'retry_succeeded', 'invitation_sent', 'paused', 'stopped', 'partial', 'completed', 'uncertain']

export function useConnectionInviter() {
  const runs = ref([])
  const stacks = ref([])
  const settings = ref({ writerEnabled: false, loaded: false })
  const readiness = ref({})
  const history = ref({})
  const errors = ref({})
  const loading = ref({})
  const pauses = ref({})
  const stackDrafts = ref({})
  const clock = ref(Date.now())
  const streams = new Map()
  const fallbackTimers = new Map()
  let clockTimer
  let destroyed = false
  const active = computed(() => runs.value.some(run => connectionRunActive(run)))
  const runFor = account => latestConnectionRun(runs.value, account.platformAccountId)
  const stackFor = account => readiness.value[account.platformAccountId]?.stack || account.primaryStack || ''
  const countdownFor = run => run?.nextActionAt ? Math.max(0, Date.parse(run.nextActionAt) - clock.value) : 0

  function upsertRun(run) {
    if (!run?.runId) return
    runs.value = [run, ...runs.value.filter(row => row.runId !== run.runId)]
  }

  function setAccountError(account, message = '') {
    errors.value = { ...errors.value, [account.platformAccountId]: message }
  }

  function synchronizeRunFromHistory(run, items) {
    if (!run?.runId) return run
    const sentByAudience = { recruiter: 0, technical: 0 }
    for (const item of items) {
      if (item.runId === run.runId && ['sent', 'accepted'].includes(item.status) &&
        Object.hasOwn(sentByAudience, item.audience)) sentByAudience[item.audience] += 1
    }
    const audienceQuota = run.audienceQuota || {}
    return { ...run, counters: { ...(run.counters || {}), sentByAudience,
      sent: sentByAudience.recruiter + sentByAudience.technical,
      shortfallByAudience: {
        recruiter: Math.max(0, Number(audienceQuota.recruiter || 0) - sentByAudience.recruiter),
        technical: Math.max(0, Number(audienceQuota.technical || 0) - sentByAudience.technical)
      } } }
  }

  function closeStream(runId) {
    streams.get(runId)?.close(); streams.delete(runId)
    clearTimeout(fallbackTimers.get(runId)); fallbackTimers.delete(runId)
  }

  async function refreshHistory(account) {
    const items = (await api.adminConnectionHistory(account.platformAccountId)).items || []
    history.value = { ...history.value, [account.platformAccountId]: items }
    const current = runFor(account)
    if (current) upsertRun(synchronizeRunFromHistory(current, items))
    return items
  }

  async function loadHistory(account) {
    if (history.value[account.platformAccountId] !== undefined) return
    try { await refreshHistory(account); setAccountError(account) }
    catch (error) { setAccountError(account, error.message || 'Connection history could not be loaded.') }
  }

  async function refreshReadiness(account) {
    const id = account.platformAccountId
    const result = await api.adminConnectionReadiness(id)
    readiness.value = { ...readiness.value, [id]: result }
    if (result.stackId) stackDrafts.value = { ...stackDrafts.value, [id]: result.stackId }
    if (result.latest) upsertRun(result.latest)
    if (typeof result.writerEnabled === 'boolean') {
      settings.value = { writerEnabled: result.writerEnabled, loaded: true }
    }
    return result
  }

  async function fallback(account, runId) {
    try {
      const run = await api.adminConnectionRun(runId); upsertRun(run)
      setAccountError(account)
      if (!connectionRunActive(run)) { closeStream(runId); await refreshHistory(account); return }
    } catch (error) {
      setAccountError(account, error.message)
    }
    fallbackTimers.set(runId, setTimeout(() => connect(account, runId), connectionPollDelay()))
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
        setAccountError(account)
        if (!connectionRunActive(run)) {
          closeStream(runId)
          void refreshHistory(account).catch(error =>
            setAccountError(account, error.message || 'Connection history could not be loaded.'))
        }
      } catch { /* A malformed event is ignored; reconnect snapshot remains authoritative. */ }
    }
    for (const type of EVENT_TYPES) source.addEventListener(type, receive)
    source.onerror = () => {
      if (destroyed) return
      closeStream(runId); void fallback(account, runId)
    }
  }

  async function load() {
    const [settingsResult, dataResult] = await Promise.allSettled([
      api.adminConnectionSettings(),
      Promise.all([api.adminConnectionRuns(), api.adminConnectionStacks()])
    ])
    if (settingsResult.status === 'fulfilled') {
      settings.value = { writerEnabled: settingsResult.value.writerEnabled === true, loaded: true }
    } else {
      settings.value = { writerEnabled: false, loaded: true }
      errors.value = { ...errors.value, page: settingsResult.reason?.message ||
        'Connection Inviter settings could not be loaded.' }
    }
    if (dataResult.status === 'fulfilled') {
      const [runResponse, stackResponse] = dataResult.value
      runs.value = runResponse.runs || []; stacks.value = stackResponse.stacks || []
      if (settingsResult.status === 'fulfilled' && errors.value.page) {
        errors.value = { ...errors.value, page: '' }
      }
    } else {
      errors.value = { ...errors.value, page: dataResult.reason?.message ||
        'Connection Inviter state could not be loaded.' }
    }
  }

  function ensure(account) {
    const run = runFor(account)
    if (connectionRunActive(run) && !streams.has(run.runId) && !fallbackTimers.has(run.runId)) {
      connect(account, run.runId)
    }
  }

  async function start(account, safeRecruiterOnly = false) {
    const id = account.platformAccountId
    if (!settings.value.writerEnabled) {
      setAccountError(account, 'Connection Inviter is read-only on this backend.')
      return
    }
    loading.value = { ...loading.value, [id]: true }; setAccountError(account)
    try {
      const ready = await refreshReadiness(account)
      const items = await refreshHistory(account)
      const freshRun = synchronizeRunFromHistory(ready.latest || runFor(account), items)
      if (freshRun) upsertRun(freshRun)
      if (connectionRunActive(freshRun)) {
        connect(account, freshRun.runId)
        setAccountError(account, 'A connection run is already active for this account.')
        return
      }
      const remaining = freshRun?.localDate === connectionLocalDate()
        ? Number(freshRun?.counters?.shortfallByAudience?.recruiter || 0) +
        (safeRecruiterOnly ? 0 : Number(freshRun?.counters?.shortfallByAudience?.technical || 0)) : undefined
      if (remaining === 0 && Number(freshRun?.dailyQuota || 0) > 0) {
        setAccountError(account, 'The confirmed daily connection quota is already complete.')
        return
      }
      if (!window.confirm(connectionRunConfirmation(account, freshRun, safeRecruiterOnly))) return
      const run = await api.startAdminConnectionRun(id, safeRecruiterOnly)
      pauses.value = { ...pauses.value, [id]: null }; upsertRun(run)
      if (connectionRunActive(run)) connect(account, run.runId)
      else await refreshHistory(account)
    } catch (error) {
      const pause = connectionPauseFromError(error)
      if (pause) pauses.value = { ...pauses.value, [id]: pause }
      else setAccountError(account, error.message || 'Connection run failed.')
    } finally { loading.value = { ...loading.value, [id]: false } }
  }

  async function stop(account) {
    const id = account.platformAccountId; const run = runFor(account)
    if (!run || !window.confirm(connectionStopConfirmation(account))) return
    loading.value = { ...loading.value, [id]: true }; errors.value = { ...errors.value, [id]: '' }
    try {
      const stopped = await stopAdminConnectionRun(run.runId); upsertRun(stopped)
      if (connectionRunActive(stopped)) connect(account, stopped.runId)
      else { closeStream(stopped.runId); await refreshHistory(account) }
    } catch (error) { setAccountError(account, error.message || 'Stop failed.')
    } finally { loading.value = { ...loading.value, [id]: false } }
  }

  async function saveStack(account) {
    const id = account.platformAccountId; const stackId = Number(stackDrafts.value[id])
    if (!stackId) return
    if (!settings.value.writerEnabled) {
      setAccountError(account, 'Connection Inviter is read-only on this backend.')
      return
    }
    loading.value = { ...loading.value, [id]: true }; errors.value = { ...errors.value, [id]: '' }
    try {
      const result = await api.saveAdminConnectionStack(id, stackId)
      readiness.value = { ...readiness.value, [id]: result }; await start(account, false)
    } catch (error) { setAccountError(account, error.message)
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
  return { active, connect, countdownFor, ensure, errors, history, loadHistory, loading, load, pauses,
    readiness, runFor, runs, saveStack, settings, stackDrafts, stackFor, stacks, start, stop }
}
