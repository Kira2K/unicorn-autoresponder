<script setup>
const props = defineProps({ value: { type: Object, required: true } })
const emit = defineEmits(['change'])
const text = items => (items || []).map(item => typeof item === 'string' ? item : item.name).join('\n')

function set(key, value) {
  emit('change', { ...props.value, [key]: value || undefined })
}
function setList(key, value) {
  set(key, value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))
}
</script>

<template>
  <fieldset class="profile-open-editor">
    <legend>Готовность к работе</legend>
    <label><span>Должности</span>
      <textarea :value="text(value.job_titles)" @input="setList('job_titles', $event.target.value)" />
    </label>
    <label><span>Местоположения</span>
      <textarea :value="text(value.locations)" @input="setList('locations', $event.target.value)" />
    </label>
    <label><span>Форматы работы</span>
      <input :value="(value.workplace_types || []).join(', ')"
        @input="setList('workplace_types', $event.target.value.toUpperCase())" />
    </label>
    <label><span>Типы занятости</span>
      <input :value="(value.employment_types || []).join(', ')"
        @input="setList('employment_types', $event.target.value.toUpperCase())" />
    </label>
    <label><span>Начало работы</span>
      <select :value="value.start_date || ''" @change="set('start_date', $event.target.value)">
        <option value="">Не указано</option><option value="IMMEDIATELY">Сразу</option>
        <option value="FLEXIBLE">По договорённости</option>
      </select>
    </label>
    <label><span>Кому видно</span>
      <select :value="value.visibility || ''" @change="set('visibility', $event.target.value)">
        <option value="">Выберите</option><option value="RECRUITERS_ONLY">Только рекрутерам</option>
        <option value="ALL">Всем пользователям LinkedIn</option>
      </select>
    </label>
  </fieldset>
</template>
