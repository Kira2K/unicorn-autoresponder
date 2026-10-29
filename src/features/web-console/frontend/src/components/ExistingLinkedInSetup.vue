<script setup>
import {computed,ref,watch} from 'vue'
import OctoAccessCard from './OctoAccessCard.vue'
import OctoManualSetup from './OctoManualSetup.vue'
import Dialog from 'primevue/dialog'
import {intakeRequest,infrastructureReady,infrastructureSignature} from '../linkedin-intake.js'
const props=defineProps({client:{type:Object,required:true},account:{type:Object,required:true}})
const emit=defineEmits(['saved'])
const credentials=ref({url:props.account.url||'',login:props.account.login||'',password:''})
const saved=ref({...credentials.value}),hasPassword=ref(!!props.account.hasPassword)
const status=ref(null),busy=ref(false),message=ref(''),opened=ref(false),loggedIn=ref(false),showPassword=ref(false)
const showSavedDialog=ref(false)
const dirty=computed(()=>credentials.value.url!==saved.value.url||credentials.value.login!==saved.value.login||!!credentials.value.password)
const canSetup=computed(()=>hasPassword.value&&!!saved.value.url&&!!saved.value.login&&!dirty.value)
const canConfirm=computed(()=>canSetup.value&&infrastructureReady(status.value)&&opened.value&&loggedIn.value&&!busy.value)
watch(()=>[credentials.value.url,credentials.value.login,credentials.value.password],()=>{loggedIn.value=false;opened.value=false})
watch(()=>infrastructureSignature(status.value),()=>{loggedIn.value=false;opened.value=false})
async function save(stage){
 if(busy.value||stage==='complete'&&!canConfirm.value)return
 busy.value=true;message.value=''
 try{
  const result=await intakeRequest('PUT',{scenario:'existing',stage,...credentials.value,loggedIn:stage==='complete'})
  if(result.saved!==true||!Number.isSafeInteger(result.linkedinAccountId)||result.linkedinAccountId<1)throw new Error('linkedin_intake_unavailable')
  saved.value={...credentials.value,password:''};credentials.value.password='';hasPassword.value=true
  message.value=stage==='credentials'?'Данные LinkedIn сохранены. Теперь настрой Octo.':'Подключение LinkedIn подтверждено.'
  if(stage==='complete')showSavedDialog.value=true
  emit('saved')
 }catch(error){
  message.value=error.message==='commit_uncertain'?'Результат сохранения неизвестен. Перезагрузи страницу, чтобы проверить данные; повторно ничего не отправляй.'
   :error.message==='linkedin_intake_account_required'?'Проверь ссылку на профиль LinkedIn и логин. Ссылка должна выглядеть как https://www.linkedin.com/in/имя.'
   :error.message==='linkedin_intake_password_required'?'Введи пароль LinkedIn.'
   :error.message==='linkedin_intake_infrastructure_required'?'Сначала дождись настройки Octo и войди в LinkedIn через EN-профиль.'
   :'Не удалось сохранить данные. Проверь поля и попробуй ещё раз.'
 }finally{busy.value=false}
}
</script>
<template>
 <section class="existing-setup" data-testid="linkedin-existing-setup">
  <h3>Подключи свой LinkedIn через Octo</h3>
  <p>Octo — специальный браузер, через который наша команда работает с твоим LinkedIn, снижая риск блокировки. Подключение обычно занимает около 15 минут. Нужен компьютер с Windows.</p>
  <details class="setup-step" data-testid="linkedin-step-1">
  <summary><h3>Шаг 1. Внеси данные LinkedIn</h3></summary>
  <form class="credentials" data-testid="linkedin-existing-form" @submit.prevent="save('credentials')">
   <label>Ссылка на профиль<input v-model="credentials.url" required placeholder="https://www.linkedin.com/in/…" autocomplete="off"></label>
   <label>Логин LinkedIn (email или телефон)<input v-model="credentials.login" required autocomplete="off" placeholder="name@example.com"></label>
   <label class="password">Пароль LinkedIn
    <span><input v-model="credentials.password" aria-label="Пароль LinkedIn" :type="showPassword?'text':'password'" :required="!hasPassword" :placeholder="hasPassword?'Сохранён. Оставь пустым, чтобы не менять':''" autocomplete="new-password">
    <button type="button" :aria-pressed="showPassword" @click="showPassword=!showPassword">{{showPassword?'Скрыть':'Показать'}}</button></span>
   </label>
   <button type="submit" :disabled="busy">{{busy?'Сохраняем…':'Сохранить и перейти к Octo'}}</button>
  </form>
  </details>
  <p v-if="message" role="status">{{message}}</p>
  <details class="setup-step" data-testid="linkedin-step-2">
  <summary><h3>Шаг 2. Подключи прокси</h3></summary>
  <p>Прокси — адрес в интернете, через который LinkedIn видит твой вход. Купи его на <a href="https://proxy-cheap.com" target="_blank" rel="noopener noreferrer">proxy-cheap.com</a> или <a href="https://iproyal.com" target="_blank" rel="noopener noreferrer">iproyal.com</a>. Подробно — в <a href="https://docs.google.com/document/d/1uAbO8FUyic9PqdZ6Ohn1wsDW-xs4F_qPi0VJuyWJij0/edit?tab=t.0" target="_blank" rel="noopener noreferrer">инструкции</a>.</p>
  <p>После покупки скопируй тип, адрес, порт, логин и пароль в форму. Проверим, работает ли подключение, затем подготовим профили. Проверка занимает до 10 секунд; качество и страну здесь не оцениваем.</p>
  <p v-if="!canSetup" role="status">Сначала сохрани данные LinkedIn в шаге 1.</p>
  <OctoManualSetup v-else-if="status" :status="status" guided @queued="loggedIn=false;opened=false" />
  </details>
  <template v-if="canSetup">
   <details class="setup-step" data-testid="linkedin-step-3">
   <summary><h3>Шаг 3. Войди в LinkedIn через Octo</h3></summary>
   <p>Установи и открой Octo Browser. Нажми «Получить доступ» у EN-профиля. Войди в Octo по выданным почте и паролю аккаунта; затем открой профиль с пометкой EN, используя отдельный пароль профиля. В нём открой linkedin.com и войди в свой LinkedIn.</p>
   <OctoAccessCard :client-id="client.id" :setup-enabled="false" :proxy-editing-enabled="false" friendly-errors @status="status=$event" @access-issued="opened=true" />
   </details>
   <details class="setup-step" data-testid="linkedin-step-4">
   <summary><h3>Шаг 4. Подтверди подключение</h3></summary>
   <label class="checkpoint"><input v-model="loggedIn" type="checkbox" :disabled="!opened">Я успешно вошёл/вошла в LinkedIn через Octo</label>
   <p v-if="!opened">Сначала получи доступ к EN-профилю и войди в свой LinkedIn.</p>
   <button type="button" :disabled="!canConfirm" data-testid="linkedin-existing-confirm" @click="save('complete')">Подтвердить подключение</button>
   </details>
  </template>
  <p>Чтобы снизить риск блокировки, заходи в LinkedIn только через Octo на компьютере. Не включай двухфакторную защиту и не меняй пароль. Продлевай прокси вовремя: без него работа с профилем остановится.</p>
  <p>Не получилось? <a href="https://t.me/veu_support_bot" target="_blank" rel="noopener noreferrer">Напиши в поддержку</a> и пришли скриншот.</p>
  <Dialog v-model:visible="showSavedDialog" modal header="LinkedIn успешно подключён ✅" :draggable="false" :style="{width:'32rem',maxWidth:'calc(100vw - 2rem)'}" data-testid="linkedin-existing-saved-dialog">
   <p>Данные LinkedIn сохранены. Подключение через Octo подтверждено.</p>
   <template #footer><button type="button" autofocus @click="showSavedDialog=false">Понятно</button></template>
  </Dialog>
 </section>
</template>
<style scoped>
.setup-step{margin:20px 0;min-width:0}.setup-step>summary{cursor:pointer}.setup-step>summary h3{display:inline;margin:0}.setup-step[open]>summary{margin-bottom:16px}
.existing-setup{min-width:0}p{line-height:1.5}.credentials{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}label{display:grid;gap:6px;font-weight:600}input{width:100%;min-width:0;padding:10px;border:1px solid var(--p-content-border-color,#cbd5e1);border-radius:6px;font:inherit;background:var(--p-content-background,#fff);color:inherit}.password{grid-column:1/-1}.password span{display:flex;gap:8px;min-width:0}.password input{flex:1;min-width:120px}.checkpoint{display:flex;align-items:center;gap:8px}.checkpoint input{width:auto}button{padding:10px 14px;font:inherit;cursor:pointer;justify-self:start}button:disabled{opacity:.55;cursor:default}@media(max-width:640px){.credentials{grid-template-columns:minmax(0,1fr)}}
</style>
