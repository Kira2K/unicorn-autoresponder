<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({ modelValue: Array, disabled: Boolean, runs: Array })
const emit = defineEmits(['update:modelValue'])
const day = 86400000
function monday(date) {
  const at = Date.parse(`${date}T12:00:00Z`)
  return new Date(at - ((new Date(at).getUTCDay() || 7) - 1) * day).toISOString().slice(0, 10)
}
const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)
const week = ref(monday(props.modelValue?.[0]?.date ?? today))
watch(() => props.modelValue?.[0]?.date, date => { if (date) week.value = monday(date) })
const dates = computed(() => Array.from({ length: 7 }, (_, index) =>
  new Date(Date.parse(`${week.value}T12:00:00Z`) + index * day).toISOString().slice(0, 10)))
const value = date => props.modelValue?.find(item => item.date === date)?.text ?? ''
const started = date => props.runs?.some(run => run.trigger === 'scheduled' && run.id.endsWith(`-${date}`))
function change(date, text) {
  const posts = (props.modelValue ?? []).filter(item => item.date !== date)
  if (text.trim()) posts.push({ date, text })
  emit('update:modelValue', posts.sort((a, b) => a.date.localeCompare(b.date)))
}
function clearPlan() { emit('update:modelValue', []) }
</script>
<template>
  <section class="prepared-posts" data-testid="post-prepared-plan">
    <p>Вставьте готовый текст на нужный день. Writer не меняет текст и добавляет мем.
      Пустые дни пропускаются. CV не требуется.</p>
    <label>Неделя (МСК)
      <input type="date" :value="week" :disabled="disabled || Boolean(modelValue?.length)"
        data-testid="post-prepared-week" @change="($event.target.value && (week = monday($event.target.value)))" />
    </label>
    <button type="button" :disabled="disabled || !modelValue?.length" @click="clearPlan"
      data-testid="post-prepared-clear">Очистить план для выбора другой недели</button>
    <small>Очистка применяется только после сохранения. Уже начатые задания не удаляются.</small>
    <label v-for="(date, index) in dates" :key="date">
      {{ ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][index] }} · {{ date }}
      <textarea :value="value(date)" rows="5" :disabled="disabled || started(date) || date < today"
        :data-testid="`post-prepared-${index + 1}`" placeholder="Вставьте текст (Ctrl+V)"
        @input="change(date, $event.target.value)" />
      <small>{{ Array.from(value(date)).length }} / 3000{{ started(date) ? ' · Задание уже начато, текст сохранён в истории' : '' }}</small>
    </label>
    <p>Публикация — без дополнительного подтверждения, в выбранный интервал.
      Сначала сохраните план. Уже начатое задание останавливается кнопкой Stop.</p>
  </section>
</template>
<style scoped>
.prepared-posts, label { display: grid; gap: .4rem; }
.prepared-posts { gap: .9rem; }
textarea { width: 100%; box-sizing: border-box; padding: .6rem; resize: vertical; }
p { margin: 0; } small { color: #526176; }
</style>
