import { ref, computed, onMounted, onUnmounted } from 'vue'
import { textApi } from './post-text-api'
export function usePostText(token) {
  const api = textApi(token)
  const data = ref({ authors: [], jobs: [], forbiddenTopics: [], writable: false })
  const selected = ref(''), busy = ref(false), error = ref(''), topic = ref(''), cv = ref()
  const author = ref({}), stack = ref(''), bans = ref('')
  const active = job => ['queued', 'generating', 'retrying'].includes(job.status)
  const job = computed(() => data.value.jobs.find(x => x.author === selected.value && active(x)) ||
    data.value.jobs.find(x => x.author === selected.value))
  const refresh = async () => { data.value = await api() }
  function choose(id) {
    selected.value = id
    author.value = { ...(data.value.authors.find(x => x.id === id) || { id, name: '', role: '', level: '', audience: '', style: '' }) }
    stack.value = (author.value.stack || []).join(', ')
    bans.value = (author.value.forbiddenTopics || []).join('\n')
    cv.value = undefined
  }
  let key, timer
  async function execute(fn) {
    if (busy.value) return
    busy.value = true; error.value = ''
    try { await fn(); await refresh() }
    catch (e) { error.value = e.message }
    finally { busy.value = false }
  }
  const split = text => text.split(/\n/).map(x => x.trim()).filter(Boolean)
  async function saveAuthor() {
    const saved = await api(`/authors/${selected.value}`, 'PUT', { author: { ...author.value,
      stack: stack.value.split(',').map(x => x.trim()).filter(Boolean), forbiddenTopics: split(bans.value) }, cv: cv.value })
    author.value = saved
    cv.value = undefined
  }
  onMounted(async () => {
    await execute(async () => { await refresh(); choose(data.value.authors[0]?.id || crypto.randomUUID()) })
    timer = setInterval(() => refresh().catch(e => { error.value = e.message }), 15_000)
  })
  onUnmounted(() => clearInterval(timer))
  return { data, selected, author, stack, bans, topic, cv, busy, error, job, choose,
    newAuthor: () => choose(crypto.randomUUID()), save: () => execute(saveAuthor),
    start: () => execute(async () => {
      await saveAuthor()
      key ??= crypto.randomUUID()
      await api(`/authors/${selected.value}/jobs`, 'POST', { requestKey: key, topic: topic.value })
      key = undefined
    }),
    stop: () => execute(() => api(`/jobs/${job.value.id}/stop`, 'POST')),
    savePolicy: text => execute(() => api('/policy', 'PUT', split(text))),
    refresh: () => execute(refresh), active
  }
}
