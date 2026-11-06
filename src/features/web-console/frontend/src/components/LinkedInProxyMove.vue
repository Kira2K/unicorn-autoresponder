<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Dialog from 'primevue/dialog'
import OctoAccessCard from './OctoAccessCard.vue'
import OctoProxyFields from './OctoProxyFields.vue'
import { octoApi, octoProxyDraft, octoProxyPayload, request } from '../octo-api.js'
const props = defineProps({ clientId: { type:[Number,String], required:true } })
const state=ref(null), proxy=ref(octoProxyDraft()), busy=ref(false), loading=ref(true), error=ref(''), countryChanged=ref(false), complete=ref(false)
const controller=new AbortController(), path='/api/client/linkedin-proxy-move'
const loadError=ref('')
const refreshing=ref(false)
let operationVersion=0
let timer
const target=computed(()=>state.value?.move?.destination||state.value?.destination)
const assigned=computed(()=>['assigned','completed'].includes(state.value?.move?.phase))
const completed=computed(()=>state.value?.move?.phase==='completed')
const transport={...octoApi,async profileStatus(options){const s=await octoApi.profileStatus({...options,proxyCredentials:false});return{...s,profiles:s.profiles.filter(p=>p.locale==='en'),requiredLocales:['en']}}}
function message(code){return ({
  linkedin_proxy_move_account_not_ready:'Смена прокси станет доступна после подготовки действующего LinkedIn.',
  linkedin_proxy_move_forbidden:'Смена прокси доступна для твоего действующего EN-профиля Octo с подключённым прокси. Вернись к LinkedIn и обнови страницу.',
  linkedin_proxy_move_profile_not_ready:'EN-профиль ещё не готов. Обратись в поддержку.',
  linkedin_proxy_move_survey_required:'Сначала заполни в анкете готовность к собеседованию на английском через 2 месяца.',
  linkedin_proxy_move_country_mismatch:'Страна выходного IP не совпадает с нужной или не определена. Старый прокси сохранён.',
  linkedin_proxy_move_same_connection:'Это уже подключённый прокси. Для переезда укажи новое личное подключение.',
  linkedin_proxy_move_close_profile_first:'Закрой профиль Octo и дождись завершения доступа.',
  linkedin_proxy_move_assignment_pending:'Дождись подтверждения подключения нового прокси.',
  linkedin_proxy_move_confirmation_required:'Подтверди, что сменил(а) страну в профиле LinkedIn.',
  linkedin_proxy_move_already_started:'Переезд уже начат с другим подключением. Перечитай состояние или обратись в поддержку.',
  linkedin_proxy_move_unavailable:'Смена прокси сейчас недоступна. Попробуй позже или напиши в поддержку.',
  commit_uncertain:'Результат неизвестен. Проверяем сохранённое состояние; не отправляй повторно вслепую.'
})[code]||'Не удалось выполнить действие. Проверь реквизиты и обратись в поддержку при повторной ошибке.'}
async function refresh(){if(refreshing.value)return;refreshing.value=true;const version=operationVersion;try{const next=await request(path,{signal:controller.signal});if(version===operationVersion){state.value=next;loadError.value=''}}catch(e){if(e.name!=='AbortError'&&version===operationVersion)loadError.value=message(e.message)}finally{loading.value=false;refreshing.value=false}}
async function save(){if(busy.value)return;operationVersion++;busy.value=true;error.value='';try{state.value=await request(path+'/proxy',{method:'POST',body:JSON.stringify(octoProxyPayload(proxy.value)),signal:controller.signal});proxy.value=octoProxyDraft()}catch(e){if(e.name!=='AbortError'){error.value=message(e.message);await refresh()}}finally{busy.value=false}}
async function finish(){if(busy.value||!countryChanged.value)return;operationVersion++;busy.value=true;error.value='';try{state.value=await request(path+'/finish',{method:'POST',body:JSON.stringify({countryChanged:true}),signal:controller.signal});complete.value=true}catch(e){if(e.name!=='AbortError'){error.value=message(e.message);await refresh()}}finally{busy.value=false}}
onMounted(()=>{refresh();timer=setInterval(()=>{if(!document.hidden&&!busy.value&&state.value?.move?.phase!=='completed')refresh()},5000)})
onUnmounted(()=>{clearInterval(timer);controller.abort();proxy.value=octoProxyDraft()})
</script>
<template>
  <section data-testid="linkedin-proxy-move" class="move">
    <h3>Сменить прокси (Octo)</h3>
    <p v-if="loading" role="status">Проверяем готовность профиля Octo…</p>
    <template v-if="state">
    <p>Первый месяц LinkedIn работает на нашем прокси. Затем подключи собственный прокси и в тот же день смени страну в LinkedIn. Начинай, когда команда напишет о переезде.</p>
    <p v-if="target">По твоей анкете: <strong>{{target.country}}, {{target.city}}</strong>. Перед покупкой подтверди страну с командой в чате.</p>
    <p v-else-if="state">Заполни в анкете «Готовность к собеседованию на английском через 2 месяца», чтобы определить страну переезда.</p>
    <details><summary>1. Последний вход — вечером в день 1</summary><p>Заверши работу в LinkedIn вечером первого дня. Выйди из аккаунта в приложении на телефоне.</p></details>
    <details><summary>2. День 2 — не заходи в LinkedIn</summary><p>Выдержи день без входов в аккаунт.</p></details>
    <details open><summary>{{completed?'3. Замени собственный прокси EN':'3. День 3 — подключи прокси новой страны к EN'}}</summary>
      <p v-if="!completed">Купи прокси для {{target?target.country+', '+target.city:'страны из анкеты'}}. Вставь строку USERNAME:PASSWORD@IP:PORT и проверь протокол. До успешной проверки старый прокси останется подключён.</p>
      <p v-else>Переезд завершён. Собственный прокси можно менять повторно в форме ниже. Используй подключение той же страны — {{target.country}}. Для замены закрой профиль Octo и дождись окончания доступа.</p>
      <form v-if="!state?.move" @submit.prevent="save">
        <fieldset :disabled="busy||!state?.canReplace||!state?.country"><OctoProxyFields v-model="proxy" prefix="proxy-move" :single-line="true" save-label="Проверить и подключить к EN" line-placeholder="USERNAME:PASSWORD@IP:PORT" />
        <button type="submit" data-testid="proxy-move-save">{{busy?'Проверяем и подключаем…':'Проверить и подключить к EN'}}</button></fieldset>
      </form>
      <p v-if="state?.move?.phase==='assigning'" role="status">{{state.move.error?'Назначение требует проверки поддержки. Не подключай другой прокси.':'Подключаем новый прокси. Дождись подтверждения.'}}</p>
      <p v-if="assigned && !completed" role="status">Новый прокси подключён к EN.</p>
      <OctoAccessCard v-if="completed" :client-id="clientId" :setup-enabled="false" :proxy-editing-enabled="true" :proxy-expanded="true" :proxy-single-line="true" :transport="transport" @status="refresh" />
    </details>
    <details :open="assigned"><summary>4. Смени страну в LinkedIn и заверши переезд</summary>
      <p v-if="!assigned">Сначала дождись успешного подключения прокси на шаге 3.</p>
      <template v-else>
        <p v-if="!completed">Получи доступ, открой EN-профиль Octo и вручную смени страну и город в LinkedIn на {{target.country}}, {{target.city}}. Затем закрой профиль обычным способом и дождись завершения доступа.</p>
        <OctoAccessCard v-if="!completed" :client-id="clientId" :setup-enabled="false" :proxy-editing-enabled="false" :transport="transport" @status="refresh" />
        <label><input :checked="countryChanged || state.move.phase==='completed'" :disabled="state.move.phase==='completed'" type="checkbox" data-testid="proxy-move-country-confirmation" @change="countryChanged=$event.target.checked">Я подключил(а) новый прокси и сменил(а) страну в LinkedIn на {{target.country}}, {{target.city}}</label>
        <button v-if="state.move.phase!=='completed'" type="button" data-testid="proxy-move-finish" :disabled="busy||!countryChanged||!state.canFinish" @click="finish">Готово, переезд завершён</button>
        <p v-else role="status">Переезд завершён. Дата: {{new Date(state.move.completedAt).toLocaleString()}}</p>
      </template>
    </details>
    <p>После переезда заходи только через Octo. Первые несколько дней — минимум активности: не добавляй людей, не пиши посты и не откликайся массово. Если LinkedIn попросит подтвердить личность, не создавай новый аккаунт — напиши в поддержку.</p>
    <a href="https://t.me/veu_support_bot" target="_blank" rel="noopener noreferrer">Написать в поддержку</a>
    </template>
    <p v-if="error || loadError" role="alert">{{error || loadError}}</p>
    <button v-if="error || loadError" type="button" :disabled="refreshing" @click="error='';refresh()">{{refreshing?'Проверяем состояние…':'Обновить состояние'}}</button>
    <Dialog v-model:visible="complete" modal header="Переезд завершён ✅" :style="{width:'32rem',maxWidth:'calc(100vw - 2rem)'}"><p>Новый прокси подключён. Страна в LinkedIn — {{target?.country}}, {{target?.city}}. Первые несколько дней ограничь активность.</p><template #footer><button type="button" @click="complete=false">Понятно</button></template></Dialog>
  </section>
</template>
<style scoped>
.move{display:grid;gap:14px;line-height:1.6}h3,p{margin:0}details,fieldset{padding:14px;border:1px solid #cbd5e1;border-radius:8px;min-width:0}summary{font-weight:600;cursor:pointer}fieldset{display:grid;gap:14px}label{display:flex;gap:10px;align-items:start}button{font:inherit;padding:10px 14px;cursor:pointer}button:disabled{opacity:.5;cursor:default}[role=alert]{color:#b91c1c}
</style>
