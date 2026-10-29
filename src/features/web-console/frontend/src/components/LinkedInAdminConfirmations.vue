<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue'
import {request} from '../octo-api.js'
const base='/api/admin/linkedin-creation/tasks'
const tasks=ref([]),selected=ref(null),profiles=ref([]),busy=ref(false),loading=ref(false),detailLoading=ref(false),error=ref(''),unknown=ref(false),showProxyPassword=ref(false)
const controller=new AbortController()
let timer,selection=0
const crmResults=new Map()
function rememberCrm(detail){
 if(detail.crm)crmResults.set(detail.task.id,detail.crm)
 const crm=crmResults.get(detail.task.id)
 return {...detail,...(crm?{crm}:{})}
}
const visibleTasks=computed(()=>tasks.value.filter(t=>['сделана экспертом','выполнение подтверждено'].includes(t.status))
  .sort((a,b)=>Number(a.status==='выполнение подтверждено')-Number(b.status==='выполнение подтверждено')||b.id-a.id))
const confirmed=computed(()=>selected.value?.task.status==='выполнение подтверждено')
const canConfirm=computed(()=>!busy.value&&!detailLoading.value&&!unknown.value&&selected.value?.task.status==='сделана экспертом'&&
  !!selected.value.task.proxySavedAt&&profiles.value.some(p=>p.id===selected.value.task.proxyProfileId&&p.phase==='ready'&&p.proxy?.configured&&p.canEditProxy))
const notification=computed(()=>{
 const n=selected.value?.notification
 if(!confirmed.value)return ''
 if(n?.state==='sent'&&Number(n.messageId)>0)return `Уведомление отправлено. Сообщение №${n.messageId}.`
 if(n?.state==='failed')return 'Заявка подтверждена, но уведомление не отправлено. Не подтверждай заявку повторно.'
 if(['uncertain','attempting'].includes(n?.state))return 'Заявка подтверждена. Доставка уведомления пока не подтверждена; повторять подтверждение не нужно.'
 return 'Заявка подтверждена. Ожидаем отправки уведомления.'
})
function failure(e){
 if(e.message==='commit_uncertain')return 'Результат подтверждения неизвестен. Перечитай заявку перед следующим действием.'
 if(e.message==='linkedin_task_stale_version')return 'Заявка изменилась. Перечитай её перед подтверждением.'
 if(e.message==='linkedin_task_not_confirmable')return 'Подтвердить можно только заявку со статусом «сделана экспертом».'
 if(/proxy|profile/.test(e.message))return 'Проверь актуальный прокси и дождись штатного закрытия профиля Octo.'
 return 'Не удалось проверить заявку. Повтори чтение; подтверждение автоматически не повторяется.'
}
async function load(){
 loading.value=true;error.value=''
 try{tasks.value=await request(base,{signal:controller.signal})}catch(e){if(e.name!=='AbortError')error.value=failure(e)}finally{loading.value=false}
}
async function open(id){
 const current=++selection;error.value='';showProxyPassword.value=false;detailLoading.value=true;selected.value=null;profiles.value=[]
 try{
  const [detail,status]=await Promise.all([request(`${base}/${id}`,{signal:controller.signal}),request(`${base}/${id}/octo/status?proxyCredentials=1`,{signal:controller.signal})])
  if(current!==selection||controller.signal.aborted)return
  selected.value=rememberCrm(detail);profiles.value=status.profiles;unknown.value=false
 }catch(e){if(current===selection&&e.name!=='AbortError')error.value=failure(e)}finally{if(current===selection)detailLoading.value=false}
}
async function confirm(){
 if(!canConfirm.value)return
 busy.value=true;error.value=''
 const id=selected.value.task.id
 try{selected.value=rememberCrm(await request(`${base}/${id}/confirm`,{method:'POST',body:JSON.stringify({version:selected.value.task.version}),signal:controller.signal}));await load()}
 catch(e){if(e.name!=='AbortError'){unknown.value=true;error.value=failure(e)}}finally{busy.value=false}
}
onMounted(()=>{load();timer=setInterval(async()=>{
 if(document.hidden||busy.value||!selected.value||!confirmed.value||['sent','failed','uncertain'].includes(selected.value.notification?.state))return
 const id=selected.value.task.id,current=selection
 try{const detail=await request(`${base}/${id}`,{signal:controller.signal});if(current===selection&&!controller.signal.aborted)selected.value=rememberCrm(detail)}catch{/* Polling never repeats confirmation. */}
},2000)})
onUnmounted(()=>{clearInterval(timer);controller.abort();profiles.value=[]})
</script>
<template>
 <section class="admin-confirmations" data-testid="linkedin-admin-confirmations" aria-labelledby="admin-confirmations-title">
  <h2 id="admin-confirmations-title">Подтверждение заявок LinkedIn</h2>
  <button type="button" :disabled="loading||busy" @click="load">Обновить заявки</button>
  <p v-if="loading" role="status">Загружаем заявки…</p><p v-if="error" role="alert">{{ error }}</p>
  <p v-if="detailLoading" role="status">Проверяем выбранную заявку…</p>
  <p v-if="!loading&&!visibleTasks.length">Нет заявок, ожидающих подтверждения.</p>
  <div class="confirmation-layout">
   <nav aria-label="Заявки на подтверждение">
    <button v-for="task in visibleTasks" :key="task.id" type="button" :disabled="busy" :aria-pressed="selected?.task.id===task.id" :data-testid="`admin-creation-task-${task.id}`" @click="open(task.id)">
     №{{ task.id }} · {{ task.fio }} — {{ task.status }}
    </button>
   </nav>
   <article v-if="selected" data-testid="admin-creation-task-detail">
    <h3>{{ selected.client.fio }} · заявка №{{ selected.task.id }}</h3>
    <dl>
     <dt>Статус</dt><dd data-testid="admin-creation-status">{{ selected.task.status }}</dd>
     <dt>Ссылка LinkedIn</dt><dd>{{ selected.intake.url||'Не сохранена' }}</dd>
     <dt>Логин LinkedIn</dt><dd>{{ selected.intake.login||'Не сохранён' }}</dd>
     <dt>Пароль LinkedIn</dt><dd>{{ selected.intake.hasPassword?'Сохранён':'Не сохранён' }}</dd>
     <dt>Почта Outlook</dt><dd>{{ selected.intake.outlookLogin }}</dd>
     <dt>Дата и время регистрации Outlook</dt><dd>{{ selected.intake.outlookRegisteredAt?new Date(selected.intake.outlookRegisteredAt).toLocaleString():'Не указаны' }}</dd>
    </dl>
    <section v-for="profile in profiles" :key="profile.id" class="admin-proxy">
     <h4>Прокси EN-профиля №{{ profile.id }}</h4>
     <p v-if="profile.proxy?.configured">Прокси настроен</p><p v-else>Прокси не настроен</p>
     <template v-if="profile.proxy?.credentialsLoaded">
      <p>{{ profile.proxy.type }} · {{ profile.proxy.host }}:{{ profile.proxy.port }}</p>
      <label>Логин прокси<input :value="profile.proxy.login" readonly autocomplete="off"></label>
      <label>Пароль прокси<input :value="profile.proxy.password" :type="showProxyPassword?'text':'password'" readonly autocomplete="off"></label>
      <button type="button" @click="showProxyPassword=!showProxyPassword">{{ showProxyPassword?'Скрыть пароль':'Показать пароль' }}</button>
     </template>
     <p v-else-if="profile.proxy?.credentialsError" role="alert">Не удалось прочитать реквизиты из Octo.</p>
    </section>
    <button v-if="!confirmed" type="button" :disabled="!canConfirm" data-testid="admin-confirm-creation" @click="confirm">{{ busy?'Подтверждаем…':'Подтвердить выполнение' }}</button>
    <button type="button" :disabled="busy" @click="open(selected.task.id)">Перечитать результат</button>
    <p v-if="notification" role="status" data-testid="admin-confirmation-notification">{{ notification }}</p>
    <p v-if="confirmed&&selected.crm&&selected.crm.state!=='not_applicable'" role="status" data-testid="admin-confirmation-crm">{{ selected.crm.state==='sent'?'Команда замены передана в CRM.':'Заявка подтверждена, но передачу в CRM подтвердить не удалось. Не подтверждай заявку повторно.' }}</p>
   </article>
  </div>
 </section>
</template>
<style scoped>
.admin-confirmations{padding:24px;background:var(--p-content-background,#fff);border:1px solid #dbe3ee;border-radius:12px;margin-bottom:24px}.confirmation-layout{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2fr);gap:20px;margin-top:16px}nav,article,.admin-proxy{display:grid;gap:12px;align-content:start;min-width:0}nav button{text-align:left}button,input{font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:6px;max-width:100%;box-sizing:border-box}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}dt{font-weight:600}dd{margin:4px 0 12px;overflow-wrap:anywhere}label{display:grid;gap:6px}.admin-proxy{padding:12px;border:1px solid #dbe3ee;border-radius:8px}h4,p{margin:0}button[data-testid=admin-confirm-creation]{background:#10b981;color:white}@media(max-width:760px){.confirmation-layout{grid-template-columns:minmax(0,1fr)}}
</style>
