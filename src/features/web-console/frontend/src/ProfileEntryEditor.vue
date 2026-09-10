<script setup>
const props = defineProps({
  kind: { type: String, required: true },
  entry: { type: Object, required: true }
})
const emit = defineEmits(['change'])

const experience = [
  ['company', 'Компания', 'text'], ['job_title', 'Должность', 'text'],
  ['location', 'Местоположение', 'text'], ['workplace_type', 'Формат работы', 'text'],
  ['start_date', 'Начало', 'month'],
  ['end_date', 'Окончание', 'month'], ['description', 'Описание', 'textarea']
]
const education = [
  ['school', 'Учебное заведение', 'text'], ['degree', 'Степень', 'text'],
  ['field_of_study', 'Направление', 'text'], ['start_date', 'Начало', 'month'],
  ['end_date', 'Окончание', 'month'], ['grade', 'Оценка', 'text'],
  ['activities', 'Активности', 'textarea'], ['description', 'Описание', 'textarea']
]
const fields = props.kind === 'experience' ? experience : education

function change(key, value) {
  const next = JSON.parse(JSON.stringify(props.entry))
  next.data ||= {}
  next.data[key] = value || undefined
  emit('change', next)
}

function skills(value) {
  change('skills', value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))
}
</script>

<template>
  <div class="profile-entry-editor">
    <label v-for="field in fields" :key="field[0]" :class="{ wide: field[2] === 'textarea' }">
      <span>{{ field[1] }}</span>
      <textarea v-if="field[2] === 'textarea'" :value="entry.data?.[field[0]] || ''"
        @input="change(field[0], $event.target.value)" />
      <input v-else :type="field[2]" :value="entry.data?.[field[0]] || ''"
        @input="change(field[0], $event.target.value)" />
    </label>
    <label class="wide">
      <span>Навыки (по одному в строке)</span>
      <textarea :value="(entry.data?.skills || []).join('\n')" @input="skills($event.target.value)" />
    </label>
  </div>
</template>
