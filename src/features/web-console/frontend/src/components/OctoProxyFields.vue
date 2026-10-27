<script setup>
import { ref } from 'vue'
defineProps({ modelValue: { type: Object, required: true }, prefix: { type: String, default: 'octo' } })
const showPassword = ref(false)
</script>
<template>
  <p class="proxy-entry-note"><strong>Введите данные прокси здесь, в форме нашей веб-консоли.</strong> В приложении Octo Browser прокси вводить или менять не нужно. После заполнения полей нажмите кнопку под формой.</p>
  <label>Тип прокси<select v-model="modelValue.type" :data-testid="`${prefix}-type`"><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks4">SOCKS4</option><option value="socks5">SOCKS5</option></select></label>
  <label>Адрес прокси<input v-model="modelValue.host" required autocomplete="off" spellcheck="false" :data-testid="`${prefix}-host`"></label>
  <label>Порт прокси<input v-model="modelValue.port" type="number" min="1" max="65535" required :data-testid="`${prefix}-port`"></label>
  <label>Логин прокси<input v-model="modelValue.login" autocomplete="off" spellcheck="false" :data-testid="`${prefix}-login`"></label>
  <div class="proxy-password">
    <label :for="`${prefix}-password`">Пароль прокси</label>
    <div class="proxy-password-input">
      <input :id="`${prefix}-password`" v-model="modelValue.password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" :data-testid="`${prefix}-password`">
      <button type="button" :aria-label="showPassword ? 'Скрыть пароль прокси' : 'Показать пароль прокси'" :aria-pressed="showPassword" @click="showPassword = !showPassword">{{ showPassword ? 'Скрыть' : 'Показать' }}</button>
    </div>
  </div>
  <label>URL смены IP (необязательно)<input v-model="modelValue.changeIpUrl" type="url" autocomplete="off" :data-testid="`${prefix}-change-ip-url`"></label>
</template>
<style scoped>
.proxy-entry-note { grid-column: 1 / -1; margin: 0; }
label { display: grid; gap: 6px; font-weight: 600; }
input,select { width: 100%; min-width: 0; padding: 10px; border: 1px solid var(--p-content-border-color,#cbd5e1); border-radius: 6px; font: inherit; color: inherit; background: var(--p-content-background,#fff); }
.proxy-password { display: grid; gap: 6px; }
.proxy-password-input { display: flex; gap: 8px; }
.proxy-password-input input { flex: 1; width: 0; }
.proxy-password-input button { flex: none; cursor: pointer; padding: 10px; border: 1px solid var(--p-content-border-color,#cbd5e1); border-radius: 6px; font: inherit; color: inherit; background: var(--p-content-background,#fff); }
</style>
