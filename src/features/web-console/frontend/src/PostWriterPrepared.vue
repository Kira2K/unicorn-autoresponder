<script setup>
import { computed, ref, watch } from 'vue'
import PostWriterPublishNow from './PostWriterPublishNow.vue'
import { runActive, stages } from './post-writer-view'
const props = defineProps({ modelValue: Array, disabled: Boolean, runs: Array, dirty: Boolean,
  memesAvailable: Boolean, clientName: String })
const emit = defineEmits(['update:modelValue', 'publish'])
const day = 86400000, selected = ref(0), clearing = ref(false)
function monday(date) {
  const at = Date.parse(`${date}T12:00:00Z`)
  return new Date(at - ((new Date(at).getUTCDay() || 7) - 1) * day).toISOString().slice(0, 10)
}
const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)
const week = ref(monday(props.modelValue?.[0]?.date ?? today))
watch(() => props.modelValue?.[0]?.date, date => { if (date) week.value = monday(date) })
const dates = computed(() => Array.from({ length: 7 }, (_, index) =>
  new Date(Date.parse(`${week.value}T12:00:00Z`) + index * day).toISOString().slice(0, 10)))
watch(week, () => { selected.value = Math.max(0, dates.value.findIndex(date => date >= today)) }, { immediate: true })
const value = date => props.modelValue?.find(item => item.date === date)?.text ?? ''
const started = date => props.runs?.find(run => run.preparedPost?.date === date ||
  (run.trigger === 'scheduled' && run.id.endsWith(`-${date}`)))
const post = computed(() => ({ date: dates.value[selected.value], text: value(dates.value[selected.value]) }))
const blocked = computed(() => started(post.value.date) ? 'Задание для этого дня уже создано. Результат — в истории.' :
  post.value.date < today ? 'Дата уже прошла. Выберите сегодняшний или будущий день.' :
  props.dirty ? 'Сначала сохраните изменения.' : !post.value.text.trim() ? 'Вставьте и сохраните текст.' :
  !props.memesAvailable ? 'Генерация мемов на сервере выключена.' :
  props.runs?.some(runActive) ? 'Дождитесь завершения текущего задания или остановите его.' : '')
const status = date => { const run = started(date); return run ? stages[run.status] : value(date) ? 'Есть текст' : 'Пусто' }
function change(date, text) {
  const posts = (props.modelValue ?? []).filter(item => item.date !== date)
  if (text.trim()) posts.push({ date, text })
  emit('update:modelValue', posts.sort((a, b) => a.date.localeCompare(b.date)))
}
function clearPlan() { clearing.value = false; emit('update:modelValue', []) }
</script>
<template>
  <section class="prepared-posts" data-testid="post-prepared-plan">
    <div class="week-toolbar">
      <label>Неделя · МСК <input type="date" :value="week" :disabled="disabled || Boolean(modelValue?.length)"
        data-testid="post-prepared-week" @change="($event.target.value && (week = monday($event.target.value)))" /></label>
      <Button label="Новая неделя" icon="pi pi-calendar" outlined size="small" :disabled="disabled || !modelValue?.length"
        data-testid="post-prepared-clear" @click="clearing = !clearing" />
    </div>
    <div v-if="clearing" class="clear-confirm" role="alert">
      <p>Очистить тексты плана? История и уже начатые задания останутся. Изменение применится после сохранения.</p>
      <Button label="Очистить план" severity="secondary" size="small" :disabled="disabled" @click="clearPlan" />
      <Button label="Отмена" text size="small" @click="clearing = false" />
    </div>
    <p class="plan-hint">Ваш текст остаётся без изменений. К каждому посту добавим мем. Пустые дни пропустим.</p>
    <div class="week-editor">
      <nav class="week-days" aria-label="Дни плана">
        <button v-for="(date, index) in dates" :key="date" type="button" :aria-pressed="selected === index"
          :class="{ selected: selected === index, filled: value(date) }" :data-testid="`post-prepared-day-${index + 1}`"
          @click="selected = index">
          <span><strong>{{ ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][index] }}</strong>{{ date.slice(8) }}.{{ date.slice(5, 7) }}</span>
          <small>{{ status(date) }}</small>
        </button>
      </nav>
      <div class="day-editor">
        <div class="editor-heading"><strong>Текст на {{ post.date }}</strong><span>Мем автоматически</span></div>
        <label class="text-label" :for="`prepared-text-${selected}`">Готовый текст</label>
        <textarea :id="`prepared-text-${selected}`" :value="post.text" rows="9" :disabled="disabled || Boolean(started(post.date)) || post.date < today"
          :data-testid="`post-prepared-${selected + 1}`" placeholder="Вставьте текст поста (Ctrl+V). Абзацы и ссылки сохранятся."
          @input="change(post.date, $event.target.value)" />
        <div class="text-counter" :class="{ invalid: Array.from(post.text).length > 3000 }">{{ Array.from(post.text).length }} / 3000 знаков</div>
        <PostWriterPublishNow :post="post" :disabled="disabled" :reason="blocked" :client-name="clientName"
          @publish="emit('publish', $event)" />
      </div>
    </div>
  </section>
</template>
<style scoped src="./post-writer-prepared.css"></style>
