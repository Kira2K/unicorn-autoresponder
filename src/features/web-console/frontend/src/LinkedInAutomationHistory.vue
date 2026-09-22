<script setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import { api } from './api'
import { automationFeatures as names, automationStates, latestRuns, timeMsk } from './linkedin-automation-view'
const props = defineProps({ accounts: Array, diagnostics: Object, initialAccount: Number, initialRun: String })
const emit = defineEmits(['student'])
const account = ref(props.initialAccount || ''), runKey = ref(props.initialRun || ''), events = ref([]), cursor = ref(), loading = ref(false), error = ref('')
const name = id => props.accounts.find(a => a.platformAccountId === id)?.clientName || `#${id}`
const runs = computed(() => latestRuns(props.diagnostics?.runs).filter(r => !account.value || r.account === Number(account.value)))
const relevant = computed(() => runs.value.filter(r => r.state !== 'planned'))
const future = computed(() => runs.value.filter(r => r.state === 'planned').sort((a, b) => a.plannedAt - b.plannedAt))
function savedExpanded() { try { return localStorage.getItem('linkedin-automation-runs-expanded') === 'true' } catch { return false } }
const runsOpened = ref(savedExpanded())
watch(runsOpened, value => { try { localStorage.setItem('linkedin-automation-runs-expanded', String(value)) } catch {} })
let requestId = 0
async function load(older = false) {
  const id = ++requestId
  loading.value = true; error.value = ''
  if (!older) { events.value = []; cursor.value = undefined }
  try {
    const result = await api.linkedinAutomationDiagnostics({ limit: 25, ...(account.value ? { account: account.value } : {}), ...(runKey.value ? { runKey: runKey.value } : {}), ...(older && cursor.value ? { before: cursor.value } : {}) })
    if (id !== requestId) return
    events.value = older ? [...events.value, ...result.events] : result.events
    cursor.value = result.events.length ? result.nextBefore : undefined
  } catch (e) { if (id === requestId) error.value = e.message }
  finally { if (id === requestId) loading.value = false }
}
function selectAccount() { runKey.value = ''; void load() }
function selectRun(key) { runKey.value = key; void load() }
watch(() => [props.initialAccount, props.initialRun], () => { account.value = props.initialAccount || ''; runKey.value = props.initialRun || ''; void load() })
onUnmounted(() => { requestId++ })
void load()
</script>
<template>
  <section class="automation-history" data-testid="automation-history">
    <div class="bar"><h3>История автозапусков</h3><button :disabled="loading" @click="load()">Обновить журнал</button></div>
    <div class="bar"><label>Ученик <select v-model="account" aria-label="Ученик в журнале" @change="selectAccount"><option value="">Все ученики</option><option v-for="a in accounts" :key="a.platformAccountId" :value="a.platformAccountId">{{ a.clientName }}</option></select></label>
      <label>Запуск <select v-model="runKey" aria-label="Запуск в журнале" @change="load()"><option value="">Все запуски</option><option v-for="r in runs" :key="r.key" :value="r.key">{{ name(r.account) }} · {{ names[r.feature] }} · {{ timeMsk(r.startedAt || r.plannedAt) }}</option></select></label></div>
    <p class="muted">События сохраняются на сервере. Время МСК. Журнал загружается по кнопке обновления.</p>
    <details><summary>Текущие и прошедшие автозапуски · {{ relevant.length }}</summary><div class="run-list"><article v-for="r in relevant" :key="r.key"><strong>{{ name(r.account) }} · {{ names[r.feature] }} · {{ automationStates[r.state] }}</strong><p>{{ r.description }}</p><small>{{ timeMsk(r.updatedAt) }}</small><small v-if="r.deadlineAt">Лимит выполнения до {{ timeMsk(r.deadlineAt) }} · МСК</small><button @click="selectRun(r.key)">Журнал этого запуска</button></article></div></details>
    <div class="bar"><h4>Будущие автозапуски · {{ future.length }}</h4><button @click="runsOpened = !runsOpened" :aria-expanded="runsOpened" aria-controls="linkedin-automation-runs" data-testid="automation-runs-collapse">{{ runsOpened ? 'Свернуть автозапуски' : 'Развернуть автозапуски' }}</button></div>
    <div v-if="runsOpened" class="run-list" id="linkedin-automation-runs"><article v-for="r in future" :key="r.key"><strong>{{ name(r.account) }} · {{ names[r.feature] }}</strong><small>{{ timeMsk(r.plannedAt) }} · {{ r.description }}</small><button @click="selectRun(r.key)">Журнал этого запуска</button></article><p v-if="!future.length">Запланированных запусков нет.</p></div>
    <div class="bar"><h3>Постоянный журнал</h3><button v-if="runKey" @click="selectRun('')">Все запуски</button></div>
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="loading" role="status">Загружаю события…</p>
    <div class="events"><article v-for="event in events" :key="event.id" :class="{ problem: event.level === 'error' }">
      <time>{{ timeMsk(event.at) }}</time><div><strong>{{ event.account ? name(event.account) : 'Исполнитель' }} · {{ names[event.feature] || '' }}</strong><p>{{ event.description }}</p>
      <details><summary>Технические подробности</summary><code>{{ event.stage }} · {{ event.code }}</code><p v-if="event.runKey"><code>{{ event.runKey }}</code></p><small v-if="Object.keys(event.details || {}).length">{{ event.details }}</small></details>
      <div class="event-actions"><button v-if="event.account" @click="emit('student', event.account)">Открыть ученика</button><button v-if="event.runKey && !runKey" @click="selectRun(event.runKey)">Только этот запуск</button></div></div>
    </article></div>
    <p v-if="!loading && !error && !events.length" class="muted">Для этого фильтра событий пока нет.</p>
    <button v-if="cursor" :disabled="loading" @click="load(true)">Показать более ранние события</button>
  </section>
</template>
<style scoped>
.automation-history{display:grid;gap:14px;min-width:0}.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.bar h3,.bar h4,p{margin:0}.bar label{display:grid;gap:5px;min-width:0;flex:1}.bar select{width:100%}button,select{font:inherit;padding:8px;border:1px solid var(--p-content-border-color);border-radius:6px;background:var(--p-content-background);color:inherit;max-width:100%}button,summary{cursor:pointer}.muted,small,time{color:var(--p-text-muted-color);font-size:13px}small{display:block;margin:6px 0}.run-list{display:grid;gap:8px;margin-top:10px}.run-list article{border-bottom:1px solid var(--p-content-border-color);padding:12px 0}.events article{display:grid;grid-template-columns:160px minmax(0,1fr);gap:16px;padding:16px 0;border-top:1px solid var(--p-content-border-color)}.events p{margin:8px 0}.events details{margin-top:8px;font-size:13px}code{overflow-wrap:anywhere}.error,.problem strong{color:var(--p-red-600)}.event-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}@media(max-width:600px){.events article{grid-template-columns:1fr;gap:6px}.bar label{flex-basis:100%}}
</style>
