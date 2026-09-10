<script setup>
import { computed } from 'vue'
import { splitProfileDate, joinProfileDate, completeProfileDate } from './profile-date-value.js'
const props = defineProps({ modelValue: { default: '' }, label: String, allowCurrent: Boolean, disabled: Boolean })
const emit = defineEmits(['update:modelValue', 'save'])
const parts = computed(() => splitProfileDate(props.modelValue))
const complete = computed(() => completeProfileDate(props.modelValue, props.allowCurrent))
const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
function change(key, value) { emit('update:modelValue', joinProfileDate({ ...parts.value, [key]: value })) }
</script>
<template>
  <fieldset :disabled="disabled" class="profile-date-input" @keydown.enter.prevent="complete && emit('save')">
    <legend>{{ label }}</legend>
    <label v-if="allowCurrent" class="profile-date-current"><input type="checkbox" :checked="parts.current"
      @change="change('current', $event.target.checked)" />По настоящее время</label>
    <div v-if="!parts.current" class="profile-date-parts">
      <label>Месяц<select :aria-label="`${label}: месяц`" :value="parts.month" @change="change('month', $event.target.value)">
        <option value="">Не указан</option><option v-for="(month, index) in months" :key="month"
          :value="String(index + 1).padStart(2, '0')">{{ month }}</option></select></label>
      <label>Год<input type="number" min="1900" max="2199" step="1" :aria-label="`${label}: год`" :value="parts.year"
        @input="change('year', $event.target.value)" /></label>
    </div>
    <small v-if="!complete">Укажите подтверждённые месяц и год. Неизвестную дату не подставляем.</small>
    <button type="button" :disabled="!complete" @click="emit('save')">Сохранить дату</button>
  </fieldset>
</template>
<style scoped>
.profile-date-input { border: 1px solid #94a3b8; border-radius: .3rem; padding: .6rem; margin-top: .4rem; }
.profile-date-parts { display: flex; flex-wrap: wrap; gap: .6rem; }
.profile-date-parts label { flex: 1; min-width: 7rem; }
.profile-date-parts input, select { width: 100%; box-sizing: border-box; padding: .4rem; font: inherit; }
.profile-date-current { display: flex; gap: .4rem; margin-bottom: .5rem; }
small { display: block; margin-top: .4rem; } button { margin-top: .5rem; }
:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
</style>
