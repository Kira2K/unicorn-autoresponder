<script setup>
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const address = 'kind.cute.unicorn@gmail.com'
const block = ref(null), visible = ref(false), copied = ref(false)
async function copy() { try { await navigator.clipboard.writeText(address); copied.value = true } catch { copied.value = false } }
function open() { visible.value = false; block.value.open = true; block.value.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
defineExpose({ requireConfirmation: () => { visible.value = true } })
</script>
<template>
  <details ref="block" data-testid="outlook-forwarding">
    <summary>Пересылка писем</summary>
    <p>Коды LinkedIn приходят на твою новую почту Outlook. Включи пересылку, чтобы эксперт мог получить код. Копии писем останутся у тебя.</p>
    <p><strong>{{ address }}</strong> <button type="button" @click="copy">{{ copied ? 'Скопировано' : 'Скопировать' }}</button></p>
    <ol>
      <li>Открой Outlook в браузере. На телефоне включи версию сайта для компьютера, если нужных настроек нет.</li>
      <li>Открой настройки → «Почта» / Mail.</li>
      <li>Выбери «Пересылка» / Forwarding или «Пересылка и IMAP» / Forwarding and IMAP.</li>
      <li>Включи «Включить пересылку» / Enable forwarding.</li>
      <li>Введи {{ address }}.</li>
      <li>Поставь галочку «Сохранять копии пересылаемых сообщений» / Keep a copy of forwarded messages.</li>
      <li>Нажми «Сохранить» / Save. Outlook может попросить войти повторно или ввести код.</li>
    </ol>
    <p>Номер телефона привязывать не нужно. Если Outlook требует телефон, напиши в поддержку и приложи скриншот.</p>
    <label class="check"><input type="checkbox" :checked="modelValue" @change="emit('update:modelValue', $event.target.checked)">Я включил(а) пересылку на {{ address }} и нажал(а) «Сохранить»</label>
  </details>
  <Dialog v-model:visible="visible" modal header="Сначала включи пересылку писем" :style="{ width:'34rem', maxWidth:'calc(100vw - 2rem)' }">
    <p>Без неё эксперт не сможет получить код от LinkedIn, и создание аккаунта застрянет. Открой инструкцию, включи пересылку и поставь галочку внизу блока.</p>
    <template #footer><button type="button" @click="open">Открыть инструкцию</button><button type="button" @click="visible=false">Закрыть</button></template>
  </Dialog>
</template>
<style scoped>
details{grid-column:1/-1;line-height:1.6}summary{cursor:pointer;font-weight:600}.check{display:flex;gap:10px;align-items:start}.check input{width:auto;margin-top:6px}button{font:inherit;padding:8px 12px;cursor:pointer}strong{overflow-wrap:anywhere}
</style>
