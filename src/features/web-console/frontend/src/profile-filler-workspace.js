import { computed, shallowReactive, shallowRef } from 'vue'

// Each account owns its draft, pending request and observer, even while its dialog is closed.
/** @param {() => ReturnType<typeof import('./profile-filler-controller.js').createProfileFiller>} createSession */
export function createProfileWorkspace(createSession) {
  const sessions = shallowReactive(new Map())
  const selected = shallowRef(null)
  const busy = computed(() => [...sessions.values()].some(session => session.busy.value))
  function get(account) { return sessions.get(account.platformAccountId) }
  async function open(account) {
    let session = get(account)
    if (!session) {
      session = createSession()
      sessions.set(account.platformAccountId, session)
    }
    if (selected.value !== session) selected.value?.close()
    selected.value = session
    // Show pending progress without starting a second request for this account.
    session.visible.value = true
    await session.open(account)
  }
  function dispose() {
    for (const session of sessions.values()) session.dispose()
    sessions.clear()
    selected.value = null
  }
  return { selected, busy, get, open, dispose }
}
