<script setup>
import { computed, ref, watch } from 'vue'
import { api } from './api'
import { apiError, featureNames, weekDays, scheduleDraft, schedulePayload, scheduleError, dateMsk } from './linkedin-automation-view'
const props = defineProps({ accounts: Array, schedule: Object, schedules: Array, automation: Object })
const emit = defineEmits(['saved'])
const draft = ref(scheduleDraft(props.schedule)), original = ref(JSON.stringify(draft.value)), day = ref(0)
const versions = ref(Object.fromEntries(props.accounts.map(a => [a.platformAccountId, props.schedules.find(s => s.account.id === a.platformAccountId)?.version ?? 0])))
const error = ref(''), results = ref([]), preview = ref(null), previewBusy = ref(false), confirm = ref(false), copying = ref(false), copyDays = ref([])
const dirty = computed(() => JSON.stringify(draft.value) !== original.value)
const invalid = computed(() => scheduleError(draft.value))
const conflict = computed(() => props.accounts.length === 1 && (props.schedule?.version ?? 0) !== draft.value.version)
const locked = computed(() => props.automation.busy.value || !props.automation.writable.value)
const slots = computed(() => draft.value.slots.filter(s => s.day === day.value))
const bulk = computed(() => props.accounts.length > 1)
const hasPosts = computed(() => draft.value.slots.some(s => s.features.includes('posts')))
const postMode = computed({ get: () => draft.value.postPolicy?.contentMode ?? '', set: contentMode => {
  draft.value.postPolicy = { contentMode, generateIfMissing: draft.value.postPolicy?.generateIfMissing ?? true }
} })
const postChoiceMissing = computed(() => hasPosts.value && draft.value.enabled && !postMode.value)
watch(() => props.schedule?.version, () => { if (!dirty.value) reset() })
watch(draft, () => { confirm.value = false; preview.value = null; error.value = ''; results.value = [] }, { deep: true })
function reset() {
  draft.value = scheduleDraft(props.schedule); original.value = JSON.stringify(draft.value); error.value = ''; results.value = []
  versions.value = Object.fromEntries(props.accounts.map(a => [a.platformAccountId, props.schedules.find(s => s.account.id === a.platformAccountId)?.version ?? 0]))
}
function add() { draft.value.slots.push({ id: crypto.randomUUID(), day: day.value, start: '10:00', end: '15:00', features: ['invitations'] }) }
function copy() {
  const targets = new Set(copyDays.value)
  draft.value.slots = [...draft.value.slots.filter(s => !targets.has(s.day)), ...copyDays.value.flatMap(target => slots.value.map(s =>
    ({ ...s, day: target, id: crypto.randomUUID(), features: [...s.features] })))]
  copying.value = false; copyDays.value = []
}
async function save(clear = false) {
  error.value = ''; confirm.value = false
  try {
    if (!clear && postChoiceMissing.value) throw new Error('Выберите, откуда брать посты.')
    const payload = schedulePayload(clear ? { ...draft.value, enabled: false, slots: [] } : draft.value)
    if (bulk.value) {
      const response = await props.automation.apply({ ...payload, accounts: props.accounts.map(a => ({ id: a.platformAccountId,
        version: versions.value[a.platformAccountId] })) })
      results.value = (response?.results ?? []).map(r => ({ ...r, name: props.accounts.find(a => a.platformAccountId === r.id)?.clientName,
        message: r.ok ? 'Сохранено' : apiError({ body: r }) }))
      for (const r of results.value) if (r.ok) versions.value[r.id] = r.schedule.version
      if (results.value.length && results.value.every(r => r.ok)) original.value = JSON.stringify(draft.value)
    } else {
      const response = await props.automation.save(props.accounts[0].platformAccountId, payload)
      draft.value = scheduleDraft(response); original.value = JSON.stringify(draft.value)
      // Set feedback after the deep watcher has settled.
      emit('saved', response)
    }
  } catch (caught) { error.value = apiError(caught) }
}
async function showPreview() {
  previewBusy.value = true; error.value = ''
  try { preview.value = await api.previewLinkedInSchedule({ ...schedulePayload(draft.value), accountId: props.accounts[0].platformAccountId }) }
  catch (caught) { error.value = apiError(caught) }
  finally { previewBusy.value = false }
}
defineExpose({ dirty })
</script>
<template>
  <section class="calendar" data-testid="automation-calendar">
    <p>Каждую неделю · время МСК</p>
    <p v-if="bulk">Новое расписание заменит расписания {{ accounts.length }} выбранных учеников. После сохранения их можно менять отдельно.</p>
    <label class="check"><input v-model="draft.enabled" type="checkbox" :disabled="locked" data-testid="automation-enabled" /> Автоматизация включена</label>
    <fieldset v-if="hasPosts" class="slot" :disabled="locked" data-testid="automation-post-policy">
      <legend>Откуда брать посты</legend>
      <select v-model="postMode" aria-label="Источник постов" data-testid="automation-post-source">
        <option disabled value="">Выберите источник</option>
        <option value="generated">Генерировать из CV, а без CV — по стеку</option>
        <option value="prepared">Брать готовый текст на дату</option>
      </select>
      <label v-if="postMode === 'prepared'" class="check"><input v-model="draft.postPolicy.generateIfMissing" type="checkbox"
        data-testid="automation-post-fallback" /> Если текста на сегодня нет — сгенерировать</label>
      <small>Один пост в сутки. Подготовленные тексты и история сохраняются.</small>
      <p v-if="postChoiceMissing" class="error">Перед включением выберите источник постов.</p>
    </fieldset>
    <nav class="days" aria-label="День недели">
      <button v-for="(name, i) in weekDays" :key="name" :aria-pressed="day === i" :class="{ chosen: day === i }"
        :data-testid="`automation-day-${i}`" @click="day = i">{{ name }}<small>{{ draft.slots.filter(s => s.day === i).length }}</small></button>
    </nav>
    <p v-if="!slots.length" class="muted">На этот день ничего не запланировано.</p>
    <fieldset v-for="slot in slots" :key="slot.id" :disabled="locked" class="slot" data-testid="automation-slot">
      <legend>Интервал · {{ weekDays[day] }}</legend>
      <div class="times">
        <label>С <input v-model="slot.start" type="text" inputmode="numeric" placeholder="10:00" maxlength="5" aria-label="С" data-testid="automation-start" /></label>
        <label>До <input v-model="slot.end" type="text" inputmode="numeric" placeholder="15:00" maxlength="5" aria-label="До" data-testid="automation-end" /></label>
      </div>
      <div class="features"><label v-for="feature in ['invitations', 'posts', 'comments', 'withdrawals']" :key="feature" class="check">
        <input v-model="slot.features" type="checkbox" :value="feature" :data-testid="`automation-feature-${feature}`" /> {{ featureNames[feature] }}</label></div>
      <button class="text-button" @click="draft.slots = draft.slots.filter(s => s.id !== slot.id)">Удалить интервал</button>
    </fieldset>
    <div class="buttons"><Button label="Добавить интервал" size="small" outlined :disabled="locked || draft.slots.length >= 70" @click="add" data-testid="automation-add" />
      <Button label="Копировать день" size="small" text :disabled="locked || !slots.length" @click="copying = !copying" /></div>
    <section v-if="copying" class="copy-box">
      <p>Выберите дни. Их прежние интервалы будут заменены.</p>
      <label v-for="(name, i) in weekDays" :key="name" class="check"><input v-model="copyDays" type="checkbox" :value="i" :disabled="i === day || locked" />{{ name }}</label>
      <Button label="Заменить выбранные дни" size="small" :disabled="!copyDays.length || locked" @click="copy" />
    </section>
    <details class="rules"><summary>Как работает расписание</summary>
      <p>Задачи начинают работу в случайное время внутри интервалов. Один аккаунт выполняет одно действие за раз; разные ученики работают параллельно.</p>
      <p>Комментарии работают во все дни с активностью и уступают другим фичам. Если включены посты, сначала ждут первую публикацию.</p>
      <p>Начатая задача может закончиться после интервала. Короткий интервал допустим; слишком затянувшуюся задачу остановит лимит времени.</p>
      <p>Выключение останавливает новые автоматические действия. Уже отправленное проверяется. Ручные задания продолжаются.</p>
      <p>Для перехода через полночь используйте два интервала: до 24:00 и с 00:00 следующего дня. Один автопост в сутки; приглашения используют прежнюю дневную норму.</p>
    </details>
    <p v-if="conflict" class="error" role="alert">Расписание изменено в другом окне. Ваш черновик сохранён здесь.
      <button class="text-button" data-testid="automation-reload-draft" @click="reset">Загрузить сохранённую версию</button></p>
    <p v-if="invalid" class="error" role="alert" data-testid="automation-validation">{{ invalid }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ul v-if="results.length" data-testid="automation-apply-results"><li v-for="r in results" :key="r.id" :class="{ error: !r.ok }">{{ r.name }} · #{{ r.id }}: {{ r.message }}</li></ul>
    <button v-if="results.some(r => !r.ok)" class="text-button" @click="reset">Загрузить актуальные версии и заполнить расписание заново</button>
    <div class="buttons">
      <Button label="Предпросмотр" outlined size="small" :loading="previewBusy" :disabled="locked || !!invalid || !draft.enabled" @click="showPreview" data-testid="automation-preview" />
      <Button :label="bulk ? 'Применить выбранным' : 'Сохранить расписание'" size="small" :loading="automation.busy.value"
        :disabled="locked || !!invalid || postChoiceMissing || conflict || (!dirty && !bulk)" @click="confirm = true" data-testid="automation-save" />
      <Button v-if="!bulk" label="Очистить расписание" size="small" severity="danger" outlined
        :disabled="locked || conflict || (!draft.enabled && !draft.slots.length)" @click="confirm = 'clear'" data-testid="automation-clear" />
    </div>
    <small>{{ dirty ? 'Есть несохранённые изменения' : 'Нет несохранённых изменений' }}</small>
    <section v-if="confirm" role="alertdialog" :aria-label="confirm === 'clear' ? 'Очистить расписание' : 'Сохранить расписание'" class="confirm" data-testid="automation-confirmation">
      <strong>{{ confirm === 'clear' ? 'Очистить расписание для:' : draft.enabled ? 'Включить расписание для:' : 'Сохранить с выключенной автоматизацией для:' }}</strong>
      <ul><li v-for="a in accounts" :key="a.platformAccountId">{{ a.clientName }} · #{{ a.platformAccountId }}</li></ul>
      <p v-if="confirm === 'clear'">Все интервалы будут удалены, автоматизация выключится. История сохранится; уже отправленные действия будут проверены.</p>
      <p v-else-if="draft.enabled">Backend сможет выполнять реальные действия. Старое расписание постов передаётся оркестратору.</p>
      <div class="buttons"><Button :label="confirm === 'clear' ? 'Очистить' : 'Подтвердить'" size="small" :disabled="locked || conflict"
        @click="save(confirm === 'clear')" data-testid="automation-confirm" />
        <Button label="Отмена" size="small" text @click="confirm = false" /></div>
    </section>
    <section v-if="preview" data-testid="automation-preview-result">
      <h4>Новые запуски на неделю</h4><p>Примерные моменты. Точный случайный старт сохраняется после включения; уже назначенные задачи — в «Состоянии».</p>
      <p v-if="!preview.tasks.length">Новых запусков нет: проверьте дни или уже созданные задачи.</p>
      <ul><li v-for="task in preview.tasks" :key="task.id">{{ dateMsk(task.plannedAt) }} · {{ featureNames[task.feature] }}</li></ul>
    </section>
  </section>
</template>
<style scoped>
.calendar { display:grid;gap:14px;font-size:.9rem; } p { margin:0;line-height:1.5; } .check { display:inline-flex;align-items:center;gap:7px; }
.days { display:grid;grid-template-columns:repeat(7,1fr);gap:4px; } .days button { border:1px solid #dbe4ed;background:white;color:inherit;border-radius:7px;padding:8px 2px;cursor:pointer; } small { display:block;color:#64748b;font-size:.8rem; } .days .chosen { background:#ecfdf5;border-color:#10b981; }
.slot { border:1px solid #dbe4ed;border-radius:9px;padding:12px;display:grid;gap:12px;min-width:0; } .times { display:flex;gap:12px; } .times label { display:grid;gap:5px;flex:1;min-width:0; } input[type=text] { width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:6px;font:inherit; }
.features,.buttons { display:flex;flex-wrap:wrap;gap:10px; } .features { flex-direction:column; } .text-button { border:0;background:none;color:#047857;text-align:left;padding:0;cursor:pointer;font:inherit; }
.copy-box,.confirm { background:#f1f5f9;border-radius:8px;padding:12px;display:grid;gap:10px; } .error { color:#b91c1c; } .muted { color:#64748b; } summary { cursor:pointer;color:#475569; } .rules p { margin-top:8px; } ul { margin:0;padding-left:20px;overflow-wrap:anywhere; }
</style>
