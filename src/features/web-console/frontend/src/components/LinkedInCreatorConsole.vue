<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { request, octoProxyPayload } from '../octo-api.js'
import OctoAccessCard from './OctoAccessCard.vue'
const base = '/api/linkedin-creator'
const tasks = ref([]), selected = ref(null), result = ref({ url: '', login: '', password: '' })
const tasksLoading = ref(false), tasksLoaded = ref(false), tasksLoadError = ref('')
const expertDoneStatus = 'сделана экспертом'
const orderedTasks = computed(() => [...tasks.value].sort((a, b) =>
  Number(a.status === expertDoneStatus) - Number(b.status === expertDoneStatus)))
const expertCompleted = computed(() => selected.value?.task.status === expertDoneStatus)
const message = ref(''), busy = ref(false), selectedStatus = ref('не начата'), copied = ref('')
const captureConfirmed = ref(false)
const profileState = ref(null)
const canCaptureProxy = computed(() => profileState.value?.profiles?.some(p => p.locale === 'en' &&
  p.phase === 'ready' && p.canEditProxy === true && p.proxy?.configured))
function updateProfileStatus(status) {
  profileState.value = status
  if (!canCaptureProxy.value) captureConfirmed.value = false
}
const requestedTaskId = ref(null), taskLoading = ref(false), taskLoadError = ref('')
const controller = new AbortController()
let taskController
let selection = 0
let listGeneration = 0
const labels = { fullName: 'Имя и фамилия', country: 'Страна', company: 'Компания', position: 'Должность', blockedAt: 'Дата блока', newFullName: 'Новое имя', legacyText: 'Примечание' }
const transport = computed(() => {
  const path = `${base}/tasks/${selected.value?.task.id}/octo`
  return { profileStatus: options => request(path + '/status' + (options?.proxyCredentials ? '?proxyCredentials=1' : ''), { signal: options?.signal }),
    requestGrant: (profileId, options) => request(path + '/grants', { ...options, method: 'POST', body: JSON.stringify({ profileId }) }),
    grant: (id, options) => request(path + '/grants/' + encodeURIComponent(id), options),
    saveProxy: (profileId, draft, options) => request(`${path}/profiles/${encodeURIComponent(profileId)}/proxy`,
      { ...options, method: 'POST', body: JSON.stringify(octoProxyPayload(draft)) }) }
})
const completionChecklist = computed(() => [
  { key: 'proxy', label: 'Настройки прокси подтверждены для заявки',
    done: !!selected.value?.task.proxySavedAt && captureConfirmed.value && !!canCaptureProxy.value,
    hint: !profileState.value ? 'Дождитесь загрузки состояния профиля Octo.'
      : canCaptureProxy.value ? 'Нажмите «Сохранить настройки прокси» над формой LinkedIn.'
      : !profileState.value.profiles?.some(p => p.locale === 'en' && p.proxy?.configured)
        ? 'Сохраните прокси в форме «Настроить прокси» и дождитесь завершения сохранения. Затем нажмите «Сохранить настройки прокси».'
        : 'Закройте профиль Octo и дождитесь завершения доступа. Затем нажмите «Сохранить настройки прокси».' },
  { key: 'url', label: 'Ссылка LinkedIn сохранена', done: !!selected.value?.intake.url,
    hint: 'Введите ссылку вида https://www.linkedin.com/in/... и нажмите «Сохранить данные LinkedIn».' },
  { key: 'login', label: 'Логин LinkedIn сохранён', done: !!selected.value?.intake.login,
    hint: 'Введите логин LinkedIn и нажмите «Сохранить данные LinkedIn».' },
  { key: 'password', label: 'Пароль LinkedIn сохранён', done: !!selected.value?.intake.hasPassword,
    hint: 'Введите пароль LinkedIn и нажмите «Сохранить данные LinkedIn».' }
])
const canComplete = computed(() => completionChecklist.value.every(item => item.done))
function errorText(error) {
  const code = error.message
  if (code === 'linkedin_task_proxy_pending') return 'Прокси сохраняется. Дождитесь завершения и нажмите кнопку ещё раз.'
  if (code === 'linkedin_task_close_profile_first') return 'Закройте профиль Octo и дождитесь завершения доступа.'
  if (code === 'linkedin_task_proxy_required' || code === 'linkedin_task_proxy_changed') return 'Подтвердите актуальный прокси: закройте профиль Octo, дождитесь завершения доступа и нажмите «Сохранить настройки прокси».'
  if (code === 'linkedin_task_result_required') return 'Сохраните ссылку, логин и пароль LinkedIn кнопкой «Сохранить данные LinkedIn».'
  if (code === 'linkedin_task_stale_version') return 'Заявка изменилась. Откройте её заново перед сохранением.'
  if (code === 'commit_uncertain') return 'Результат неизвестен. Откройте заявку заново для проверки; повторная отправка не запускается.'
  return 'Не удалось выполнить действие. Проверьте поля и состояние профиля; при повторной ошибке обратитесь в поддержку.'
}
async function loadTasks() {
  const current = ++listGeneration
  tasksLoading.value = true; tasksLoadError.value = ''
  try {
    const list = await request(base + '/tasks', { signal: controller.signal })
    if (controller.signal.aborted || current !== listGeneration) return
    tasks.value = list; tasksLoaded.value = true
    if (requestedTaskId.value && !list.some(t => t.id === requestedTaskId.value)) {
      selection++; taskController?.abort(); requestedTaskId.value = null; taskLoading.value = false; taskLoadError.value = ''
      selected.value = null; captureConfirmed.value = false; profileState.value = null; result.value = { url: '', login: '', password: '' }
    }
  }
  catch (e) {
    if (!controller.signal.aborted && current === listGeneration)
      tasksLoadError.value = 'Не удалось загрузить список заявок. Нажмите «Обновить список», чтобы повторить.'
  } finally { if (current === listGeneration) tasksLoading.value = false }
}
async function open(id) {
  const current = ++selection
  taskController?.abort(); taskController = new AbortController()
  requestedTaskId.value = id; taskLoading.value = true; taskLoadError.value = ''
  selected.value = null; captureConfirmed.value = false; profileState.value = null; result.value = { url: '', login: '', password: '' }; message.value = ''
  try {
    const data = await request(`${base}/tasks/${id}`, { signal: taskController.signal })
    if (current !== selection || controller.signal.aborted) return
    selected.value = data; selectedStatus.value = data.task.status; captureConfirmed.value = !!data.task.proxySavedAt
    result.value = { url: data.intake.url, login: data.intake.login || data.intake.outlookLogin || '', password: '' }
  } catch (e) {
    if (e.name !== 'AbortError' && !controller.signal.aborted && current === selection) taskLoadError.value = errorText(e)
  } finally { if (current === selection) taskLoading.value = false }
}
async function save(action, body) {
  if (busy.value || !selected.value) return
  busy.value = true; message.value = ''
  const id = selected.value.task.id, current = selection
  try {
    const task = await request(`${base}/tasks/${id}/${action}`, { signal: controller.signal,
      method: action === 'capture-proxy' ? 'POST' : 'PUT', body: JSON.stringify({ ...body, version: selected.value.task.version }) })
    if (current !== selection || controller.signal.aborted) return
    selected.value.task = task
    if (action === 'capture-proxy') { captureConfirmed.value = true; message.value = 'Настройки прокси сохранены.' }
    if (action === 'result') {
      const detail = await request(`${base}/tasks/${id}`, { signal: controller.signal })
      if (current !== selection || controller.signal.aborted) return
      selected.value = detail; result.value.password = ''; message.value = 'Данные LinkedIn сохранены.'
    }
    if (action === 'status') {
      selectedStatus.value = task.status
      message.value = task.notification?.outcome === 'failed'
        ? 'Статус сохранён. Не удалось отправить уведомление в менеджерский Telegram-чат.'
        : task.notification?.outcome === 'uncertain'
          ? 'Статус сохранён. Подтверждение отправки уведомления в Telegram не получено.'
          : task.notification?.outcome === 'sent'
            ? 'Статус сохранён. Уведомление отправлено в менеджерский Telegram-чат.'
            : 'Статус сохранён.'
    }
    await loadTasks()
  } catch (e) {
    if (current === selection && !controller.signal.aborted) {
      message.value = errorText(e)
      if (action === 'capture-proxy' || ['linkedin_task_proxy_required', 'linkedin_task_proxy_changed'].includes(e.message)) captureConfirmed.value = false
    }
  } finally { busy.value = false }
}
async function copy(kind) {
  copied.value = ''
  try {
    const id = selected.value?.task.id
    const data = await request(kind === 'nodemaven' ? base + '/nodemaven-key' : `${base}/tasks/${id}/secrets/${kind}`,
      { signal: controller.signal, ...(kind === 'nodemaven' ? { method: 'POST' } : {}) })
    if (controller.signal.aborted || kind !== 'nodemaven' && selected.value?.task.id !== id) return
    const secret = kind === 'nodemaven' ? data.key : data.password
    if (!secret) throw new Error('no_secret')
    await navigator.clipboard.writeText(secret)
    copied.value = kind
  } catch (e) { if (!controller.signal.aborted) message.value = 'Не удалось скопировать секрет.' }
}
onMounted(loadTasks)
onUnmounted(() => { selection++; taskController?.abort(); controller.abort(); result.value.password = ''; selected.value = null })
</script>
<template>
  <section class="creator-console" data-testid="linkedin-creator-console">
    <div class="key-row"><label>Ключ NodeMaven <input type="password" value="hidden-api-key" readonly aria-label="Ключ NodeMaven"></label>
      <button type="button" class="key-copy-button" @click="copy('nodemaven')">{{ copied === 'nodemaven' ? 'Скопировано' : 'Копировать ключ' }}</button></div>
    <p v-if="message" role="status">{{ message }}</p>
    <div class="creator-layout">
      <nav aria-label="Заявки" :aria-busy="tasksLoading"><h2>Заявки на создание LinkedIn</h2><button type="button" :disabled="tasksLoading" @click="loadTasks">{{ tasksLoading ? 'Обновляем…' : 'Обновить список' }}</button>
        <div v-if="tasksLoading" class="task-list-loader" role="status" aria-live="polite" data-testid="creation-task-list-loader">
          <div class="loader-heading"><span class="loader-ring" aria-hidden="true"></span><strong>{{ tasksLoaded ? 'Обновляем заявки…' : 'Загружаем заявки…' }}</strong></div>
          <div v-if="!tasksLoaded" class="task-list-skeleton" aria-hidden="true"><span v-for="i in 3" :key="i" class="skeleton-box"></span></div>
        </div>
        <p v-if="tasksLoadError" role="alert" data-testid="creation-task-list-error">{{ tasksLoadError }}</p>
        <p v-if="tasksLoaded && !tasksLoading && !tasksLoadError && !tasks.length">Нет открытых заявок.</p>
        <button v-for="task in orderedTasks" :key="task.id" type="button" class="task-button" :class="{ 'task-button--selected': requestedTaskId === task.id, 'task-button--completed': task.status === expertDoneStatus }" :aria-pressed="requestedTaskId === task.id" aria-controls="creation-task-panel" :data-testid="`creation-task-${task.id}`" :disabled="busy" @click="open(task.id)">
          <span class="task-button__title">#{{ task.id }} · {{ task.fio }}</span>
          <span class="task-button__meta">{{ task.stack }} · {{ task.status }}</span>
        </button>
      </nav>
      <div id="creation-task-panel" class="task-panel" :aria-busy="taskLoading">
      <div v-if="taskLoading" class="task-loader" role="status" aria-live="polite" data-testid="creation-task-loader">
        <div class="loader-heading"><span class="loader-ring" aria-hidden="true"></span><div><strong>Загружаем карточку</strong><p>Подготавливаем данные ученика…</p></div></div>
        <div class="loader-skeleton" aria-hidden="true"><span class="skeleton-line skeleton-title"></span><span class="skeleton-line skeleton-short"></span><span class="skeleton-line"></span><span class="skeleton-line"></span><span class="skeleton-box"></span><span class="skeleton-line skeleton-short"></span></div>
      </div>
      <div v-else-if="taskLoadError" class="task-placeholder" role="alert"><p>{{ taskLoadError }}</p><button type="button" @click="open(requestedTaskId)">Повторить загрузку</button></div>
      <article v-else-if="selected" :key="selected.task.id" data-testid="creation-task-detail">
        <h2>{{ selected.client.fio }}</h2><p>Стек: {{ selected.client.stack || 'Не указан' }}</p>
        <dl><dt>Имя латиницей</dt><dd>{{ selected.intake.firstName }} {{ selected.intake.lastName }}</dd>
          <dt>Реальная локация</dt><dd>{{ selected.intake.realLocation }}</dd><dt>Почта Outlook</dt><dd>{{ selected.intake.outlookLogin }}</dd></dl>
        <label>Пароль Outlook <input type="password" value="saved-password" readonly aria-label="Пароль Outlook"></label>
        <button type="button" @click="copy('outlook')">{{ copied === 'outlook' ? 'Скопировано' : 'Копировать пароль Outlook' }}</button>
        <h3>Старые заблокированные аккаунты ({{ selected.intake.blockedAccounts.length }})</h3><p v-if="!selected.intake.blockedAccounts.length">Не указаны.</p>
        <section v-for="(account,index) in selected.intake.blockedAccounts" :key="index" data-testid="creator-blocked-account">
          <h4>Аккаунт {{ index + 1 }}</h4>
          <dl><template v-for="(value,key) in account" :key="key"><dt>{{ labels[key] }}</dt><dd class="blocked-account-value">{{ value }}</dd></template></dl>
        </section>
        <p><strong>Введи данные прокси прямо здесь, в форме «Настроить прокси» ниже, и нажми «Сохранить прокси».</strong> Дождись статуса «Прокси сохранён». В приложении Octo Browser прокси вводить или менять не нужно.</p>
        <OctoAccessCard :key="selected.task.id" :client-id="selected.client.id" :setup-enabled="false" :proxy-expanded="true" :transport="transport" @status="updateProfileStatus" @access-issued="captureConfirmed = false" @proxy-changed="captureConfirmed = false" />
        <p>После настройки прокси в этой форме и работы в Octo закрой профиль обычным способом и дождись завершения доступа. Затем нажми «Сохранить настройки прокси» ниже: эта кнопка проверит фактические настройки профиля и подтвердит их для заявки.</p>
        <button type="button" :disabled="busy || !canCaptureProxy" @click="save('capture-proxy', {})">Сохранить настройки прокси</button>
        <p v-if="captureConfirmed">Прокси сохранён и проверен.</p>
        <form @submit.prevent="save('result', result)">
          <h3>Созданный LinkedIn</h3>
          <label>Ссылка LinkedIn<input v-model="result.url" required placeholder="https://www.linkedin.com/in/..." autocomplete="off"></label>
          <label>Логин LinkedIn<input v-model="result.login" type="text" required autocomplete="off"></label>
          <label>Пароль LinkedIn<input v-model="result.password" type="password" :required="!selected.intake.hasPassword" :placeholder="selected.intake.hasPassword ? 'Сохранён; пустое поле оставляет прежний' : ''" autocomplete="new-password"></label>
          <button type="submit" :disabled="busy">Сохранить данные LinkedIn</button>
        </form>
        <section class="completion-checklist" aria-labelledby="completion-checklist-title">
          <h3 id="completion-checklist-title">Что нужно для завершения заявки</h3>
          <ul>
            <li v-for="item in completionChecklist" :key="item.key" :data-testid="`completion-${item.key}`" :class="{ 'completion-checklist__done': item.done }">
              <strong>{{ item.done ? '✓ Выполнено' : '○ Не выполнено' }}: {{ item.label }}</strong>
              <p v-if="!item.done">{{ item.hint }}</p>
            </li>
          </ul>
          <p v-if="!canComplete">Статус «сделана экспертом» станет доступен после выполнения всех пунктов.</p>
        </section>
        <label>Статус заявки<select v-model="selectedStatus" aria-label="Статус заявки" aria-describedby="completion-checklist-title"><option>не начата</option><option>блок</option><option :disabled="!canComplete">{{ expertDoneStatus }}</option></select></label>
        <p v-if="expertCompleted" class="task-completion-note" role="status">Заявка сделана экспертом и ожидает подтверждения.</p>
        <button type="button" :disabled="busy || selectedStatus === expertDoneStatus && !canComplete" @click="save('status', { status: selectedStatus })">Сохранить статус</button>
      </article>
      <div v-else class="task-placeholder"><p>Выберите заявку, чтобы открыть карточку ученика.</p></div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.blocked-account-value{white-space:pre-line}
.completion-checklist{padding:16px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#334155}
.completion-checklist h3{margin:0 0 12px}.completion-checklist ul{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.completion-checklist p{margin:4px 0 0}.completion-checklist__done{color:#166534}
.creator-console{padding:24px;border-radius:12px;background:var(--p-content-background,#fff);color:var(--p-text-color,#1f2937)}
.creator-layout{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2fr);gap:24px;margin-top:24px}nav,form,article{display:grid;align-content:start;gap:12px}nav button{text-align:left}label{display:grid;gap:6px}input,select,button{font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:6px;max-width:100%;min-width:0}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.key-row{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;width:100%}.key-row input,.key-copy-button{width:100%;box-sizing:border-box}.key-copy-button{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;font-weight:600;min-height:44px}.key-copy-button:hover{background:#dbeafe}.task-button{background:#f8fafc;transition:background-color .15s,border-color .15s,box-shadow .15s}.task-button:hover{background:#f1f5f9}.task-button--selected,.task-button--selected:hover{background:#eaf2ff;border-color:#93b4f4;color:#1e40af;box-shadow:inset 3px 0 #3b82f6}.task-button:focus-visible,.key-copy-button:focus-visible{outline:3px solid #bfdbfe;outline-offset:2px}.task-panel{min-width:0}.task-loader,.task-placeholder{padding:28px;border:1px solid #e2e8f0;border-radius:12px;background:linear-gradient(145deg,#f8fbff,#fff);min-height:320px;box-sizing:border-box}.loader-heading{display:flex;align-items:center;gap:14px;color:#334155}.loader-heading strong{font-size:17px}.loader-heading p{margin:6px 0 0;color:#64748b;font-size:14px}.loader-ring{width:32px;height:32px;flex:0 0 32px;border:3px solid #dbeafe;border-top-color:#3b82f6;border-right-color:#93c5fd;border-radius:50%;animation:loader-spin .85s linear infinite}.loader-skeleton{display:grid;gap:18px;margin-top:30px}.skeleton-line,.skeleton-box{display:block;border-radius:7px;background:linear-gradient(100deg,#edf2f8 15%,#f8fbff 40%,#edf2f8 65%);background-size:220% 100%;animation:loader-shimmer 1.6s ease-in-out infinite}.skeleton-line{height:14px}.skeleton-title{height:22px;width:75%}.skeleton-short{width:45%}.skeleton-box{height:76px}.task-placeholder{color:#64748b}dt{font-weight:600}dd{margin:4px 0 12px;overflow-wrap:anywhere}form{border-top:1px solid #dbe3ee;padding-top:16px}p{line-height:1.5}@keyframes loader-spin{to{transform:rotate(360deg)}}@keyframes loader-shimmer{to{background-position:-220% 0}}@media(prefers-reduced-motion:reduce){.loader-ring,.skeleton-line,.skeleton-box{animation:none}.task-button{transition:none}}@media(max-width:800px){.creator-layout{grid-template-columns:minmax(0,1fr)}.task-loader,.task-placeholder{padding:20px}}
.task-button{display:grid;gap:6px;padding:14px;min-width:0;line-height:1.4}
.task-button__title{font-weight:600;overflow-wrap:anywhere}
.task-button__meta{font-size:13px;line-height:1.3;color:#526176}
.task-button--completed{gap:2px;padding:8px 12px;min-height:44px;font-size:14px}
.task-button--completed .task-button__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.task-button--completed .task-button__meta{font-size:12px;color:inherit}
.task-button--completed:not(.task-button--selected){background:#f1f5f9;border-color:#e2e8f0;color:#526176}
.task-button--completed:not(.task-button--selected):hover{background:#e2e8f0}
.task-completion-note{margin:0;padding:12px 14px;border-radius:8px;background:#f1f5f9;color:#475569}
.task-list-loader{padding:14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fbff}
.task-list-loader .loader-heading{gap:10px;font-size:14px}
.task-list-loader .loader-ring{width:20px;height:20px;flex-basis:20px}
.task-list-skeleton{display:grid;gap:10px;margin-top:16px}
.task-list-skeleton .skeleton-box{height:64px}
</style>
