<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { registrationTimeInput, registrationTimeUtc } from '../linkedin-intake.js'
const model = defineModel({ type: String, default: '' })
const day = ref(''), hour = ref(''), minute = ref(''), dateInput = ref(null), error = ref('')
const maximum = ref(registrationTimeInput(new Date()))
const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
const complete = () => day.value && hour.value !== '' && minute.value !== '' ? `${day.value}T${hour.value}:${minute.value}` : ''
watch(model, value => {
  if (value === complete()) return
  const [date = '', time = ''] = value.split('T'), [h = '', m = ''] = time.split(':')
  day.value = date; hour.value = h; minute.value = m
}, { immediate: true })
const today = computed(() => day.value === maximum.value.slice(0, 10))
const futureHour = h => today.value && h > maximum.value.slice(11, 13)
const futureMinute = m => today.value && hour.value === maximum.value.slice(11, 13) && m > maximum.value.slice(14, 16)
function validate() {
  maximum.value = registrationTimeInput(new Date())
  error.value = ''
  try {
    const utc = registrationTimeUtc(complete())
    if (day.value > maximum.value.slice(0, 10) || utc && Date.parse(utc) > Date.now())
      error.value = 'Дата и время регистрации не могут быть в будущем.'
  } catch { error.value = 'Укажите корректные дату и время регистрации Outlook-почты.' }
  dateInput.value?.setCustomValidity(error.value)
}
watch([day, hour, minute], () => { model.value = complete(); validate() })
let timer
onMounted(() => { validate(); timer = setInterval(validate, 30000) })
onUnmounted(() => clearInterval(timer))
</script>
<template>
  <div class="registration-field" data-testid="outlook-registration-time">
    <label for="outlook-registration-date">Дата и время регистрации Outlook-почты</label>
    <div class="registration-controls">
      <input id="outlook-registration-date" ref="dateInput" v-model="day" type="date" required :max="maximum.slice(0, 10)" :aria-invalid="!!error" aria-label="Дата и время регистрации Outlook-почты" :aria-describedby="error ? 'outlook-registration-hint outlook-registration-error' : 'outlook-registration-hint'" @focus="validate" @invalid="validate">
      <div class="registration-time" role="group" aria-label="Время регистрации Outlook-почты">
        <select v-model="hour" required :disabled="!day" aria-label="Часы регистрации Outlook-почты" :aria-invalid="!!error" @focus="validate"><option disabled value="">ЧЧ</option><option v-for="h in hours" :key="h" :value="h" :disabled="futureHour(h)">{{ h }}</option></select>
        <span aria-hidden="true">:</span>
        <select v-model="minute" required :disabled="!day || hour === ''" aria-label="Минуты регистрации Outlook-почты" :aria-invalid="!!error" @focus="validate"><option disabled value="">ММ</option><option v-for="m in minutes" :key="m" :value="m" :disabled="futureHour(hour) || futureMinute(m)">{{ m }}</option></select>
      </div>
    </div>
    <span class="registration-notes"><small id="outlook-registration-hint">Дата не может быть в будущем</small><small v-if="error" id="outlook-registration-error" role="alert">{{ error }}</small></span>
  </div>
</template>
<style scoped>
.registration-field{display:grid;gap:6px;align-content:start;font-weight:600;min-width:0}.registration-field>label{line-height:1.4}
.registration-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:10px;min-width:0}
input,select{box-sizing:border-box;height:44px;min-width:0;border:1px solid var(--p-content-border-color,#cbd5e1);border-radius:6px;background:var(--p-content-background,#fff);color:inherit;font:inherit;font-weight:400}input{width:100%;padding:10px}
.registration-time{display:flex;align-items:center;gap:5px}select{width:64px;padding:0 6px}select:disabled{opacity:.55}[aria-invalid=true]{border-color:#dc2626}
.registration-notes{display:grid;gap:6px;font-weight:400;line-height:1.4}#outlook-registration-error{color:#dc2626}
</style>
