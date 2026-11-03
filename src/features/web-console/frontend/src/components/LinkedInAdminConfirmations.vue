<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue'
import {request} from '../octo-api.js'
const base='/api/admin/linkedin-creation/tasks'
const tasks=ref([]),selected=ref(null),loading=ref(false),detailLoading=ref(false),error=ref('')
const profiles=ref([]),proxyError=ref(''),showProxyPassword=ref(false)
const controller=new AbortController()
let timer,selection=0
const visibleTasks=computed(()=>tasks.value.filter(t=>t.status==='сделана экспертом').sort((a,b)=>b.id-a.id))
const deliveries=computed(()=>selected.value?.notification?.deliveries??[])
function deliveryText(delivery){
 if(delivery.state==='sent')return `Отправлено. Сообщение №${delivery.messageId}.`
 if(delivery.errorCode==='recipient_missing')return 'Не отправлено: не указан учебный чат ученика.'
 if(delivery.state==='failed')return 'Не отправлено. Заявка завершена; повторять завершение не нужно.'
 if(['uncertain','attempting'].includes(delivery.state))return 'Доставка не подтверждена; автоматического повтора нет.'
 return 'Ожидает отправки.'
}
async function load(){
 loading.value=true;error.value=''
 try{tasks.value=await request(base,{signal:controller.signal})}
 catch(e){if(e.name!=='AbortError')error.value='Не удалось загрузить заявки.'}
 finally{loading.value=false}
}
async function open(id){
 const current=++selection;detailLoading.value=true;error.value='';selected.value=null;profiles.value=[];proxyError.value=''
 try{
  const detail=await request(`${base}/${id}`,{signal:controller.signal});if(current!==selection)return
  selected.value=detail
  try{const status=await request(`${base}/${id}/octo/status?proxyCredentials=1`,{signal:controller.signal});if(current===selection)profiles.value=status.profiles??[]}
  catch(e){if(current===selection&&e.name!=='AbortError')proxyError.value='Не удалось прочитать реквизиты прокси из Octo.'}
 }
 catch(e){if(e.name!=='AbortError'&&current===selection)error.value='Не удалось прочитать заявку.'}
 finally{if(current===selection)detailLoading.value=false}
}
onMounted(()=>{load();timer=setInterval(async()=>{
 if(document.hidden||!selected.value||!deliveries.value.some(d=>['pending','attempting'].includes(d.state)))return
 const id=selected.value.task.id,current=selection
 try{const detail=await request(`${base}/${id}`,{signal:controller.signal});if(current===selection&&!controller.signal.aborted)selected.value=detail}catch{/* Read-only delivery polling. */}
},2000)})
onUnmounted(()=>{clearInterval(timer);controller.abort();profiles.value=[]})
</script>
<template>
 <section class="task-history" data-testid="linkedin-admin-confirmations" aria-labelledby="admin-history-title">
  <h2 id="admin-history-title">Завершённые заявки LinkedIn</h2>
  <button type="button" :disabled="loading" @click="load">Обновить заявки</button>
  <p v-if="loading" role="status">Загружаем заявки…</p><p v-if="error" role="alert">{{ error }}</p>
  <p v-if="detailLoading" role="status">Загружаем выбранную заявку…</p>
  <p v-if="!loading&&!visibleTasks.length">Нет завершённых заявок.</p>
  <div class="history-layout">
   <nav aria-label="Завершённые заявки">
    <button v-for="task in visibleTasks" :key="task.id" type="button" :aria-pressed="selected?.task.id===task.id" :data-testid="`admin-creation-task-${task.id}`" @click="open(task.id)">№{{ task.id }} · {{ task.fio }} — {{ task.status }}</button>
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
    <p v-if="proxyError" role="alert">{{ proxyError }}</p>
    <section v-for="profile in profiles" :key="profile.id">
     <h4>Прокси EN-профиля №{{ profile.id }}</h4>
     <p>{{ profile.proxy?.configured?'Прокси настроен':'Прокси не настроен' }}</p>
     <template v-if="profile.proxy?.credentialsLoaded">
      <p>{{ profile.proxy.type }} · {{ profile.proxy.host }}:{{ profile.proxy.port }}</p>
      <label>Логин прокси<input :value="profile.proxy.login" readonly autocomplete="off"></label>
      <label>Пароль прокси<input :value="profile.proxy.password" :type="showProxyPassword?'text':'password'" readonly autocomplete="off"></label>
      <button type="button" @click="showProxyPassword=!showProxyPassword">{{ showProxyPassword?'Скрыть пароль':'Показать пароль' }}</button>
     </template>
     <p v-else-if="profile.proxy?.credentialsError" role="alert">Не удалось прочитать реквизиты из Octo.</p>
    </section>
    <div data-testid="admin-completion-deliveries" role="status">
     <p v-for="delivery in deliveries" :key="delivery.recipient">{{ delivery.recipient==='student'?'Ученику':'Ботоотчёты' }}: {{ deliveryText(delivery) }}</p>
     <p v-if="!deliveries.length">Историческая заявка: записей доставки нет.</p>
    </div>
    <button type="button" @click="open(selected.task.id)">Перечитать результат</button>
   </article>
  </div>
 </section>
</template>
<style scoped>
.task-history{padding:24px;background:var(--p-content-background,#fff);border:1px solid #dbe3ee;border-radius:12px;margin-bottom:24px}.history-layout{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2fr);gap:20px;margin-top:16px}nav,article,label{display:grid;gap:12px;align-content:start;min-width:0}nav button{text-align:left}button,input{font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:6px;max-width:100%;box-sizing:border-box}button{cursor:pointer}button:disabled{opacity:.5}dt{font-weight:600}dd{margin:4px 0 12px;overflow-wrap:anywhere}@media(max-width:760px){.history-layout{grid-template-columns:minmax(0,1fr)}}
</style>
