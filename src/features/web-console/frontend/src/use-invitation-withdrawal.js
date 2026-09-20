import { computed, onMounted, onUnmounted, ref } from 'vue'
export function useInvitationWithdrawal(account) {
  const visible = ref(false), busy = ref(false), error = ref(''), preview = ref(null), run = ref(null)
  const active = computed(() => run.value?.status === 'running')
  const needsCheck = computed(() => ['uncertain', 'interrupted'].includes(run.value?.status))
  let timer, disposed = false, statusVersion = 0
  const base = `/api/admin/linkedin/accounts/${account.platformAccountId}/invitation-withdrawal`
  async function request(suffix = '', body) {
    const response = await fetch(base + suffix, { credentials: 'include', method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Не удалось выполнить запрос.')
    return result
  }
  function schedule() {
    clearTimeout(timer)
    if (!disposed && active.value) timer = setTimeout(() => void poll(), 1000)
  }
  async function poll() {
    if (busy.value || disposed) { schedule(); return }
    const version = statusVersion
    try {
      const result = await request()
      if (!disposed && version === statusVersion) { run.value = result; error.value = '' }
    }
    catch (e) { if (!disposed && version === statusVersion) error.value = e.message }
    finally { schedule() }
  }
  async function action(operation) {
    if (busy.value) return
    busy.value = true; error.value = ''; statusVersion++
    try { await operation() }
    catch (e) { error.value = e.message }
    finally { busy.value = false; schedule() }
  }
  const load = () => action(async () => { preview.value = null; preview.value = await request('/preview') })
  const open = () => { visible.value = true; return action(async () => {
    run.value = await request()
    // Opening or reloading the dialog never confirms or resumes a cancellation.
  }) }
  const start = () => {
    const count = preview.value?.items.filter(item => item.eligible).length || 0
    if (!count || !window.confirm(`Отозвать ${count} приглашений старше 14 дней у ${account.clientName}? ` +
      'Повторное приглашение этим людям может быть недоступно до трёх недель.')) return
    return action(async () => {
      run.value = await request('', { token: preview.value.token, confirm: true }); preview.value = null
    })
  }
  const stop = () => action(async () => { run.value = await request('/stop', {}) })
  const recheck = () => action(async () => {
    preview.value = null; run.value = await request('/recheck', { runId: run.value.id })
  })
  const minimize = () => { visible.value = false }
  onMounted(() => void poll())
  onUnmounted(() => { disposed = true; clearTimeout(timer) })
  return { visible, busy, error, preview, run, active, needsCheck, open, load, start, stop, recheck, minimize }
}
