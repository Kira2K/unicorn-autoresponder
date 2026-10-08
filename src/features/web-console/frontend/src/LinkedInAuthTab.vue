<script setup>
import { computed, ref } from 'vue'
import LinkedInAuthStatus from './LinkedInAuthStatus.vue'
import LinkedInAuthHistory from './LinkedInAuthHistory.vue'
import ProfileFillerDialog from './ProfileFillerDialog.vue'
import ProfileFillerAccountAction from './ProfileFillerAccountAction.vue'
import CommentMonitorCell from './CommentMonitorCell.vue'
import ConnectionInviterCell from './ConnectionInviterCell.vue'
import PostWriterCell from './PostWriterCell.vue'
import PostWriterWorkspace from './PostWriterWorkspace.vue'
import LinkedInSchedule from './LinkedInSchedule.vue'
import LinkedInAutomationLog from './LinkedInAutomationLog.vue'
import { formatDate, primaryAction, runForAccount } from './linkedin-auth-view'
import { useLinkedInAuth } from './use-linkedin-auth'
import { useProfileFiller } from './use-profile-filler'
import { useCommentMonitor } from './use-comment-monitor'
import { useConnectionInviter } from './use-connection-inviter'
import { useLinkedInAutomation } from './use-linkedin-automation'
import { accountSummary, connectionNames, dateMsk, featureNames, stateNames, reasonText, apiError, nextWindow, canResumeTask } from './linkedin-automation-view'
import { engagementLabels } from './post-writer-view'
const auth = useLinkedInAuth(), filler = useProfileFiller(), comments = useCommentMonitor(), connections = useConnectionInviter()
const automation = useLinkedInAutomation(), tab = ref('students'), filter = ref('all'), selection = ref([]), selectedId = ref(null)
const postResult = task => automation.status.value.postResults?.[task.runId]
const panel = ref('status'), bulk = ref(false), editor = ref(), feedback = ref(''), actionError = ref(''), logAccount = ref()
const busy = computed(() => auth.active.value || filler.busy.value)
const nocoWait = computed(() => Math.max(1, Math.ceil(Number(auth.nocoQueue.value.waitMs || 0) / 1000)))
const summaries = computed(() => new Map(auth.accounts.value.map(a => [a.platformAccountId, accountSummary(a, automation.status.value)])))
const summary = account => summaries.value.get(account.platformAccountId)
const filtered = computed(() => auth.filtered.value.filter(a => filter.value === 'all' ||
  (filter.value === 'enabled' && summary(a).schedule?.enabled) || (filter.value === 'attention' && summary(a).attention) ||
  (filter.value === 'connected' && a.state === 'connected')))
const selected = computed(() => auth.accounts.value.find(a => a.platformAccountId === selectedId.value))
const chosen = computed(() => auth.accounts.value.filter(a => selection.value.includes(a.platformAccountId)))
const allChecked = computed(() => filtered.value.length > 0 && filtered.value.every(a => selection.value.includes(a.platformAccountId)))
const panelAccounts = computed(() => bulk.value ? chosen.value : selected.value ? [selected.value] : [])
const schedule = computed(() => bulk.value ? undefined : selected.value && summary(selected.value).schedule)
const resumable = computed(() => selected.value ? summary(selected.value).tasks.filter(task =>
  canResumeTask(task, schedule.value)) : [])
const backendStatus = computed(() => {
  if (automation.error.value) return automation.error.value
  const s = automation.status.value
  if (!automation.loadedAt.value) return 'Проверяем исполнителя…'
  if (!s.available) return s.error?.message || 'Исполнитель пока недоступен. Новые отправки приостановлены.'
  if (s.isOwner) return 'Исполнитель на связи'
  return s.owner?.until > Date.now() ? 'Расписание выполняется другим backend. Здесь доступен просмотр.' : 'Работа исполнителя не подтверждена. Новые отправки приостановлены.'
})
function canLeave() { return !editor.value?.dirty || window.confirm('Есть несохранённое расписание. Закрыть без сохранения?') }
function open(account, target = 'status') {
  if (!canLeave()) return
  selectedId.value = account.platformAccountId; bulk.value = false; panel.value = target; feedback.value = ''; actionError.value = ''
}
function openBulk() { if (canLeave()) { bulk.value = true; panel.value = 'schedule'; feedback.value = ''; actionError.value = '' } }
function close() { if (canLeave()) { selectedId.value = null; bulk.value = false } }
function showTab(value) { if (canLeave()) { tab.value = value; selectedId.value = null; bulk.value = false } }
function changePanel(value) { if (canLeave()) panel.value = value }
function selectAll(event) {
  const ids = filtered.value.map(a => a.platformAccountId)
  selection.value = event.target.checked ? [...new Set([...selection.value, ...ids])] : selection.value.filter(id => !ids.includes(id))
}
async function toggle(account) {
  const saved = summary(account).schedule
  if (!saved?.slots.length || (!saved.enabled && saved.slots.some(s => s.features.includes('posts')))) { open(account, 'schedule'); return }
  if (!window.confirm(`${saved.enabled ? 'Выключить автоматизацию' : 'Включить автоматизацию'}: ${account.clientName}?`)) return
  actionError.value = ''; feedback.value = ''
  try { await automation.save(account.platformAccountId, { enabled: !saved.enabled, version: saved.version, slots: saved.slots }); feedback.value = 'Изменение сохранено.' }
  catch (error) { actionError.value = apiError(error) }
}
async function resume(task) {
  actionError.value = ''
  try { await automation.resume(task.id); feedback.value = 'Продолжение разрешено. Сохранённые отправки не повторяются.' }
  catch (error) { actionError.value = apiError(error) }
}
async function resumeAll() {
  actionError.value = ''; feedback.value = ''
  const results = await automation.resumeAll(resumable.value.map(task => task.id))
  if (!results) return
  feedback.value = `Продолжено задач: ${results.filter(r => r.ok).length}. Очередь, квоты и паузы сохранены.`
  actionError.value = results.filter(r => !r.ok).map(r => r.error).join(' ')
}
function historyAction(run, action) {
  const account = auth.accounts.value.find(a => a.platformAccountId === Number(run.platformAccountId))
  if (account) { tab.value = 'students'; open(account, 'manual'); auth.historyAction(run, action) }
}
function openLog(account) { if (canLeave()) { logAccount.value = account?.platformAccountId; tab.value = 'history'; selectedId.value = null; bulk.value = false } }
</script>
<template>
  <Card class="linkedin-auth-card console" data-testid="linkedin-auth-tab">
    <template #title>LinkedIn</template><template #subtitle>Ученики, расписание и результаты</template>
    <template #content>
      <div class="top-tabs"><button :class="{ active: tab === 'students' }" @click="showTab('students')">Ученики</button>
        <button :class="{ active: tab === 'history' }" @click="showTab('history')" data-testid="automation-history-tab">История и ошибки</button><PostWriterWorkspace /></div>
      <div class="runtime-status"><div><strong :class="{ warn: !automation.writable.value }" data-testid="automation-runtime-status">{{ backendStatus }}</strong>
        <small v-if="automation.loadedAt.value">Последняя проверка: {{ dateMsk(automation.loadedAt.value) }} · МСК<span v-if="automation.error.value"> · данные могли устареть</span></small></div>
        <Button label="Обновить статус" size="small" outlined :loading="automation.loading.value" @click="automation.refresh" /></div>
      <Message v-if="actionError" severity="error" :closable="false">{{ actionError }}</Message>
      <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>
      <Message v-if="auth.error.value" severity="error" :closable="false" data-testid="linkedin-page-error">{{ auth.error.value }}
        <Button label="Повторить загрузку" text @click="auth.load" /></Message>
      <template v-if="tab === 'history'">
        <details open class="log-box"><summary>Журнал автоматизации</summary><LinkedInAutomationLog :accounts="auth.accounts.value" :initial-account="logAccount" /></details>
        <details class="log-box"><summary>Подключения аккаунтов</summary><LinkedInAuthHistory :runs="auth.filteredHistory.value" :accounts="auth.accounts.value" :busy="busy" @action="historyAction" /></details>
      </template>
      <template v-else>
        <div class="search"><InputText v-model="auth.query.value" placeholder="Найти ученика, ID или аккаунт" data-testid="linkedin-search" />
          <select v-model="filter" aria-label="Фильтр учеников"><option value="all">Все ученики</option><option value="enabled">Автоматизация включена</option>
            <option value="attention">Нужно внимание</option><option value="connected">Подключённые</option></select><small>Найдено: {{ filtered.length }}</small></div>
        <div v-if="chosen.length" class="selection"><span>Выбрано: {{ chosen.length }}</span><Button label="Настроить выбранных" size="small" :disabled="!automation.writable.value" @click="openBulk" data-testid="automation-bulk" />
          <button @click="selection = []" :disabled="bulk">Снять выбор</button></div>
        <ProgressSpinner v-if="auth.loading.value && !auth.accounts.value.length" class="linkedin-spinner" stroke-width="4" />
        <div class="workspace" :class="{ expanded: panelAccounts.length }">
          <div class="list-wrap"><table class="students" data-testid="linkedin-accounts-table"><thead><tr>
            <th><input type="checkbox" aria-label="Выбрать всех найденных" :checked="allChecked" :disabled="bulk" @change="selectAll" /></th>
            <th>Ученик / аккаунт</th><th>Автозапуски / результат</th><th>Следующее · МСК</th><th>Авто</th></tr></thead>
            <tbody><tr v-for="account in filtered" :key="account.platformAccountId" :data-testid="`linkedin-account-${account.platformAccountId}`" :class="{ selected: selectedId === account.platformAccountId && !bulk }">
              <td><input v-model="selection" type="checkbox" :value="account.platformAccountId" :disabled="bulk" :aria-label="`Выбрать ${account.clientName}`" :data-testid="`automation-select-${account.platformAccountId}`" /></td>
              <td><button class="student-name" @click="open(account)" :data-testid="`linkedin-student-${account.platformAccountId}`">{{ account.clientName }}</button>
                <small :class="{ error: summary(account).attention }">{{ connectionNames[account.state] || 'Не подключён' }} · #{{ account.platformAccountId }}</small></td>
              <td><template v-if="summary(account).current">{{ featureNames[summary(account).current.feature] }} · {{ stateNames[summary(account).current.state] }}
                  <small v-if="summary(account).current.waitReason || summary(account).current.reason">{{ reasonText(summary(account).current.waitReason || summary(account).current.reason) }}</small></template>
                <template v-else>Нет активных автозапусков</template>
                <small v-if="summary(account).last">Последнее: {{ featureNames[summary(account).last.feature] }} · {{ stateNames[summary(account).last.state] }}</small>
                <small v-if="summary(account).features.length">{{ summary(account).features.map(f => featureNames[f]).join(' · ') }}</small></td>
              <td><template v-if="summary(account).current">{{ dateMsk(summary(account).current.effectiveNextAt ?? summary(account).current.nextAt) }}</template>
                <template v-else-if="nextWindow(summary(account).schedule)">Интервал с {{ dateMsk(nextWindow(summary(account).schedule)) }}</template>
                <template v-else>{{ summary(account).schedule?.slots.length ? 'Выключено' : 'Расписание не задано' }}</template></td>
              <td><input type="checkbox" :checked="!!summary(account).schedule?.enabled" :disabled="automation.busy.value || !automation.writable.value || !account.unipileAccountId"
                :aria-label="`Автоматизация: ${account.clientName}`" :data-testid="`automation-toggle-${account.platformAccountId}`" @change="$event.target.checked = !!summary(account).schedule?.enabled; toggle(account)" /></td>
            </tr><tr v-if="!filtered.length && !auth.loading.value"><td colspan="5">{{ auth.error.value ? 'Не удалось загрузить учеников.' : 'По этим условиям учеников нет.' }}</td></tr></tbody></table>
            <p class="list-foot">Нажмите на ученика, чтобы открыть настройки и ручные действия.</p></div>
          <aside v-if="panelAccounts.length" class="detail" data-testid="linkedin-detail">
            <header><div><h3>{{ bulk ? `Выбрано учеников: ${chosen.length}` : selected.clientName }}</h3><small v-if="selected && !bulk">{{ connectionNames[selected.state] }} · #{{ selected.platformAccountId }}</small></div>
              <button aria-label="Свернуть карточку" @click="close">×</button></header>
            <nav v-if="!bulk" class="detail-tabs"><button v-for="(name, key) in { status: 'Состояние', schedule: 'Расписание', manual: 'Вручную' }" :key="key"
              :class="{ active: panel === key }" :data-testid="`linkedin-detail-${key}`" @click="changePanel(key)">{{ name }}</button></nav>
            <LinkedInSchedule v-if="panel === 'schedule'" ref="editor" :key="bulk ? 'bulk' : selectedId" :accounts="panelAccounts" :schedule="schedule" :schedules="automation.status.value.schedules"
              :automation="automation" @saved="feedback = 'Расписание сохранено.'" />
            <template v-else-if="panel === 'status' && selected">
              <p>{{ summary(selected).schedule?.enabled ? 'Автоматизация включена' : 'Автоматизация выключена' }}</p>
              <p v-if="!summary(selected).tasks.length">Автозапусков пока нет.</p>
              <Button v-if="resumable.length" label="Продолжить сегодняшний прогон" size="small"
                :disabled="automation.busy.value || !automation.writable.value" @click="resumeAll" data-testid="automation-resume-all" />
              <details v-for="task in [...summary(selected).tasks].sort((a,b) => b.updatedAt - a.updatedAt)" :key="task.id" class="task" :open="task.state === 'needs_attention' || task.state === 'running'">
                <summary>{{ featureNames[task.feature] }} · {{ stateNames[task.state] }}</summary>
                <p v-if="task.stopped && task.state === 'verifying'">Новые действия остановлены. Проверяем уже отправленное.</p>
                <template v-if="task.feature === 'posts' && postResult(task)">
                  <p v-if="postResult(task).unavailable">Не удалось прочитать результат публикации и лайков.</p>
                  <template v-else>
                    <p v-if="postResult(task).publishedAt">Пост опубликован: {{ dateMsk(postResult(task).publishedAt) }} · МСК</p>
                    <p>Лайки: {{ engagementLabels[postResult(task).likes.status] }} · подтверждено {{ postResult(task).likes.confirmed }} из {{ postResult(task).likes.target }}.
                      Ожидают отправки: {{ postResult(task).likes.pending }}; проверки: {{ postResult(task).likes.uncertain }}; пропущено: {{ postResult(task).likes.failed }}.</p>
                    <p v-if="postResult(task).likes.nextAt">Следующий шаг лайков: {{ dateMsk(postResult(task).likes.nextAt) }} · МСК</p>
                    <p v-for="error in postResult(task).likes.errors || []" :key="error.accountId">
                      {{ error.name }} · аккаунт {{ error.accountId }} · {{ error.stage }}: {{ error.code }}
                    </p>
                  </template>
                </template>
                <p v-if="task.stageMessage">{{ task.stageMessage }}</p>
                <p v-if="task.summary">Выполнено: {{ task.summary.completed }} · Пропущено: {{ task.summary.skipped }} · Не подтверждено: {{ task.summary.unconfirmed }}</p>
                <p v-if="task.waitReason || task.reason">{{ reasonText(task.waitReason || task.reason) }}</p>
                <p v-if="task.blockingTaskId">Ожидаем: {{ featureNames[automation.status.value.tasks?.find(t => t.id === task.blockingTaskId)?.feature] || 'другую фичу' }}</p>
                <p v-if="!['completed','stopped','needs_attention'].includes(task.state)">Следующее действие: {{ dateMsk(task.effectiveNextAt ?? task.nextAt) }} · МСК</p>
                <p>Обновлено: {{ dateMsk(task.updatedAt) }} · МСК</p>
                <Button v-if="canResumeTask(task, schedule)" label="Продолжить фичу" size="small"
                  :disabled="automation.busy.value || !automation.writable.value" @click="resume(task)" data-testid="automation-resume" />
                <small v-if="task.state === 'needs_attention'">Проверьте причину ошибки. Продолжится тот же прогон, без повторения подтверждённых отправок.</small>
              </details>
              <Button label="Открыть журнал ученика" size="small" outlined @click="openLog(selected)" />
            </template>
            <section v-else-if="panel === 'manual' && selected" :key="selectedId" class="manual" data-testid="linkedin-manual">
              <p>Ручные действия используют те же проверки и блокировку аккаунта.</p>
              <Message v-if="auth.nocoQueue.value.state === 'cooldown'" severity="warn" :closable="false">Хранилище ограничило запросы. Продолжение через {{ nocoWait }} с.</Message>
              <Message v-if="comments.errors.value.page" severity="error" :closable="false">{{ comments.errors.value.page }}</Message>
              <Message v-if="connections.errors.value.page" severity="error" :closable="false">{{ connections.errors.value.page }}</Message>
              <details open><summary>Посты, приглашения и комментарии</summary>
                <PostWriterCell :account="selected" /><ConnectionInviterCell :account="selected" :inviter="connections" :disabled="busy" />
                <CommentMonitorCell :account="selected" :monitor="comments" /></details>
              <details><summary>Подключение и профиль</summary>
                <LinkedInAuthStatus :account="selected" :run="runForAccount(auth.runs.value, selected)" />
                <div v-if="auth.editors.value[selectedId] || !selected.linkedinUrl" class="url-editor">
                  <InputText v-model="auth.drafts.value[selectedId]" placeholder="https://www.linkedin.com/in/.../" :data-testid="`linkedin-url-input-${selectedId}`" />
                  <Button label="Сохранить" size="small" :loading="auth.saving.value[selectedId]" :disabled="busy" :data-testid="`linkedin-url-save-${selectedId}`" @click="auth.save(selected)" />
                </div>
                <div v-else class="url-editor"><a :href="selected.linkedinUrl" target="_blank" rel="noreferrer">Открыть профиль</a>
                  <Button label="Изменить URL" text size="small" :disabled="busy" :data-testid="`linkedin-url-edit-${selectedId}`" @click="auth.edit(selected)" /></div>
                <small>Dolphin: {{ selected.dolphinProfileId || '—' }} · Unipile: {{ selected.unipileAccountId || '—' }}</small>
                <small>Проверен: {{ formatDate(selected.lastVerifiedAt) }}</small>
                <div class="manual-buttons"><Button label="Проверить настройки" size="small" outlined :disabled="busy" :data-testid="`linkedin-check-${selectedId}`" @click="auth.start(selected, 'check')" />
                  <Button label="Подключить / проверить" size="small" :disabled="busy || !!selected.readinessErrorCode" :data-testid="`linkedin-connect-${selectedId}`" @click="auth.start(selected, primaryAction(selected).action)" />
                  <Button v-if="selected.unipileAccountId" label="Обновить сессию" size="small" severity="warn" outlined :disabled="busy || !!selected.readinessErrorCode" :data-testid="`linkedin-force-${selectedId}`" @click="auth.start(selected, 'force_reauth')" />
                  <ProfileFillerAccountAction :account="selected" :filler="filler" :blocked="auth.active.value" /></div>
              </details>
            </section>
          </aside>
        </div>
      </template>
    </template>
  </Card>
  <ProfileFillerDialog v-if="filler.selected.value" :key="filler.selected.value.account.value?.platformAccountId" :filler="filler.selected.value" />
</template>
<style scoped src="./linkedin-automation.css"></style>
