import { onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { automationToggleItems } from './linkedin-automation-view'

// One summary poll for the whole LinkedIn tab; journal filters never replace this snapshot.
export function useLinkedInAutomation() {
  const snapshot = ref(null), diagnostics = ref(null), error = ref(''), busy = ref(false), notice = ref('')
  let timer, disposed = false, pending = null
  function refresh() {
    if (pending || disposed) return pending
    pending = (async () => {
      try {
        const [s, d] = await Promise.all([api.linkedinAutomation(), api.linkedinAutomationDiagnostics()])
        if (!disposed) { snapshot.value = s; diagnostics.value = d; error.value = '' }
      } catch (e) { if (!disposed) error.value = e.message }
      finally { pending = null }
    })()
    return pending
  }
  async function save(items) {
    if (busy.value) return []
    busy.value = true; notice.value = ''; error.value = ''
    try {
      const results = await api.linkedinAutomationBulk(items)
      notice.value = `Сохранено: ${results.filter(r => r.ok).length} из ${items.length}.`
      // Finish any read begun before this mutation, then fetch its confirmed state.
      if (pending) await pending
      await refresh()
      return results
    } catch (e) { error.value = e.message; throw e }
    finally { busy.value = false }
  }
  const toggle = (accounts, enabled) => save(automationToggleItems(accounts, snapshot.value?.settings || [], enabled))
  onMounted(() => { void refresh(); timer = setInterval(refresh, 15000) })
  onUnmounted(() => { disposed = true; clearInterval(timer) })
  return { snapshot, diagnostics, error, notice, busy, refresh, save, toggle }
}
