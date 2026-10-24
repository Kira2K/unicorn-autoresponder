<script setup>
defineProps({ modelValue: { type: Object, required: true }, prefix: { type: String, default: 'octo' } })
</script>
<template>
  <label>Тип прокси<select v-model="modelValue.type" :data-testid="`${prefix}-type`"><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks4">SOCKS4</option><option value="socks5">SOCKS5</option></select></label>
  <label>Адрес прокси<input v-model="modelValue.host" required autocomplete="off" spellcheck="false" :data-testid="`${prefix}-host`"></label>
  <label>Порт прокси<input v-model="modelValue.port" type="number" min="1" max="65535" required :data-testid="`${prefix}-port`"></label>
  <label>Логин прокси<input v-model="modelValue.login" autocomplete="off" spellcheck="false" :data-testid="`${prefix}-login`"></label>
  <label>Пароль прокси<input v-model="modelValue.password" type="password" autocomplete="new-password" :data-testid="`${prefix}-password`"></label>
  <label>URL смены IP (необязательно)<input v-model="modelValue.changeIpUrl" type="url" autocomplete="off" :data-testid="`${prefix}-change-ip-url`"></label>
</template>
<style scoped>
label { display: grid; gap: 6px; font-weight: 600; }
input,select { width: 100%; min-width: 0; padding: 10px; border: 1px solid var(--p-content-border-color,#cbd5e1); border-radius: 6px; font: inherit; color: inherit; background: var(--p-content-background,#fff); }
</style>
