import { computed, onUnmounted, ref } from 'vue'
import { postApi } from './post-writer-api'
import { runActive } from './post-writer-view'

export function usePostWriter(account) {
  const visible = ref(false), data = ref(null), error = ref(''), busy = ref(false), now = ref(Date.now())
  const run = computed(() => data.value?.runs?.find(runActive) || data.value?.runs?.[0])
  let stream, polling, clock, key
  const id = account.platformAccountId
  const accept = value => { data.value = value; error.value = '' }
  const refresh = async () => accept(await postApi.get(id))
  function connect() {
    if (stream) return
    stream = new EventSource(postApi.events(id))
    const fallback = () => {
      if (!polling) polling = setInterval(() => refresh().catch(e => { error.value = e.message }), 15_000)
    }
    stream.addEventListener('snapshot', event => {
      accept(JSON.parse(event.data))
      if (polling) clearInterval(polling)
      polling = undefined
    })
    stream.addEventListener('unavailable', fallback)
    stream.onerror = fallback
    clock = setInterval(() => { now.value = Date.now() }, 1000)
  }
  async function execute(action) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try { await action(); await refresh() }
    catch (e) { error.value = e.message }
    finally { busy.value = false }
  }
  async function open() {
    visible.value = true
    await execute(refresh)
    if (data.value) connect()
  }
  onUnmounted(() => { stream?.close(); clearInterval(polling); clearInterval(clock) })
  return { visible, data, error, busy, now, run, open,
    save: settings => execute(() => postApi.settings(id, settings)),
    start: input => execute(async () => {
      key ??= crypto.randomUUID()
      await postApi.start(id, input.mode, key, input)
      key = undefined
    }),
    action: (item, action, reviewed) => execute(() => postApi.action(item, action, reviewed))
  }
}
