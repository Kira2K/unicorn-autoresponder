<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { octoApi, octoProxyDraft, octoProxyPayload } from '../octo-api.js'
import { missingOctoLocales, octoOnboardingBusy } from '../octo-onboarding.js'
import OctoProxyFields from './OctoProxyFields.vue'
import {proxyFieldErrors} from '../proxy-field-errors.js'
const props = defineProps({ status: { type: Object, required: true },guided:{type:Boolean,default:false} })
const emit = defineEmits(['queued', 'denied'])
const proxy = ref(octoProxyDraft()), saving = ref(false), message = ref('')
const controller = new AbortController()
const editing=ref(false),errors=ref({})
const missing = computed(() => missingOctoLocales(props.status))
const en = computed(() => props.status.profiles?.find(p => p.locale === 'en'))
const needsProxy = computed(() => props.status.requiredLocales?.includes('en') && !en.value?.proxy?.configured)
const busy = computed(() => saving.value || octoOnboardingBusy(props.status) || ['queued','creating','attaching'].includes(en.value?.proxy?.phase))
const retryManualConfirmation=computed(()=>props.guided&&props.status.onboarding?.source==='manual'&&props.status.onboarding?.phase==='awaiting_confirmation')
const unresolved = computed(() => ['unknown', 'awaiting_confirmation'].includes(props.status.onboarding?.phase)&&!retryManualConfirmation.value)
const showForm=computed(()=>missing.value.length||needsProxy.value||editing.value||props.status.onboarding?.phase==='blocked'||retryManualConfirmation.value)
watch(()=>props.status.onboarding?.phase,phase=>{if(props.guided&&phase==='complete'){editing.value=false;proxy.value=octoProxyDraft()}})
function changeProxy(){proxy.value=octoProxyDraft(en.value?.proxy);editing.value=true;message.value=''}
function setupFailure(code){
 if(['octo_setup_outcome_unknown','octo_create_outcome_unknown','octo_request_outcome_unknown','octo_proxy_write_unknown'].includes(code))return 'Octo не подтвердил результат предыдущей операции. Повторное создание не запускается, чтобы не получить дубли. Напиши в поддержку: сначала нужно проверить созданные профили.'
 if(code==='octo_profile_not_idle')return 'Закрой EN-профиль Octo и дождись завершения доступа. Затем снова сохрани прокси.'
 if(['octo_checker_configuration_required','octo_checker_unavailable','octo_proxy_check_unknown','octo_proxy_check_rejected'].includes(code))return 'Сейчас не удалось проверить подключение. Данные сохранены в форме. Попробуй ещё раз; если ошибка повторится, напиши в поддержку.'
 if(code==='octo_proxy_managed_by_expert')return 'Этот прокси настроен командой. Для его изменения напиши в поддержку.'
 if(code==='octo_proxy_check_failed')return 'Прокси не прошёл проверку. Проверь адрес, порт, логин и пароль, а затем повтори попытку.'
 return 'Настройка не завершилась. Проверь реквизиты прокси. Если они верны, напиши в поддержку.'
}
async function submit() {
  if (busy.value || unresolved.value) return
  saving.value = true; message.value = ''
  try {
    if(props.guided){
      errors.value=proxyFieldErrors(proxy.value)
      if(Object.keys(errors.value).length){message.value='Данные не отправлены. Исправь отмеченные поля.';return}
      await octoApi.startOnboarding({source:'manual',proxy:octoProxyPayload(proxy.value)},{signal:controller.signal})
    }else if (!missing.value.length && en.value) await octoApi.saveProxy(en.value.id, proxy.value, { signal: controller.signal })
    else await octoApi.startOnboarding(needsProxy.value ? { source: 'manual', proxy: octoProxyPayload(proxy.value) } : { source: 'none' }, { signal: controller.signal })
    if(!props.guided)proxy.value = octoProxyDraft(); emit('queued')
  } catch (error) {
    if (error.name === 'AbortError') return
    if ([401,403].includes(error.status)) emit('denied', error)
    const fields=(error.fields||[]).map(item=>item.label).filter(Boolean)
    if(props.guided){
      message.value=error.message==='octo_client_data_required'
        ?(fields.length?`Для Octo не хватает данных ученика: ${fields.join(', ')}. Заполни личные данные или напиши в поддержку.`:'Для Octo не хватает обязательных данных ученика. Заполни личные данные или напиши в поддержку.')
        :setupFailure(error.message);return
    }
    message.value = error.message === 'octo_client_data_required'
      ? (fields.length ? `Не хватает данных ученика: ${fields.join(', ')}. Заполни личные данные; если поле недоступно, обратись в поддержку.` : 'Не хватает обязательных данных ученика для Octo. Проверь личные данные или обратись в поддержку.')
      : error.message === 'invalid_proxy_fields' ? 'Проверь поля прокси.' : 'Не удалось начать настройку. Проверь личные данные или обратись в поддержку.'
  } finally { saving.value = false }
}
onUnmounted(() => { controller.abort(); proxy.value = octoProxyDraft() })
</script>
<template>
  <div v-if="guided || missing.length || needsProxy" class="manual-setup" :class="{'guided-setup':guided}" data-testid="octo-manual-setup">
    <p v-if="!guided">Для работы с Octo нужен компьютер с Windows.</p>
    <p v-if="guided && status.onboarding?.check" role="status" data-testid="octo-proxy-check-result">Прокси работает. IP: {{status.onboarding.check.exitIp}}.</p>
    <p v-if="retryManualConfirmation" role="status">Предыдущая проверка остановилась на оценке качества. Введи реквизиты ещё раз: теперь проверим только подключение.</p>
    <p v-if="busy" class="setup-progress" role="status"><i class="pi pi-spin pi-spinner" aria-hidden="true" /><span>{{guided?'Проверяем прокси и подготавливаем Octo. Дождись результата.':'Создаём профили и сохраняем настройки в фоновом режиме…'}}</span></p>
    <p v-else-if="unresolved" role="alert">Предыдущая настройка требует проверки поддержки. Повторное создание не запускается.</p>
    <form v-else-if="!guided||showForm" @submit.prevent="submit" :novalidate="guided" @input="errors={}">
      <fieldset :disabled="saving">
        <legend>{{ needsProxy ? 'Сначала настрой свой прокси для EN-профиля' : 'Создание профилей Octo' }}</legend>
        <OctoProxyFields v-if="needsProxy||guided" v-model="proxy" prefix="octo-setup-proxy" :guided="guided" :errors="errors" />
        <button type="submit">{{ guided?'Проверить и подключить прокси':missing.length ? 'Создать профили Octo' : 'Сохранить прокси' }}</button>
      </fieldset>
    </form>
    <button v-else-if="guided" type="button" @click="changeProxy">Изменить прокси</button>
    <p v-if="guided && status.onboarding?.phase==='blocked'" role="alert">{{setupFailure(status.onboarding.error)}}</p>
    <p v-if="message" role="alert">{{ message }}</p>
    <a v-if="guided&&(message||['blocked','unknown'].includes(status.onboarding?.phase))" href="https://t.me/veu_support_bot" target="_blank" rel="noopener noreferrer">Напиши в поддержку</a>
  </div>
</template>
<style scoped>
fieldset { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:8px;padding:16px }
legend{font-weight:600}button{padding:10px 14px;cursor:pointer} @media(max-width:600px){fieldset{grid-template-columns:1fr}}
.setup-progress{display:flex;align-items:center;gap:10px}.setup-progress>.pi{flex-shrink:0}
.guided-setup{min-width:0}.guided-setup fieldset{min-width:0}@media(max-width:640px){.guided-setup fieldset{grid-template-columns:minmax(0,1fr)}}
</style>
