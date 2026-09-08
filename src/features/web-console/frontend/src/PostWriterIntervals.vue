<script setup>
const props = defineProps({ modelValue: Array, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const change = (index, key, value) => emit('update:modelValue', props.modelValue.map((item, i) =>
  i === index ? { ...item, [key]: value } : item))
</script>
<template>
  <fieldset :disabled="disabled" class="post-intervals">
    <legend>Время автозапуска · МСК</legend>
    <div v-for="(interval, index) in modelValue" :key="index">
      <label>С <input type="time" :value="interval.start" :data-testid="`post-interval-start-${index}`"
        @input="change(index, 'start', $event.target.value)" /></label>
      <label>До <input type="time" :value="interval.end" :data-testid="`post-interval-end-${index}`"
        @input="change(index, 'end', $event.target.value)" /></label>
      <button type="button" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">Удалить</button>
    </div>
    <button type="button" :disabled="modelValue.length >= 12" data-testid="post-interval-add"
      @click="emit('update:modelValue', [...modelValue, { start: '16:00', end: '17:00' }])">Добавить интервал</button>
    <small>Случайное время внутри интервалов. Всего один автопост в выбранный день.</small>
  </fieldset>
</template>
<style scoped>
.post-intervals { display: grid; gap: .65rem; border: 1px solid #cbd5e1; border-radius: 6px; }
.post-intervals div { display: flex; gap: .7rem; align-items: center; }
.post-intervals input, button { padding: .4rem; }
</style>
