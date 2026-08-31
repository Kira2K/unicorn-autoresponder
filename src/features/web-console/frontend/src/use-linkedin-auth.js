import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { confirmationMessage, historyForAccounts } from './linkedin-auth-view'

export function useLinkedInAuth() {
  const accounts = ref([])
  const history = ref([])
  const runs = ref({})
  const query = ref('')
  const loading = ref(false)
  const error = ref('')
  const editors = ref({})
  const drafts = ref({})
  const saving = ref({})
  const nocoQueue = ref({ state: 'ready', waiting: 0, waitMs: 0 })
  const timers = new Map()
  const active = computed(() => Object.values(runs.value).some(run => run.status === 'running'))
  const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase()
    if (!needle) return accounts.value
    return accounts.value.filter(account => [
      account.clientName, account.linkedinUrl, account.unipileAccountId,
      account.dolphinProfileId, account.authErrorCode
    ].some(value => String(value ?? '').toLowerCase().includes(needle)))
  })
  const filteredHistory = computed(() => historyForAccounts(history.value, filtered.value))

  async function load() {
    loading.value = true
    error.value = ''
    try {
      accounts.value = (await api.adminLinkedInAccounts()).accounts || []
      history.value = (await api.adminLinkedInHistory()).runs || []
    }
    catch (caught) { error.value = caught.message || 'Could not load LinkedIn accounts.' }
    finally { loading.value = false }
  }

  async function pollNocoQueue() {
    try { nocoQueue.value = await api.adminNocoQueue() } catch {}
    timers.set('noco-queue', setTimeout(pollNocoQueue, 1000))
  }

  async function poll(platformAccountId, runId) {
    try {
      const run = await api.adminLinkedInRun(runId)
      runs.value = { ...runs.value, [platformAccountId]: run }
      if (run.status === 'running') {
        timers.set(runId, setTimeout(() => poll(platformAccountId, runId), 1000))
      } else {
        timers.delete(runId)
        await load()
      }
    } catch (caught) {
      timers.delete(runId)
      error.value = caught.message || 'Could not refresh the LinkedIn run.'
    }
  }

  async function start(account, action) {
    const confirmation = confirmationMessage(account, action)
    if (confirmation && !window.confirm(confirmation)) return
    error.value = ''
    try {
      const run = await api.startAdminLinkedInRun(account.platformAccountId, action)
      runs.value = { ...runs.value, [account.platformAccountId]: run }
      void poll(account.platformAccountId, run.runId)
    } catch (caught) { error.value = caught.message || 'Could not start LinkedIn authorization.' }
  }

  function edit(account) {
    drafts.value = { ...drafts.value, [account.platformAccountId]: account.linkedinUrl || '' }
    editors.value = { ...editors.value, [account.platformAccountId]: true }
  }

  async function save(account) {
    const id = account.platformAccountId
    saving.value = { ...saving.value, [id]: true }
    error.value = ''
    try {
      const updated = await api.updateAdminLinkedInAccount(id, { linkedinUrl: drafts.value[id] })
      accounts.value = accounts.value.map(row => row.platformAccountId === id ? updated : row)
      editors.value = { ...editors.value, [id]: false }
    } catch (caught) { error.value = caught.message || 'Could not save the LinkedIn URL.' }
    finally { saving.value = { ...saving.value, [id]: false } }
  }

  function historyAction(run, action) {
    const account = accounts.value.find(row =>
      Number(row.platformAccountId) === Number(run.platformAccountId))
    if (!account) return
    if (action === 'edit_url') edit(account)
    else void start(account, action)
  }

  onMounted(() => { void load(); void pollNocoQueue() })
  onUnmounted(() => { for (const timer of timers.values()) clearTimeout(timer) })
  return {
    accounts, active, drafts, editors, edit, error, filtered, filteredHistory, history,
    historyAction, loading, nocoQueue, query, runs, save, saving, start
  }
}
