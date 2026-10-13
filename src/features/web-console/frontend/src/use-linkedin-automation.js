import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { apiError } from './linkedin-automation-view'

// One status request per tab; drafts are owned by the editor and never overwritten by polling.
export function useLinkedInAutomation() {
  const status = ref({ schedules: [], tasks: [] }), error = ref(''), busy = ref(false), loadedAt = ref(0)
  const unsupported = ref(false), loading = ref(false)
  let timer, disposed = false
  const writable = computed(() => !error.value && status.value.available === true && status.value.isOwner === true)
  async function refresh() {
    if (loading.value || disposed) return
    loading.value = true
    try {
      const value = await api.linkedInAutomation()
      if (disposed) return
      status.value = value; loadedAt.value = Date.now(); error.value = ''; unsupported.value = false
    } catch (caught) {
      if (disposed) return
      unsupported.value = caught.status === 404
      error.value = unsupported.value ? 'Автоматизация не подключена на этом backend.' : apiError(caught)
    } finally { loading.value = false }
  }
  async function execute(action) {
    if (busy.value) return
    busy.value = true
    try { const result = await action(); await refresh(); return result }
    finally { busy.value = false }
  }
  async function poll() {
    await refresh()
    if (!disposed) timer = setTimeout(poll, unsupported.value ? 30_000 : 10_000)
  }
  onMounted(poll)
  onUnmounted(() => { disposed = true; clearTimeout(timer) })
  return { status, error, busy, loadedAt, unsupported, loading, writable, refresh,
    save: (id, payload) => execute(() => api.saveLinkedInSchedule(id, payload)),
    apply: payload => execute(() => api.applyLinkedInSchedule(payload)),
    resumeAll: ids => execute(async () => {
      const results = []
      for (const id of ids) {
        try { await api.resumeLinkedInAutomation(id); results.push({ id, ok: true }) }
        catch (error) { results.push({ id, ok: false, error: apiError(error) }) }
      }
      return results
    }),
    resume: id => execute(() => api.resumeLinkedInAutomation(id)) }
}
