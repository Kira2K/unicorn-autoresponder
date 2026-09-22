<script setup>
import { computed, ref, watch } from 'vue'
import LinkedInAutomation from './LinkedInAutomation.vue'
import LinkedInAutomationHistory from './LinkedInAutomationHistory.vue'
import LinkedInAccountActions from './LinkedInAccountActions.vue'
import LinkedInAuthStatus from './LinkedInAuthStatus.vue'
import LinkedInAuthHistory from './LinkedInAuthHistory.vue'
import ProfileFillerDialog from './ProfileFillerDialog.vue'
import PostWriterWorkspace from './PostWriterWorkspace.vue'
import { runForAccount } from './linkedin-auth-view'
import { automationOverview, automationFeatures, timeMsk } from './linkedin-automation-view'
import { useLinkedInAuth } from './use-linkedin-auth'
import { useProfileFiller } from './use-profile-filler'
import { useCommentMonitor } from './use-comment-monitor'
import { useConnectionInviter } from './use-connection-inviter'
import { useLinkedInAutomation } from './use-linkedin-automation'

const auth = useLinkedInAuth(), filler = useProfileFiller(), comments = useCommentMonitor(), connections = useConnectionInviter()
const automation = useLinkedInAutomation()
const busy = computed(() => auth.active.value || filler.busy.value)
const nocoWait = computed(() => Math.max(1, Math.ceil(Number(auth.nocoQueue.value.waitMs || 0) / 1000)))
const selected = ref([]), filter = ref('all'), view = ref('students'), focused = ref(null), panelTab = ref('status')
const calendarTargets = ref([]), editorKey = ref(0), historyAccount = ref(), historyRun = ref(''), mutationErrors = ref([])
const openedManualAccounts = ref(new Set())
watch([focused, panelTab], ([id, tab]) => {
  if (id && tab === 'manual') openedManualAccounts.value = new Set([...openedManualAccounts.value, id])
})
const manualAccounts = computed(() => auth.accounts.value.filter(a => openedManualAccounts.value.has(a.platformAccountId)))
const account = computed(() => auth.accounts.value.find(a => a.platformAccountId === focused.value))
const overview = id => automationOverview(id, automation.snapshot.value, automation.diagnostics.value, comments.now.value)
const allRows = computed(() => auth.accounts.value.map(a => ({ account: a, overview: overview(a.platformAccountId),
  attention: overview(a.platformAccountId).attention || Boolean(a.readinessErrorCode) || ['attention', 'error'].includes(a.state) ||
    ['failed'].includes(runForAccount(auth.runs.value, a)?.status) ||
    ['failed', 'uncertain'].includes(connections.runFor(a)?.status) || ['error', 'paused'].includes(comments.jobFor(a)?.status)
})))
const rows = computed(() => allRows.value.filter(r => auth.filtered.value.includes(r.account)).filter(r => filter.value === 'all' || (filter.value === 'attention' ? r.attention :
  filter.value === 'active' ? r.overview.active : filter.value === 'off' ? !r.overview.enabled :
    Boolean(r.account.unipileAccountId) && !r.account.readinessErrorCode))
  .sort((a, b) => Number(b.attention) - Number(a.attention) || a.account.clientName.localeCompare(b.account.clientName)))
const attentionCount = computed(() => allRows.value.filter(r => r.attention).length)
const healthy = computed(() => !automation.error.value && automation.diagnostics.value?.healthy &&
  comments.now.value - (automation.diagnostics.value?.worker?.at || 0) < 30000)
const detail = computed(() => account.value ? overview(account.value.platformAccountId) : null)
const connectionLabel = a => ({ connected: 'Подключён', attention: 'Требует внимания', error: 'Ошибка подключения', not_connected: 'Не подключён' }[a.state] || 'Не проверен')
const selectedNames = computed(() => auth.accounts.value.filter(a => selected.value.includes(a.platformAccountId)).map(a => a.clientName).join(', '))
function selectVisible() {
  const ids = rows.value.map(r => r.account.platformAccountId)
  selected.value = ids.every(id => selected.value.includes(id)) ? selected.value.filter(id => !ids.includes(id)) : [...new Set([...selected.value, ...ids])]
}
function openStudent(id) { focused.value = id; view.value = 'students'; panelTab.value = 'status'; calendarTargets.value = [] }
function openCalendar(ids) {
  if (!automation.snapshot.value || automation.busy.value) return
  calendarTargets.value = [...ids]; editorKey.value++; panelTab.value = 'calendar'
  if (ids.length === 1) focused.value = ids[0]
}
function closeCalendar() { calendarTargets.value = []; panelTab.value = 'status' }
function openHistory(id, key = '') { historyAccount.value = id; historyRun.value = key; view.value = 'history' }
async function toggle(ids, enabled) {
  mutationErrors.value = []
  if (enabled && ids.some(id => !overview(id).setting?.slots.length)) { openCalendar(ids); return }
  try { mutationErrors.value = (await automation.toggle(ids, enabled)).filter(r => !r.ok) } catch {}
}
function historyAction(run, action) {
  openStudent(Number(run.platformAccountId)); panelTab.value = 'manual'; auth.historyAction(run, action)
}
</script>
<template>
  <Card class="linkedin-auth-card" data-testid="linkedin-auth-tab">
    <template #title>LinkedIn</template>
    <template #subtitle>Ученики, расписание и результаты</template>
    <template #content>
      <div class="section-tabs" aria-label="Раздел LinkedIn">
        <button :aria-pressed="view === 'students'" @click="view = 'students'" data-testid="linkedin-students-view">Ученики</button>
        <button :aria-pressed="view === 'history'" @click="openHistory()" data-testid="linkedin-history-view">История и ошибки</button>
        <PostWriterWorkspace />
      </div>
      <div class="worker-bar">
        <span v-if="automation.snapshot.value" :class="{ warning: !healthy }">{{ healthy ? 'Исполнитель на связи' : 'Работа исполнителя не подтверждена' }}<small>Последняя связь: {{ timeMsk(automation.diagnostics.value?.worker?.at) }} · МСК</small></span>
        <span v-else class="muted">{{ automation.error.value || 'Проверяю автоматизацию…' }}</span>
        <Button label="Обновить статус" size="small" severity="secondary" outlined :disabled="automation.busy.value" @click="automation.refresh" />
      </div>
      <Message v-if="automation.snapshot.value?.previewOnly" severity="info" :closable="false">Предварительный просмотр: автоматические отправки отключены на этом backend.</Message>
      <Message v-if="automation.error.value && automation.snapshot.value" severity="warn" :closable="false">{{ automation.error.value }} Показаны последние полученные данные.</Message>
      <Message v-if="auth.nocoQueue.value.state === 'cooldown'" severity="warn" :closable="false">Достигнут лимит Noco. Очередь продолжится через {{ nocoWait }} с.</Message>
      <Message v-else-if="auth.nocoQueue.value.state === 'queued'" severity="info" :closable="false">Очередь Noco: {{ auth.nocoQueue.value.waiting }} запросов, следующий через {{ nocoWait }} с.</Message>
      <Message v-if="auth.error.value" severity="error" :closable="false" data-testid="linkedin-page-error">{{ auth.error.value }}</Message>
      <Message v-if="comments.errors.value.page" severity="error" :closable="false" data-testid="comment-monitor-page-error">{{ comments.errors.value.page }}</Message>
      <Message v-if="connections.errors.value.page" severity="error" :closable="false" data-testid="connection-inviter-page-error">{{ connections.errors.value.page }}</Message>
      <p v-if="automation.notice.value" role="status">{{ automation.notice.value }}</p>
      <p v-for="r in mutationErrors" :key="r.account" class="error" role="alert">{{ auth.accounts.value.find(a => a.platformAccountId === r.account)?.clientName }}: {{ r.error }}</p>
      <div v-show="view === 'students'">
        <div class="student-toolbar">
          <InputText v-model="auth.query.value" placeholder="Найти ученика, аккаунт или ошибку" data-testid="linkedin-search" />
          <select v-model="filter" aria-label="Фильтр аккаунтов"><option value="all">Все ученики</option><option value="attention">Требуют внимания</option><option value="active">Выполняются автозапуски</option><option value="off">Автоматизация выключена</option><option value="ready">Подключены</option></select>
          <span class="muted">Найдено: {{ rows.length }}</span>
        </div>
        <div v-if="selected.length" class="bulk-bar">
          <div><strong>Выбрано: {{ selected.length }}</strong><small>{{ selectedNames }}</small></div>
          <div class="actions"><Button label="Общее расписание" size="small" :disabled="!automation.snapshot.value || automation.busy.value || !!automation.error.value" @click="openCalendar(selected)" /><Button label="Выключить выбранных" size="small" severity="secondary" outlined :disabled="!automation.snapshot.value || automation.busy.value || !!automation.error.value" @click="toggle(selected, false)" /><Button label="Снять выбор" size="small" severity="secondary" text :disabled="automation.busy.value" @click="selected = []" /></div>
        </div>
        <ProgressSpinner v-if="auth.loading.value" class="linkedin-spinner" stroke-width="4" />
        <div class="student-workspace" :class="{ 'with-panel': account || calendarTargets.length }">
          <section class="student-list" aria-label="Ученики LinkedIn" data-testid="linkedin-accounts-table">
            <div class="student-row column-head"><label><input type="checkbox" aria-label="Выбрать видимых учеников" :checked="rows.length > 0 && rows.every(r => selected.includes(r.account.platformAccountId))" @change="selectVisible"> Ученик / аккаунт</label><span>Автозапуски / результат</span><span>Следующее · МСК</span><span>Авто</span></div>
            <div v-for="{ account: a, overview: state, attention } in rows" :key="a.platformAccountId" class="student-row" :class="{ focused: focused === a.platformAccountId }" :data-testid="'linkedin-account-' + a.platformAccountId">
              <div class="student-name"><input type="checkbox" v-model="selected" :value="a.platformAccountId" :aria-label="'Выбрать ' + a.clientName"><div><button class="name-button" :data-testid="'linkedin-open-' + a.platformAccountId" @click="openStudent(a.platformAccountId)">{{ a.clientName }}</button><small :class="{ error: attention }">{{ connectionLabel(a) }} · #{{ a.platformAccountId }}</small></div></div>
              <div class="student-current"><span :class="{ error: state.attention }">{{ state.current }}</span><small v-if="state.description">{{ state.description }}</small><button v-if="state.attention" class="text-button" @click="openHistory(a.platformAccountId, state.run?.key)">Открыть ошибку</button></div>
              <div class="student-next">{{ state.next }}<small v-if="state.monitor && state.enabled">Комментарии: монитор включён</small></div>
              <label class="auto-switch"><input type="checkbox" :checked="state.enabled" :aria-label="'Автоматизация: ' + a.clientName" :disabled="!automation.snapshot.value || automation.busy.value || !!automation.error.value" @change="toggle([a.platformAccountId], $event.target.checked)"></label>
            </div>
            <p v-if="!rows.length && !auth.loading.value" class="empty">Ученики по выбранному фильтру не найдены.</p>
            <div class="list-footer">Требуют внимания: {{ attentionCount }} · Нажмите на ученика, чтобы открыть настройки и ручные действия.</div>
          </section>
          <aside v-show="account || calendarTargets.length" class="student-panel" data-testid="linkedin-student-panel">
            <div class="panel-head"><div><h3>{{ calendarTargets.length > 1 ? 'Общее расписание' : account?.clientName }}</h3><small v-if="account && calendarTargets.length <= 1">{{ connectionLabel(account) }}</small></div><button aria-label="Закрыть подробности" :disabled="automation.busy.value" @click="focused = null; closeCalendar()">×</button></div>
            <nav v-if="account && calendarTargets.length <= 1" class="section-tabs panel-tabs" aria-label="Настройки ученика"><button :aria-pressed="panelTab === 'status'" @click="closeCalendar()">Состояние</button><button :aria-pressed="panelTab === 'calendar'" :disabled="!automation.snapshot.value || automation.busy.value || !!automation.error.value" @click="openCalendar([account.platformAccountId])">Расписание</button><button :aria-pressed="panelTab === 'manual'" @click="calendarTargets = []; panelTab = 'manual'" data-testid="linkedin-manual-tab">Вручную</button></nav>
            <div class="panel-content">
              <div v-if="account && panelTab === 'status'" class="status-content">
                <LinkedInAuthStatus :account="account" :run="runForAccount(auth.runs.value, account)" />
                <label class="check"><input type="checkbox" :checked="detail.enabled" :disabled="!automation.snapshot.value || automation.busy.value || !!automation.error.value" @change="toggle([account.platformAccountId], $event.target.checked)"> Автоматизация включена</label>
                <div :class="{ 'problem-box': detail.attention }"><strong>{{ detail.current }}</strong><p v-if="detail.description">{{ detail.description }}</p><button v-if="detail.run" @click="openHistory(account.platformAccountId, detail.run.key)">Журнал этого запуска</button></div>
                <p>{{ detail.next }}</p>
                <small>Фичи расписания: {{ detail.features.map(f => automationFeatures[f]).join(', ') || 'не выбраны' }}</small>
                <Button label="Изменить расписание" size="small" :disabled="!automation.snapshot.value || automation.busy.value || !!automation.error.value" @click="openCalendar([account.platformAccountId])" />
                <details><summary>Будущие автозапуски · {{ detail.upcoming.length }}</summary><div v-for="r in detail.upcoming" :key="r.key" class="upcoming-run">{{ automationFeatures[r.feature] }} · {{ timeMsk(r.plannedAt) }}<small>{{ r.description }}</small></div></details>
                <Button label="История ученика" size="small" severity="secondary" outlined @click="openHistory(account.platformAccountId)" />
              </div>
              <LinkedInAutomation v-if="panelTab === 'calendar' && calendarTargets.length" :key="editorKey" :accounts="auth.accounts.value" :selected="calendarTargets" :automation="automation" @close="closeCalendar" @saved="closeCalendar" />
              <!-- Load details only when opened; retain visited panels so active dialogs and observers survive navigation. -->
              <LinkedInAccountActions v-for="a in manualAccounts" :key="a.platformAccountId" v-show="panelTab === 'manual' && focused === a.platformAccountId" :account="a" :auth="auth" :filler="filler" :comments="comments" :connections="connections" :busy="busy" />
            </div>
          </aside>
        </div>
      </div>
      <div v-if="view === 'history'" class="history-view">
        <LinkedInAutomationHistory v-if="automation.snapshot.value" :accounts="auth.accounts.value" :diagnostics="automation.diagnostics.value" :initial-account="historyAccount" :initial-run="historyRun" @student="openStudent" />
        <details class="auth-history"><summary>История подключений аккаунтов</summary><LinkedInAuthHistory :runs="auth.history.value.filter(r => !historyAccount || Number(r.platformAccountId) === historyAccount)" :accounts="auth.accounts.value" :busy="busy" @action="historyAction" /></details>
      </div>
    </template>
  </Card>
  <ProfileFillerDialog v-if="filler.selected.value" :key="filler.selected.value.account.value?.platformAccountId" :filler="filler.selected.value" />
</template>
<style scoped>
.section-tabs{display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--p-content-border-color)}.section-tabs>button{background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:12px 2px;color:var(--p-text-muted-color)}.section-tabs>button[aria-pressed=true]{color:var(--p-primary-color);border-bottom-color:var(--p-primary-color)}.worker-bar,.student-toolbar,.bulk-bar,.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.worker-bar{justify-content:space-between;padding:14px 0}.student-toolbar{margin:18px 0}.student-toolbar>input{flex:1;min-width:180px}.bulk-bar{justify-content:space-between;background:var(--p-highlight-background);padding:12px;border-radius:8px;margin-bottom:12px}.bulk-bar>div:first-child{flex:1;min-width:180px}.student-workspace{display:grid;gap:16px;align-items:start}.student-workspace.with-panel{grid-template-columns:minmax(0,1fr) 400px}.student-list,.student-panel{border:1px solid var(--p-content-border-color);border-radius:9px;min-width:0;background:var(--p-content-background)}.student-row{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(150px,1fr) minmax(135px,.8fr) 42px;gap:12px;padding:16px 12px;border-top:1px solid var(--p-content-border-color);align-items:start}.column-head{border:0;font-size:12px;color:var(--p-text-muted-color);padding-top:10px;padding-bottom:10px}.column-head label,.student-name{display:flex;align-items:flex-start;gap:8px}.student-name input{margin-top:4px}.focused{background:var(--p-highlight-background)}button,select{font:inherit;border:1px solid var(--p-content-border-color);border-radius:6px;padding:8px;background:var(--p-content-background);color:inherit;max-width:100%}button,summary{cursor:pointer}button:disabled{opacity:.5;cursor:default}input[type=checkbox]{width:17px;height:17px;accent-color:var(--p-primary-color);flex-shrink:0}.name-button,.text-button{border:0;padding:0;background:transparent;text-align:left;color:var(--p-primary-color);overflow-wrap:anywhere}.name-button{font-weight:600}.text-button{font-size:13px;margin-top:6px}small{display:block;font-size:12px;color:var(--p-text-muted-color);margin-top:5px;overflow-wrap:anywhere}.muted{color:var(--p-text-muted-color)}.error{color:var(--p-red-600)}.warning{color:var(--p-orange-700)}.list-footer,.empty{padding:14px;font-size:13px;color:var(--p-text-muted-color);border-top:1px solid var(--p-content-border-color)}.panel-head{display:flex;justify-content:space-between;gap:10px;padding:16px}.panel-head h3{margin:0;font-size:18px}.panel-head>button{border:0;background:transparent;padding:3px 8px}.panel-tabs{padding:0 16px}.panel-content{padding:16px}.status-content{display:grid;gap:16px}.status-content p{margin:8px 0;line-height:1.5}.check{display:flex;align-items:center;gap:8px}.problem-box{border-left:3px solid var(--p-red-500);padding-left:12px}.problem-box strong{color:var(--p-red-600)}.upcoming-run{padding:10px 0;border-bottom:1px solid var(--p-content-border-color)}.history-view{display:grid;gap:24px;padding-top:16px}.auth-history{padding-top:16px;border-top:1px solid var(--p-content-border-color)}
@media(max-width:1250px){.student-workspace.with-panel{grid-template-columns:1fr}.student-panel{width:100%}}
@media(max-width:680px){.student-row{grid-template-columns:minmax(0,1fr) 42px;gap:8px}.column-head>span{display:none}.column-head>label{grid-column:1/-1}.student-name{grid-row:1;grid-column:1}.auto-switch{grid-column:2;grid-row:1}.student-current{grid-column:1;grid-row:2}.student-next{grid-column:1;grid-row:3;font-size:13px}.student-toolbar>input,.student-toolbar>select{width:100%;flex-basis:100%}.section-tabs{gap:12px}.panel-content{padding:12px}}
</style>
