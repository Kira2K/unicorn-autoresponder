<script setup>
import { onUnmounted, ref, watch } from 'vue'
import { api } from './api'
import { apiError, dateMsk, featureNames, isErrorEvent } from './linkedin-automation-view'
const props = defineProps({ accounts: Array, initialAccount: Number })
const account = ref(props.initialAccount || ''), source = ref(''), feature = ref(''), errorsOnly = ref(false), day = ref('')
const rows = ref([]), error = ref(''), loading = ref(false), more = ref(false), refreshed = ref(0)
let generation = 0
onUnmounted(() => generation++)
watch(() => props.initialAccount, value => { account.value = value || '' })
async function load(append = false) {
  const request = ++generation
  loading.value = true; error.value = ''
  const params = { latest: 'true', from: Date.now() - 30 * 86_400_000, ...(account.value ? { account: account.value } : {}),
    ...(source.value ? { source: source.value } : {}), ...(feature.value ? { feature: feature.value } : {}),
    ...(errorsOnly.value ? { errorsOnly: 'true' } : {}) }
  if (day.value) { params.from = Date.parse(`${day.value}T00:00:00+03:00`); params.to = params.from + 86_400_000 }
  if (append && rows.value.length) params.before = rows.value[rows.value.length - 1].id
  try {
    const response = await api.linkedInAutomationHistory(params)
    if (request !== generation) return
    rows.value = append ? [...rows.value, ...response] : response
    more.value = response.length === 200; refreshed.value = Date.now()
  } catch (caught) { if (request === generation) error.value = apiError(caught) }
  finally { if (request === generation) loading.value = false }
}
watch([account, source, feature, errorsOnly, day], () => { rows.value = []; more.value = false; void load() }, { immediate: true })
const student = id => props.accounts.find(a => a.platformAccountId === id)?.clientName || (id ? `Аккаунт #${id}` : 'Общее событие')
</script>
<template>
  <section class="journal" data-testid="automation-log">
    <div class="filters">
      <label>Ученик<select v-model="account" data-testid="automation-log-account"><option value="">Все ученики</option>
        <option v-for="a in accounts" :key="a.platformAccountId" :value="a.platformAccountId">{{ a.clientName }} · #{{ a.platformAccountId }}</option></select></label>
      <label>Фича<select v-model="feature" data-testid="automation-log-feature"><option value="">Все фичи</option><option v-for="(name, key) in featureNames" :key="key" :value="key">{{ name }}</option></select></label>
      <label>Источник<select v-model="source" data-testid="automation-log-source"><option value="">Все сервисы</option><option v-for="name in ['Unipile', 'SQL', 'Dolphin', 'OpenAI', 'наш код']" :key="name">{{ name }}</option></select></label>
      <label>День · МСК<input v-model="day" type="date" aria-label="День журнала" /></label>
      <label class="check"><input v-model="errorsOnly" type="checkbox" data-testid="automation-log-errors" />Только ошибки</label>
      <Button label="Обновить журнал" size="small" outlined :loading="loading" @click="load()" />
    </div>
    <small>История за 30 дней. Сначала новые события. Обновлено: {{ dateMsk(refreshed) }} · МСК.</small>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="!rows.length && !loading">Событий по этим условиям нет.</p>
    <details v-for="event in rows" :key="event.id" class="event" :class="{ failed: isErrorEvent(event) }" data-testid="automation-event">
      <summary><time>{{ dateMsk(event.at) }}</time><strong>{{ student(event.accountId) }}</strong>
        <span>{{ featureNames[event.feature] || event.feature || 'Оркестратор' }} · {{ event.source }}</span><span>{{ event.message }}</span></summary>
      <dl><dt>Код</dt><dd>{{ event.code }}</dd><dt v-if="event.httpStatus">HTTP</dt><dd v-if="event.httpStatus">{{ event.httpStatus }}</dd>
        <dt v-if="event.stage">Этап</dt><dd v-if="event.stage">{{ event.stage }}</dd>
        <dt v-if="event.nextAt">Следующая проверка · МСК</dt><dd v-if="event.nextAt">{{ dateMsk(event.nextAt) }}</dd>
        <dt v-if="event.taskId">Задача</dt><dd v-if="event.taskId">{{ event.taskId }}</dd>
        <dt v-if="event.runId">Прогон</dt><dd v-if="event.runId">{{ event.runId }}</dd>
        <dt v-if="event.actionId">Действие</dt><dd v-if="event.actionId">{{ event.actionId }}</dd>
        <dt v-if="event.initiator">Запуск</dt><dd v-if="event.initiator">{{ { schedule: 'По расписанию', manual: 'Вручную', recovery: 'Проверка отправленного' }[event.initiator] || event.initiator }}</dd>
        <dt v-if="event.operation">Запрос</dt><dd v-if="event.operation">{{ event.operation }}</dd>
        <dt v-if="event.requestId">ID запроса</dt><dd v-if="event.requestId">{{ event.requestId }}</dd>
        <dt v-if="event.durationMs !== undefined">Длительность</dt><dd v-if="event.durationMs !== undefined">{{ event.durationMs }} мс</dd>
        <dt v-if="event.version">Версия кода</dt><dd v-if="event.version">{{ event.version }}</dd></dl>
      <pre v-if="event.diagnostic" style="white-space:pre-wrap;overflow-wrap:anywhere">{{ event.diagnostic }}</pre>
    </details>
    <Button v-if="more" label="Показать более ранние" outlined :loading="loading" @click="load(true)" data-testid="automation-log-more" />
  </section>
</template>
<style scoped>
.journal { display:grid;gap:12px; } .filters { display:flex;flex-wrap:wrap;gap:12px;align-items:end; } label { display:grid;gap:5px;font-size:.85rem; } select,input[type=date] { max-width:240px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;color:inherit;background:white;font:inherit; } .check { display:flex;align-items:center;align-self:center; } small { color:#64748b; } .error { color:#b91c1c; } .event { border:1px solid #dbe4ed;border-radius:8px;padding:12px; } .failed { border-left:3px solid #dc2626; } summary { display:flex;flex-wrap:wrap;gap:8px 16px;cursor:pointer;list-style:revert; } summary span:last-child { width:100%; } time { color:#64748b; } dl { display:grid;grid-template-columns:auto 1fr;gap:8px;overflow-wrap:anywhere; } dt { color:#64748b; } dd { margin:0;min-width:0; }
</style>
