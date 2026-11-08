<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Dialog from 'primevue/dialog'
import OctoAccessCard from './OctoAccessCard.vue'
import OctoProxyFields from './OctoProxyFields.vue'
import { octoApi, octoProxyDraft, octoProxyPayload, request } from '../octo-api.js'
import {proxyCountryFailure,proxyCheckSuccess} from '../proxy-check-ui.js'
const props = defineProps({ clientId: { type:[Number,String], required:true } })
const state=ref(null), proxy=ref(octoProxyDraft()), busy=ref(false), loading=ref(true), error=ref(''), countryChanged=ref(false), complete=ref(false)
const controller=new AbortController(), path='/api/client/linkedin-proxy-move'
const loadError=ref('')
const refreshing=ref(false)
let operationVersion=0
let timer
const target=computed(()=>state.value?.move?.destination||state.value?.destination)
const targetCode=computed(()=>state.value?.move?.country||state.value?.country)
const guide='https://docs.google.com/document/d/1uAbO8FUyic9PqdZ6Ohn1wsDW-xs4F_qPi0VJuyWJij0/edit?tab=t.0'
const countries=[{code:'ES',country:'Испания',city:'Барселона',hint:'если готов(а) проходить собеседования на английском'},{code:'GE',country:'Грузия',city:'Тбилиси',hint:'если пока не готов(а) к собеседованиям на английском'}]
const countryForProxy=computed(()=>targetCode.value==='ES'?'Испании (Барселона)':targetCode.value==='GE'?'Грузии (Тбилиси)':'страны из анкеты')
const assigned=computed(()=>['assigned','completed'].includes(state.value?.move?.phase))
const completed=computed(()=>state.value?.move?.phase==='completed')
const transport={...octoApi,async profileStatus(options){const s=await octoApi.profileStatus({...options,proxyCredentials:false});return{...s,profiles:s.profiles.filter(p=>p.locale==='en'),requiredLocales:['en']}}}
function message(failure){const code=typeof failure==='string'?failure:failure.message;if(code==='linkedin_proxy_move_country_mismatch')return proxyCountryFailure(failure.proxyCheck);return ({
  linkedin_proxy_move_account_not_ready:'Смена прокси станет доступна после подготовки действующего LinkedIn.',
  linkedin_proxy_move_forbidden:'Смена прокси доступна для твоего действующего EN-профиля Octo с подключённым прокси. Вернись к LinkedIn и обнови страницу.',
  linkedin_proxy_move_profile_not_ready:'EN-профиль ещё не готов. Обратись в поддержку.',
  linkedin_proxy_move_survey_required:'Сначала заполни в анкете готовность к собеседованию на английском через 2 месяца.',
  linkedin_proxy_move_check_failed:'Прокси не отвечает или не удалось определить выходной IP. Старый прокси сохранён. Проверь реквизиты и попробуй снова.',
  linkedin_proxy_move_country_mismatch:'Страна выходного IP не совпадает с нужной или не определена. Старый прокси сохранён.',
  linkedin_proxy_move_same_connection:'Это уже подключённый прокси. Для переезда укажи новое личное подключение.',
  linkedin_proxy_move_close_profile_first:'Закрой профиль Octo и дождись завершения доступа.',
  linkedin_proxy_move_assignment_pending:'Дождись подтверждения подключения нового прокси.',
  linkedin_proxy_move_confirmation_required:'Подтверди, что сменил(а) страну в профиле LinkedIn.',
  linkedin_proxy_move_already_started:'Переезд уже начат с другим подключением. Перечитай состояние или обратись в поддержку.',
  linkedin_proxy_move_unavailable:'Смена прокси сейчас недоступна. Попробуй позже или напиши в поддержку.',
  commit_uncertain:'Результат неизвестен. Проверяем сохранённое состояние; не отправляй повторно вслепую.'
})[code]||'Не удалось выполнить действие. Проверь реквизиты и обратись в поддержку при повторной ошибке.'}
async function refresh(){if(refreshing.value)return;refreshing.value=true;const version=operationVersion;try{const next=await request(path,{signal:controller.signal});if(version===operationVersion){state.value=next;loadError.value=''}}catch(e){if(e.name!=='AbortError'&&version===operationVersion)loadError.value=message(e)}finally{loading.value=false;refreshing.value=false}}
async function save(){if(busy.value)return;operationVersion++;busy.value=true;error.value='';try{state.value=await request(path+'/proxy',{method:'POST',body:JSON.stringify(octoProxyPayload(proxy.value)),signal:controller.signal});proxy.value=octoProxyDraft()}catch(e){if(e.name!=='AbortError'){error.value=message(e);await refresh()}}finally{busy.value=false}}
async function finish(){if(busy.value||!countryChanged.value)return;operationVersion++;busy.value=true;error.value='';try{state.value=await request(path+'/finish',{method:'POST',body:JSON.stringify({countryChanged:true}),signal:controller.signal});complete.value=true}catch(e){if(e.name!=='AbortError'){error.value=message(e);await refresh()}}finally{busy.value=false}}
onMounted(()=>{refresh();timer=setInterval(()=>{if(!document.hidden&&!busy.value&&state.value?.move?.phase!=='completed')refresh()},5000)})
onUnmounted(()=>{clearInterval(timer);controller.abort();proxy.value=octoProxyDraft()})
</script>
<template>
  <section data-testid="linkedin-proxy-move" class="move">
    <h3>Переезд на свой прокси и в другую страну</h3>
    <p v-if="loading" role="status">Проверяем готовность профиля Octo…</p>
    <template v-if="state">
    <p>Первый месяц твой LinkedIn работает на прокси, который подобрали мы. После этого аккаунт переезжает на твой собственный прокси — и в профиле LinkedIn меняется страна.</p>
    <aside class="move-important" data-testid="proxy-move-important"><strong>Главное: прокси и страна в профиле меняются в один и тот же день.</strong><p>Если в профиле уже новая страна, а заходишь ты со старого адреса — или наоборот, — LinkedIn видит несовпадение. Поэтому заранее прокси не покупай и страну не меняй: начинай, только когда мы напишем.</p></aside>
    <p>Подробная инструкция со скриншотами: <a :href="guide" target="_blank" rel="noopener noreferrer">Свой прокси для LinkedIn: как купить и подключить</a>. Порядок важен — делай строго по шагам.</p>
    <details data-testid="proxy-move-step-0"><summary>0. Твоя страна и город</summary>
      <p>Страна зависит от того, на каком рынке ты ищешь работу, а не от того, где ты живёшь.</p>
      <div class="move-countries"><div v-for="country in countries" :key="country.code" class="move-country" :class="{'move-country-mine':targetCode===country.code}" :data-testid="`proxy-move-country-${country.code}`"><strong>{{country.country}}, {{country.city}}</strong><span v-if="targetCode===country.code" class="move-country-tag">твоя страна</span><p>{{country.hint}}</p></div></div>
      <p v-if="!target">Заполни в анкете «Готовность к собеседованию на английском через 2 месяца», чтобы определить страну переезда.</p>
    </details>
    <details data-testid="proxy-move-step-1"><summary>1. Последний раз зайди в LinkedIn вечером — день 1</summary><p>Если приложение LinkedIn стоит на телефоне — выйди из аккаунта сейчас, до переезда. После переезда в нём заходить нельзя: там твой настоящий адрес.</p></details>
    <details data-testid="proxy-move-step-2"><summary>2. Весь следующий день не заходи в LinkedIn — день 2</summary><p>Ни с компьютера, ни с телефона.</p></details>
    <details data-testid="proxy-move-step-3"><summary>{{completed?'3. Замени собственный прокси EN':'3. Купи прокси новой страны и подключи его к профилю En — день 3'}}</summary>
      <template v-if="!completed"><p>Шаги 3 и 4 — на следующий день после дня без LinkedIn, оба в один день.</p><p>Купи прокси по инструкции — разделы <a :href="guide" target="_blank" rel="noopener noreferrer">«Шаг 2» и «Шаг 3»</a>.</p><p>Купи прокси для {{countryForProxy}}. Страна и город — {{target?target.country+', '+target.city:'из анкеты'}}. Потом впиши данные прокси сюда.</p></template>
      <p v-else>Переезд завершён. Собственный прокси можно менять повторно в форме ниже. Используй подключение той же страны — {{target.country}}. Для замены закрой профиль Octo и дождись окончания доступа.</p>
      <form v-if="!state?.move" @submit.prevent="save">
        <fieldset :disabled="busy||!state?.canReplace||!state?.country"><OctoProxyFields v-model="proxy" prefix="proxy-move" :single-line="true" :guided="true" save-label="Проверить и подключить прокси" line-placeholder="USERNAME:PASSWORD@IP:PORT" />
        <button type="submit" data-testid="proxy-move-save">{{busy?'Проверяем и подключаем…':'Проверить и подключить прокси'}}</button></fieldset>
      </form>
      <p v-if="state.proxyCheck" class="move-success" role="status" data-testid="proxy-move-check-result">{{proxyCheckSuccess(state.proxyCheck)}}</p>
      <p v-if="state?.move?.phase==='assigning'" role="status">{{state.move.error?'Назначение требует проверки поддержки. Не подключай другой прокси.':'Подключаем новый прокси. Дождись подтверждения.'}}</p>
      <p v-if="assigned && !completed" role="status">Новый прокси подключён к EN.</p>
      <OctoAccessCard v-if="completed" :client-id="clientId" :setup-enabled="false" :proxy-editing-enabled="true" :proxy-expanded="true" :proxy-checking="true" :proxy-single-line="true" :transport="transport" @status="refresh" />
    </details>
    <details data-testid="proxy-move-step-4"><summary>4. Открой LinkedIn в профиле En и смени страну в профиле — день 3</summary>
      <p v-if="!assigned">Сначала подключи прокси в шаге 3.</p>
      <template v-else>
        <template v-if="!completed"><ol><li>Открой приложение Octo Browser на компьютере.</li><li>Здесь, в кабинете, нажми «Получить доступ» у EN-профиля — появятся почта, пароль от аккаунта и пароль к профилю.</li><li>Войди в Octo по почте и паролю от аккаунта и открой свой профиль по паролю к профилю. На это есть около 2 минут — не успел(а), нажми «Получить доступ» ещё раз. Уже открытый профиль продолжит работать.</li><li>В профиле открой LinkedIn и смени страну в профиле на страну нового прокси: {{target.country}}, {{target.city}}.</li><li>Потом закрой профиль.</li></ol><p>Дождись завершения доступа, затем подтверди переезд.</p></template>
        <OctoAccessCard v-if="!completed" :client-id="clientId" :setup-enabled="false" :proxy-editing-enabled="false" :transport="transport" @status="refresh" />
        <label><input :checked="countryChanged || state.move.phase==='completed'" :disabled="state.move.phase==='completed'" type="checkbox" data-testid="proxy-move-country-confirmation" @change="countryChanged=$event.target.checked">Я подключил(а) новый прокси и сменил(а) страну в LinkedIn на {{target.country}}, {{target.city}}</label>
        <button v-if="state.move.phase!=='completed'" type="button" data-testid="proxy-move-finish" :disabled="busy||!countryChanged||!state.canFinish" @click="finish">Готово, переезд завершён</button>
        <p v-else role="status">Переезд завершён. Дата: {{new Date(state.move.completedAt).toLocaleString()}}</p>
      </template>
    </details>
    <details data-testid="proxy-move-step-5"><summary>5. Первые несколько дней — минимум активности — с дня 4</summary><p>Не добавляй людей, не пиши посты, не откликайся массово.</p><p>Дальше постепенно возвращаемся к обычному режиму.</p></details>
    <div class="move-rules"><p><strong>После переезда — только антидетект-браузер (Octo/Dolphin).</strong> Не открывай LinkedIn в обычном браузере и в приложении на телефоне: там у тебя твой настоящий адрес, и LinkedIn может заподозрить взлом.</p><p>Если LinkedIn попросит подтвердить личность — не регистрируй новый аккаунт и ничего не делай сам, сразу напиши нам. Если у тебя есть настоящий паспорт, держи его под рукой.</p></div>
    <p>Не получилось? <a href="https://t.me/veu_support_bot" target="_blank" rel="noopener noreferrer">Напиши в поддержку</a> и пришли скриншот.</p>
    </template>
    <p v-if="error || loadError" role="alert">{{error || loadError}}</p>
    <button v-if="error || loadError" type="button" :disabled="refreshing" @click="error='';refresh()">{{refreshing?'Проверяем состояние…':'Обновить состояние'}}</button>
    <Dialog v-model:visible="complete" modal header="Переезд завершён ✅" :style="{width:'32rem',maxWidth:'calc(100vw - 2rem)'}"><p>Новый прокси подключён, страна в профиле — {{target?.country}}, {{target?.city}}. Первые несколько дней — минимум активности: не добавляй людей, не пиши посты, не откликайся массово.</p><p>Заходи в LinkedIn только через антидетект-браузер (Octo/Dolphin) — не в обычном браузере и не в приложении на телефоне.</p><p>Если LinkedIn попросит подтвердить личность — ничего не делай сам и сразу напиши нам.</p><template #footer><button type="button" @click="complete=false">Понятно</button></template></Dialog>
  </section>
</template>
<style scoped>
.move{display:grid;gap:14px;line-height:1.6}h3,p{margin:0}details,fieldset{padding:14px;border:1px solid #cbd5e1;border-radius:8px;min-width:0}summary{font-weight:600;cursor:pointer}fieldset{display:grid;gap:14px}label{display:flex;gap:10px;align-items:start}button{font:inherit;padding:10px 14px;cursor:pointer}button:disabled{opacity:.5;cursor:default}[role=alert]{color:#b91c1c}
.move-important{background:#fffbeb;border:1px solid #fcd34d;color:#92400e;border-radius:10px;padding:14px}.move-important p{margin-top:8px}.move-countries{display:flex;flex-wrap:wrap;gap:14px;margin-top:12px}.move-country{flex:1 1 230px;border:1px solid #cbd5e1;border-radius:10px;padding:12px 14px;color:#64748b}.move-country-mine{border:2px solid #10b981;background:#ecfdf5;color:#1f2937}.move-country-tag{display:inline-block;margin-left:8px;font-size:12px;font-weight:700;color:#047857}.move-success{background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;padding:10px 14px;border-radius:8px}.move-rules{border-top:1px solid #e5e7eb;padding-top:12px}.move-rules p+p{margin-top:10px}details>p,details>ol{margin-top:12px}details form{margin-top:12px}a{color:#2563eb}button[type=submit]{background:#059669;color:white;border:1px solid #059669;border-radius:8px}
</style>
