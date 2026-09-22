<script setup>
import { computed, ref } from 'vue'
import { automationFeatures as names } from './linkedin-automation-view'
import { normalizeSlotTime, normalizeAutomationDraft, automationFormError } from './linkedin-automation-form'
const props = defineProps({ accounts: Array, selected: Array, automation: Object })
const emit = defineEmits(['close', 'saved'])
const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
// Freeze recipients and revisions: later selections/polls cannot redirect a save.
const targets = props.accounts.filter(a => props.selected.includes(a.platformAccountId))
const settings = props.automation.snapshot.value?.settings || []
const revisions = new Map(targets.map(a => [a.platformAccountId, settings.find(s => s.account === a.platformAccountId)?.revision || 0]))
const draft = ref(JSON.parse(JSON.stringify(settings.find(s => s.account === targets[0]?.platformAccountId) || { enabled: false, timezone: 'Europe/Moscow', slots: [] })))
const day = ref(1), results = ref([]), error = ref('')
const daySlots = computed(() => draft.value.slots.filter(s => s.day === day.value).sort((a, b) => a.start.localeCompare(b.start)))
const shortSlots = computed(() => draft.value.slots.filter(s => {
  const minutes = t => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1])
  const tasks=s.features.filter(f=>f!=='comments')
  return tasks.reduce((sum, f) => sum + (props.automation.snapshot.value?.initialReserves?.[f] || 0), 0) +
    Math.max(0,tasks.length-1)*(props.automation.snapshot.value?.minimumTaskPauseMs || 0) > (minutes(s.end) - minutes(s.start)) * 60000
}))
function add() { draft.value.slots.push({ id: crypto.randomUUID(), day: day.value, start: '10:00', end: '15:00', features: ['invitations'] }) }
function copyDay(target) {
  if (!target || Number(target) === day.value) return
  draft.value.slots.push(...daySlots.value.map(s => ({ ...s, id: crypto.randomUUID(), day: Number(target), features: [...s.features] })))
}
async function save() {
  error.value = ''; results.value = []
  try {
    draft.value = normalizeAutomationDraft(draft.value)
    results.value = await props.automation.save(targets.map(a => ({ account: a.platformAccountId, revision: revisions.get(a.platformAccountId), settings: draft.value })))
    for (const r of results.value.filter(r => r.ok)) revisions.set(r.account, props.automation.snapshot.value?.settings.find(s => s.account === r.account)?.revision ?? revisions.get(r.account))
    if (results.value.length && results.value.every(r => r.ok)) emit('saved')
  } catch (e) { error.value = automationFormError(e.message) }
}
</script>
<template>
  <section class="automation-editor" data-testid="linkedin-automation">
    <p><strong>{{ targets.map(a => a.clientName).join(', ') }}</strong></p>
    <p v-if="targets.length > 1" class="muted">Загружено расписание первого ученика. Сохранение применит его только к перечисленным ученикам.</p>
    <p class="muted">Повторяется каждую неделю · время МСК</p>
    <label class="check"><input type="checkbox" v-model="draft.enabled" :disabled="automation.busy.value"> Автоматизация включена</label>
    <div class="week"><button v-for="(label, i) in days" :key="label" :aria-pressed="day === i + 1" @click="day = i + 1">{{ label }} <small>{{ draft.slots.filter(s => s.day === i + 1).length }}</small></button></div>
    <div v-for="slot in daySlots" :key="slot.id" class="slot">
      <div class="times"><label>С <input type="time" v-model="slot.start" :disabled="automation.busy.value"></label><label>До <input v-model="slot.end" placeholder="12:00" :disabled="automation.busy.value" @blur="slot.end = normalizeSlotTime(slot.end, true) ?? slot.end"></label></div>
      <small class="muted">Можно ввести 12 — получится 12:00. Конец дня — 24:00.</small>
      <div class="features"><label v-for="(label, key) in names" :key="key" class="check"><input type="checkbox" :value="key" v-model="slot.features" :disabled="automation.busy.value">{{ label }}</label></div>
      <button :disabled="automation.busy.value" @click="draft.slots = draft.slots.filter(s => s.id !== slot.id)">Удалить слот</button>
    </div>
    <p v-if="!daySlots.length" class="muted">В этот день запусков нет.</p>
    <div class="bar"><button :disabled="automation.busy.value" @click="add">+ Добавить слот</button><label>Копировать день в <select :disabled="automation.busy.value" @change="copyDay($event.target.value); $event.target.value = ''"><option value="">Выбрать</option><option v-for="(label, i) in days" :value="i + 1" :key="label" :disabled="day === i + 1">{{ label }}</option></select></label></div>
    <p v-if="draft.slots.some(s => s.features.includes('comments'))" class="muted">Комментарии: если включены посты — запуск после первой подтверждённой публикации; без постов — при включении автоматизации. Затем монитор работает весь день, когда в расписании есть любая активность (МСК), и делает паузы для других фич. Новые посты добавляются без сброса лимитов.</p>
    <details><summary>Правила расписания</summary><p>Пересечения запрещены. Ночной интервал разделите на два дня. Комментарии работают в фоне в активные дни, без отдельного случайного времени запуска. В дни без слотов монитор на паузе.</p><p>Остальные задачи одного ученика распределяются по слоту со случайными паузами. Разные ученики работают параллельно. Несколько слотов не увеличивают дневную норму приглашений и лимит одного поста в день.</p><p>Лимит задачи — двойной резерв времени, с запасом минимум 30 минут. При превышении новые действия прекращаются. Следующая задача ждёт завершения проверки отправленного запроса и освобождения аккаунта.</p></details>
    <p v-if="shortSlots.length" class="warning">Слишком коротких слотов: {{ shortSlots.length }}. Начальный запас: приглашения — 4 ч 4 мин, пост — 49 мин, отзыв — 36 мин. Комментарии не занимают отдельный резерв слота. Фичи одного ученика выполняются последовательно.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-for="r in results" :key="r.account" :class="{ error: !r.ok }">{{ targets.find(a => a.platformAccountId === r.account)?.clientName }}: {{ r.ok ? 'сохранено' : automationFormError(r.error) }}</p>
    <div class="bar"><Button :disabled="automation.busy.value || !targets.length" :label="targets.length > 1 ? 'Сохранить для ' + targets.length + ' учеников' : 'Сохранить расписание'" @click="save" /><Button label="Отмена" severity="secondary" outlined :disabled="automation.busy.value" @click="emit('close')" /></div>
  </section>
</template>
<style scoped>
.automation-editor{display:grid;gap:14px}.automation-editor p{margin:0;line-height:1.5}.bar,.features,.check{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.bar{justify-content:space-between}.week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.week button{padding:8px 2px}.week small{display:block;color:var(--p-text-muted-color)}.week [aria-pressed=true]{background:var(--p-highlight-background);border-color:var(--p-primary-color)}.slot{padding:12px 0;display:grid;gap:12px;border-bottom:1px solid var(--p-content-border-color)}.times{display:grid;grid-template-columns:1fr 1fr;gap:10px}.times label{display:grid;gap:4px;min-width:0}input:not([type=checkbox]),select,button{font:inherit;max-width:100%;min-width:0;padding:8px;border:1px solid var(--p-content-border-color);border-radius:6px;background:var(--p-content-background);color:inherit}input[type=checkbox]{accent-color:var(--p-primary-color)}button,summary{cursor:pointer}button:disabled{opacity:.5;cursor:default}.muted,details{color:var(--p-text-muted-color);font-size:13px}.error{color:var(--p-red-600)}.warning{color:var(--p-orange-700)}
</style>
