<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { octoApi, octoProxyDraft, octoProxyPayload } from '../octo-api.js'
import { missingOctoLocales, octoOnboardingBusy } from '../octo-onboarding.js'
import OctoProxyFields from './OctoProxyFields.vue'
const props = defineProps({ status: { type: Object, required: true } })
const emit = defineEmits(['queued', 'denied'])
const proxy = ref(octoProxyDraft()), saving = ref(false), message = ref('')
const controller = new AbortController()
const missing = computed(() => missingOctoLocales(props.status))
const en = computed(() => props.status.profiles?.find(p => p.locale === 'en'))
const needsProxy = computed(() => props.status.requiredLocales?.includes('en') && !en.value?.proxy?.configured)
const busy = computed(() => saving.value || octoOnboardingBusy(props.status) || ['queued','creating','attaching'].includes(en.value?.proxy?.phase))
const unresolved = computed(() => ['unknown', 'awaiting_confirmation'].includes(props.status.onboarding?.phase))
async function submit() {
  if (busy.value || unresolved.value) return
  saving.value = true; message.value = ''
  try {
    if (!missing.value.length && en.value) await octoApi.saveProxy(en.value.id, proxy.value, { signal: controller.signal })
    else await octoApi.startOnboarding(needsProxy.value ? { source: 'manual', proxy: octoProxyPayload(proxy.value) } : { source: 'none' }, { signal: controller.signal })
    proxy.value = octoProxyDraft(); emit('queued')
  } catch (error) {
    if (error.name === 'AbortError') return
    if ([401,403].includes(error.status)) emit('denied', error)
    message.value = error.message === 'invalid_proxy_fields' ? 'Проверьте поля прокси.' : 'Не удалось начать настройку. Проверьте личные данные или обратитесь в поддержку.'
  } finally { saving.value = false }
}
onUnmounted(() => { controller.abort(); proxy.value = octoProxyDraft() })
</script>
<template>
  <div v-if="missing.length || needsProxy" class="manual-setup" data-testid="octo-manual-setup">
    <p>Для работы с Octo нужен компьютер с Windows.</p>
    <p v-if="busy" role="status">Создаём профили и сохраняем настройки в фоновом режиме…</p>
    <p v-else-if="unresolved" role="alert">Предыдущая настройка требует проверки поддержки. Повторное создание не запускается.</p>
    <form v-else @submit.prevent="submit">
      <fieldset :disabled="saving">
        <legend>{{ needsProxy ? 'Сначала настройте свой прокси для EN-профиля' : 'Создание профилей Octo' }}</legend>
        <OctoProxyFields v-if="needsProxy" v-model="proxy" prefix="octo-setup-proxy" />
        <button type="submit">{{ missing.length ? 'Создать профили Octo' : 'Сохранить прокси' }}</button>
      </fieldset>
    </form>
    <p v-if="message" role="alert">{{ message }}</p>
  </div>
</template>
<style scoped>
fieldset { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:8px;padding:16px }
legend{font-weight:600}button{padding:10px 14px;cursor:pointer} @media(max-width:600px){fieldset{grid-template-columns:1fr}}
</style>
