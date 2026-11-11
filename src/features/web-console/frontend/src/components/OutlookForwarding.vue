<script setup>
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const address = 'veulinkforwards@proton.me'
const block = ref(null), visible = ref(false), copied = ref(false)
async function copy() { try { await navigator.clipboard.writeText(address); copied.value = true } catch { copied.value = false } }
function open() { visible.value = false; block.value.open = true; block.value.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
defineExpose({ requireConfirmation: () => { visible.value = true } })
</script>
<template>
  <details ref="block" data-testid="outlook-forwarding">
    <summary>Пересылка писем</summary>
    <p>Когда эксперт регистрирует LinkedIn и входит в него, LinkedIn присылает код на твою почту Outlook. Чтобы эксперт сразу получал код и не ждал тебя, включи пересылку писем с твоей почты на нашу:</p>
    <p><strong>{{ address }}</strong> <button type="button" @click="copy">{{ copied ? 'Скопировано' : 'Скопировать' }}</button></p>
    <p>Почта новая и нужна только для LinkedIn, личных писем в ней не будет. Все письма останутся и у тебя.</p>
    <p><strong>Как включить пересылку:</strong></p>
    <ol>
      <li>Открой <strong>outlook.live.com</strong> в браузере и войди в новую почту. В приложении Outlook этой настройки нет. Если на телефоне нужного пункта не видно, включи в меню браузера «Версия для ПК».</li>
      <li>Нажми <strong>⚙ Настройки</strong> справа вверху. Settings</li>
      <li>Открой <strong>Почта → Пересылка</strong>. Mail → Forwarding. Пункт может называться «Пересылка и IMAP» / Forwarding and IMAP.</li>
      <li>Включи <strong>«Включить пересылку»</strong>. Enable forwarding</li>
      <li>В поле адреса вставь <strong>{{ address }}</strong>.</li>
      <li>Поставь галочку <strong>«Сохранять копии пересылаемых сообщений»</strong>. Keep a copy of forwarded messages</li>
      <li>Нажми <strong>«Сохранить»</strong>. Save</li>
    </ol>
    <p>Если Outlook попросит ещё раз войти или подтвердить почту кодом — сделай это.</p>
    <p>Номер телефона к почте не привязывай. Если Outlook не даёт включить пересылку без телефона — напиши в поддержку и пришли скриншот.</p>
    <label class="check"><input type="checkbox" :checked="modelValue" @change="emit('update:modelValue', $event.target.checked)">Я включил(а) пересылку на {{ address }} и нажал(а) «Сохранить»</label>
  </details>
  <Dialog v-model:visible="visible" modal header="Сначала включи пересылку писем" :style="{ width:'34rem', maxWidth:'calc(100vw - 2rem)' }">
    <p>Без неё эксперт не сможет получить код от LinkedIn, и создание аккаунта застрянет. Открой блок «Пересылка писем», включи пересылку на {{ address }} по инструкции и поставь галочку внизу блока. После этого кнопка сохранения заработает.</p>
    <template #footer><button type="button" @click="open">Открыть инструкцию</button><button type="button" @click="visible=false">Закрыть</button></template>
  </Dialog>
</template>
<style scoped>
details{grid-column:1/-1;line-height:1.6}summary{cursor:pointer;font-weight:600}.check{display:flex;gap:10px;align-items:start}.check input{width:auto;margin-top:6px}button{font:inherit;padding:8px 12px;cursor:pointer}strong{overflow-wrap:anywhere}
</style>
