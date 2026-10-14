<script setup>
import { ref, watch } from 'vue'
import { OCTO_WELCOME_TEXT, dismissBrowserWelcome, shouldShowBrowserWelcome } from '../octo-onboarding.js'

const props = defineProps({ clientId: { type: [Number, String], required: true } })
const visible = ref(false)
function storage() { try { return window.localStorage } catch { return undefined } }
watch(() => props.clientId, id => { visible.value = shouldShowBrowserWelcome(storage(), id) }, { immediate: true })
function close() {
  dismissBrowserWelcome(storage(), props.clientId)
  visible.value = false
}
</script>

<template>
  <Dialog :visible="visible" modal header="Новый браузер Octo" :style="{ width: 'min(760px, 94vw)' }" :dismissable-mask="false"
    :pt="{ pcCloseButton: { root: { 'aria-label': 'Закрыть уведомление о браузере' } } }" @update:visible="close">
    <div class="browser-welcome" data-testid="octo-welcome">
      <span class="browser-welcome-badge"><i class="pi pi-sparkles" aria-hidden="true" /> Скоро станет ещё удобнее</span>
      <p>{{ OCTO_WELCOME_TEXT }}</p>
    </div>
    <template #footer><Button label="Понятно, продолжить" icon="pi pi-check" @click="close" /></template>
  </Dialog>
</template>

<style scoped>
.browser-welcome { padding: 20px 12px; background: linear-gradient(135deg, #eff6ff, #f5f3ff); border: 1px solid #dbeafe; border-radius: 18px; }
.browser-welcome-badge { display: inline-flex; align-items: center; gap: 8px; color: #4338ca; font-weight: 700; padding: 8px 14px; border-radius: 24px; background: #fff; }
.browser-welcome p { font-size: clamp(17px, 2.4vw, 21px); line-height: 1.8; margin: 22px 12px 10px; color: #1e293b; }
</style>
