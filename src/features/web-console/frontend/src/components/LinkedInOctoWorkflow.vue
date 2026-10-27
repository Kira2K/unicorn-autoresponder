<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import OctoAccessCard from './OctoAccessCard.vue'
import Dialog from 'primevue/dialog'
import { octoApi } from '../octo-api.js'
import { intakeRequest, intakeScenario, infrastructureReady, infrastructureSignature, registrationTimeInput, registrationTimeUtc } from '../linkedin-intake.js'
import { isOutlookLogin, isLatinIntakeName } from '../../../../linkedin-automation/console-intake/contracts.mts'
const props = defineProps({ client: { type: Object, required: true }, hasDolphin: { type: Boolean, default: false } })
const registrationDate = ref(''), showSavedDialog = ref(false)
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const emit = defineEmits(['saved', 'state'])
const loaded = ref(false), loading = ref(false), loadError = ref(''), message = ref(''), saving = ref(false)
const scenario = ref(''), existing = ref(false), newSaved = ref(false), opened = ref(false), status = ref(null)
const form = ref({ url: '', login: '', password: '', outlookLogin: '', outlookPassword: '', firstName: '', lastName: '', realLocation: '', blockedAccounts: [], loggedIn: false })
const secrets = ref({ hasPassword: false, hasOutlookPassword: false })
const editLocked = ref(false)
const task = ref(null), completionConfirmed = ref(false), hasLinkedIn = ref(false), replacementId = ref(null)
const pendingMessage = 'Мы начали создавать твой аккаунт LinkedIn. Обычно это занимает до 3 суток. Когда всё будет готово, мы тебе напишем.'
const registrationPending = computed(() => !replacementId.value && (secrets.value.registrationPending === true || !!task.value && task.value.status !== 'выполнение подтверждено'))
const hadLinkedInBeforeTask = computed(() => secrets.value.hadLinkedInBeforeTask === true)
const previousProfileTransport = {
  ...octoApi,
  async profileStatus(options) {
    const data = await octoApi.profileStatus({ ...options, proxyCredentials: false })
    const ids = new Set(secrets.value.previousOctoProfileIds || [])
    const profiles = data.profiles.filter(profile => ids.has(profile.id))
    return { ...data, profiles, requiredLocales: [...new Set(profiles.map(profile => profile.locale))] }
  }
}
const usesOcto = computed(() => !props.hasDolphin || !!task.value || completionConfirmed.value)
const existingFormEnabled = computed(() => ['en', 'both'].includes(String(props.client.market || '').trim().toLowerCase()) && !props.hasDolphin)
const canReportBan = computed(() => loaded.value && hasLinkedIn.value && !replacementId.value && !registrationPending.value &&
  (!task.value || task.value.status === 'выполнение подтверждено') && (!editLocked.value || completionConfirmed.value))
const controller = new AbortController()
const outlookError = ref('')
const validationError = ref(''), outlookInput = ref(null)
let confirmationTimer, checkingConfirmation = false
const ready = computed(() => infrastructureReady(status.value))
const historyFields = { fullName: 'Какие имя и фамилия стояли?', country: 'Какая страна была указана?', company: 'Какая компания была указана?', position: 'Какая должность была указана?', blockedAt: 'Когда заблокировали аккаунт?' }
const canSave = computed(() => loaded.value && (!props.hasDolphin || replacementId.value || task.value) && !editLocked.value && !saving.value &&
  (scenario.value === 'new' && (!registrationPending.value || ['не начата','блок'].includes(task.value?.status)) || !registrationPending.value && ready.value && opened.value && form.value.loggedIn))
function updateTaskState(data) {
  task.value = data.task || null
  completionConfirmed.value = data.completionConfirmed ?? (data.task?.status === 'выполнение подтверждено')
  hasLinkedIn.value = data.hasLinkedIn ?? !!(data.url || data.login)
  secrets.value = { ...secrets.value, ...data }
  editLocked.value = data.editLocked === true || ['сделана экспертом','выполнение подтверждено'].includes(task.value?.status)
  emit('state', { preferOcto: props.hasDolphin && (!!task.value || completionConfirmed.value) && !(registrationPending.value && hadLinkedInBeforeTask.value) })
}
async function load() {
  if (loading.value) return
  loading.value = true; loadError.value = ''
  try {
    const data = await intakeRequest('GET', undefined, controller.signal)
    if (controller.signal.aborted) return
    form.value = { ...form.value, ...data, realLocation: data.realLocation || '', password: '', outlookPassword: '', loggedIn: false }
    form.value.firstName = isLatinIntakeName(data.firstName) ? data.firstName : ''
    form.value.lastName = isLatinIntakeName(data.lastName) ? data.lastName : ''
    registrationDate.value = registrationTimeInput(data.outlookRegisteredAt)
    replacementId.value = null
    updateTaskState(data)
    scenario.value = registrationPending.value ? 'new' : intakeScenario(data) || (data.task && data.hasOutlookPassword ? 'new' : ''); existing.value = !!data.task || !!intakeScenario(data)
    newSaved.value = !!data.hasOutlookPassword && !!data.firstName; loaded.value = true
  } catch (error) { if (error.name !== 'AbortError') loadError.value = 'Не удалось загрузить данные LinkedIn. Попробуйте ещё раз.' }
  finally { loading.value = false }
}
function resetConfirmation() { form.value.loggedIn = false; opened.value = false }
watch(() => [form.value.url, form.value.login, form.value.password], () => { form.value.loggedIn = false })
watch(() => infrastructureSignature(status.value), resetConfirmation)
watch(scenario, () => { resetConfirmation(); form.value.password = ''; form.value.outlookPassword = ''; message.value = ''; validationError.value = ''; outlookError.value = '' })
function selectScenario(value) { if (!registrationPending.value) scenario.value = value }
async function checkConfirmation() {
  if ((!editLocked.value && !task.value && !secrets.value.registrationPending) || replacementId.value || saving.value || loading.value || document.hidden || checkingConfirmation) return
  checkingConfirmation = true
  try {
    const data = await intakeRequest('GET', undefined, controller.signal)
    if (controller.signal.aborted || replacementId.value) return
    if (data.task && task.value && data.task.id !== task.value.id) { await load(); return }
    const wasConfirmed = completionConfirmed.value
    updateTaskState(data)
    if (registrationPending.value) scenario.value = 'new'
    if (!wasConfirmed && completionConfirmed.value) emit('saved')
  } catch { /* The next read can confirm completion; no business action is retried. */ }
  finally { checkingConfirmation = false }
}
function reportBan() {
  if (!canReportBan.value || !secrets.value.linkedinAccountId || saving.value) return
  replacementId.value = secrets.value.linkedinAccountId
  form.value = { ...form.value, url: '', login: '', password: '', outlookLogin: '', outlookPassword: '', loggedIn: false,
    firstName: isLatinIntakeName(form.value.firstName) ? form.value.firstName : '',
    lastName: isLatinIntakeName(form.value.lastName) ? form.value.lastName : '' }
  registrationDate.value = ''; secrets.value = { ...secrets.value, hasPassword: false, hasOutlookPassword: false }
  editLocked.value = false; existing.value = false; newSaved.value = false; scenario.value = 'new'; message.value = ''
}
function validateOutlook() {
  outlookError.value = isOutlookLogin(form.value.outlookLogin) ? '' : 'Укажите почту с окончанием @outlook.com, например name@outlook.com.'
}
function revealInput(input) {
  for (let parent = input?.parentElement; parent; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') parent.open = true
  input?.focus()
}
function showInvalidField(event) {
  const input = event.target
  if (input !== input.form?.querySelector(':invalid')) return
  const label = input.labels?.[0]?.firstChild?.textContent?.trim()
  validationError.value = `Данные не сохранены. ${label ? `Проверьте поле «${label}». ` : ''}${input.validationMessage}`
  revealInput(input)
}
async function save() {
  if (!canSave.value) return
  const editingCurrentTask = registrationPending.value
  outlookError.value = ''; validationError.value = ''
  if (scenario.value === 'new') {
    validateOutlook()
    if (outlookError.value) {
      validationError.value = `Данные не сохранены. ${outlookError.value}`
      revealInput(outlookInput.value)
      return
    }
  }
  saving.value = true; message.value = ''
  try {
    const registration = scenario.value === 'new'
      ? { outlookRegisteredAt: registrationTimeUtc(registrationDate.value) } : {}
    if (scenario.value === 'new' && !registration.outlookRegisteredAt)
      throw new Error('linkedin_intake_outlook_registration_required')
    const result = await intakeRequest('PUT', { ...form.value, ...registration, scenario: scenario.value,
      ...(replacementId.value ? { replacesLinkedInAccountId: replacementId.value } : {}) }, controller.signal)
    if (controller.signal.aborted) return
    if (scenario.value === 'new') {
      newSaved.value = true; secrets.value.hasOutlookPassword = true
      task.value = result.task || task.value
      replacementId.value = null; hasLinkedIn.value = false
      completionConfirmed.value = task.value?.status === 'выполнение подтверждено'
      message.value = result.task ? (result.task.created ? 'Заявка успешно создана' : 'Заявка обновлена') : 'Данные сохранены. Подготавливаем профили Octo.'
      form.value.password = ''; form.value.outlookPassword = ''
      await load()
      if (result.saved === true && !editingCurrentTask) showSavedDialog.value = true
    } else {
      existing.value = true; hasLinkedIn.value = true; secrets.value.hasPassword = true
      secrets.value.linkedinAccountId = result.linkedinAccountId || secrets.value.linkedinAccountId
      message.value = 'Данные LinkedIn сохранены.'
    }
    form.value.password = ''; form.value.outlookPassword = ''; form.value.loggedIn = false; emit('saved')
  } catch (error) {
    if (error.name === 'AbortError') return
    if (['linkedin_intake_outlook_registration_required', 'linkedin_intake_outlook_registration_invalid'].includes(error.message)) {
      message.value = 'Укажите корректные дату и время регистрации Outlook-почты.'
      return
    }
    if (error.message === 'commit_uncertain') {
      loaded.value = false
      form.value.password = ''; form.value.outlookPassword = ''
      loadError.value = 'Результат сохранения неизвестен. Нажмите «Повторить», чтобы перечитать сохранённые данные. Повторная отправка не запускается автоматически.'
      return
    }
    if (error.message === 'linkedin_task_student_edit_locked') editLocked.value = true
    if (error.message === 'linkedin_intake_registration_pending') {
      message.value = 'Регистрация LinkedIn ещё не завершена. Дождитесь подтверждения заявки.';return
    }
    if (error.message === 'linkedin_intake_replacement_stale') {
      loaded.value = false;loadError.value = 'Заявка уже изменилась. Нажмите «Повторить», чтобы загрузить актуальные данные.';return
    }
    message.value = error.message.includes('ambiguous') ? 'Найдено несколько аккаунтов. Обратитесь в поддержку: данные не перезаписаны.' :
      'Не удалось сохранить. Проверьте поля и состояние Octo; при повторной ошибке обратитесь в поддержку.'
  } finally { saving.value = false }
}
onMounted(() => { load(); confirmationTimer = setInterval(checkConfirmation, 5000) })
onUnmounted(() => { clearInterval(confirmationTimer); controller.abort(); form.value.password = ''; form.value.outlookPassword = '' })
</script>
<template>
  <section class="linkedin-card" aria-labelledby="linkedin-intake-title" data-testid="linkedin-octo-workflow">
    <h2 id="linkedin-intake-title">LinkedIn</h2>
    <p v-if="loading" role="status">Загружаем данные…</p>
    <div v-if="loadError" role="alert">{{ loadError }} <button type="button" @click="load">Повторить</button></div>
    <button v-if="canReportBan" type="button" :disabled="saving" data-testid="linkedin-report-ban" @click="reportBan">Меня забанили</button>
    <p v-if="loaded && registrationPending" role="status" data-testid="linkedin-registration-pending">{{ pendingMessage }}</p>
    <p v-if="loaded && registrationPending && !hadLinkedInBeforeTask" role="status">Пока ждёшь, пожалуйста, не заходи в профиль Octo: это может помешать регистрации.</p>
    <template v-if="loaded && editLocked && completionConfirmed">
      <p role="status">Создание LinkedIn подтверждено. Ваши профили Octo доступны ниже.</p>
      <OctoAccessCard v-if="usesOcto" :client-id="client.id" :setup-enabled="false" :proxy-editing-enabled="false" />
    </template>
    <p v-else-if="editLocked" role="status">Заявка обработана экспертом. Для изменения данных обратитесь в поддержку.</p>
    <OctoAccessCard v-if="loaded && registrationPending && hadLinkedInBeforeTask && secrets.previousOctoProfileIds?.length"
      :client-id="client.id" :setup-enabled="false" :proxy-editing-enabled="false" :transport="previousProfileTransport" />
    <template v-if="loaded && !editLocked">
      <p v-if="replacementId">Подготовим новый LinkedIn через тот же процесс с Octo. Укажите новую почту Outlook. Старые аккаунты сохранятся в архиве после сохранения формы.</p>
      <button v-if="replacementId" type="button" :disabled="saving" @click="load">Отмена</button>
      <div v-if="!registrationPending && !existing && !replacementId && !hasDolphin" class="scenario-buttons" aria-label="Выберите сценарий LinkedIn">
        <button type="button" :aria-pressed="scenario === 'existing'" @click="selectScenario('existing')">У меня есть LinkedIn</button>
        <button type="button" :aria-pressed="scenario === 'new'" @click="selectScenario('new')">Нет LinkedIn / аккаунт заблокирован</button>
      </div>
      <p v-if="scenario === 'existing' && hasDolphin">Откройте свой профиль через карточку Dolphin выше. Данные существующего LinkedIn можно сохранить в разделе «Аккаунты платформ».</p>
      <template v-if="scenario === 'existing' && !hasDolphin">
        <h3>Сначала настройте Octo и войдите в LinkedIn</h3>
        <p>Используйте свой прокси. Готовые профили и сохранённый прокси повторно создавать не нужно. Получите доступ к EN-профилю и войдите в свой LinkedIn.</p>
        <OctoAccessCard :client-id="client.id" @status="status = $event" @access-issued="opened = true" @proxy-changed="resetConfirmation" />
        <form v-if="ready && existingFormEnabled" @submit.prevent="save" class="intake-form" data-testid="linkedin-existing-form">
          <label>Ссылка на профиль<input v-model="form.url" required placeholder="https://www.linkedin.com/in/…" autocomplete="off"></label>
          <label>Логин LinkedIn (email или телефон)<input v-model="form.login" required autocomplete="off"></label>
          <label>Пароль LinkedIn<input v-model="form.password" type="password" :required="!secrets.hasPassword" :placeholder="secrets.hasPassword ? 'Сохранён. Оставьте пустым, чтобы не менять' : ''" autocomplete="new-password"></label>
          <label class="checkpoint"><input v-model="form.loggedIn" type="checkbox" :disabled="!opened">Я успешно вошёл/вошла в LinkedIn через Octo</label>
          <p v-if="!opened">Сначала получите доступ к EN-профилю Octo и войдите в LinkedIn.</p>
          <button type="submit" :disabled="!canSave">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button>
        </form>
      </template>
      <form v-if="scenario === 'new'" @submit.prevent="save" @invalid.capture="showInvalidField" @input="validationError = ''" class="intake-form" data-testid="linkedin-new-form">
        <details :open="!registrationPending || !!replacementId" class="intake-details" data-testid="linkedin-outlook-details">
          <summary>Данные Outlook</summary>
          <div class="intake-fields">
        <details open data-testid="outlook-instructions"><summary>Инструкция по созданию почты Outlook</summary><ol>
          <li>Создай новую почту на outlook.com с телефона через мобильный интернет. VPN выключи, твоя локация не имеет значения. Если ты в РФ, оставь VPN включенным.</li>
          <li>Адрес — имя.фамилия латиницей. Если занят — добавь цифры.</li>
          <li>Номер телефона к почте привязывать не нужно.</li>
          <li>Почте нужно «полежать» хотя бы сутки до регистрации LinkedIn, поэтому сделай её сегодня.</li>
          <li>Двухфакторку не ставь.</li>
        </ol></details>
        <label>Логин от новой почты Outlook<input ref="outlookInput" v-model="form.outlookLogin" type="email" required autocomplete="off" aria-label="Логин от новой почты Outlook" placeholder="name@outlook.com" :aria-invalid="!!outlookError" :aria-describedby="outlookError ? 'outlook-error' : undefined" @input="outlookError = ''" @blur="validateOutlook">
          <span v-if="outlookError" id="outlook-error" class="validation-error" role="alert">{{ outlookError }}</span>
        </label>
        <label>Пароль от новой почты Outlook<input v-model="form.outlookPassword" type="password" :required="!secrets.hasOutlookPassword" :placeholder="secrets.hasOutlookPassword ? 'Сохранён. Оставьте пустым, чтобы не менять' : ''" autocomplete="new-password"></label>
        <label>Дата и время регистрации Outlook-почты
          <input v-model="registrationDate" type="datetime-local" required aria-label="Дата и время регистрации Outlook-почты" aria-describedby="outlook-registration-timezone">
          <small id="outlook-registration-timezone">Часовой пояс устройства: {{ timeZone }}</small>
        </label>
        <label>Имя латиницей (как в иностранных документах)<input v-model="form.firstName" required></label>
        <label>Фамилия латиницей (как в иностранных документах)<input v-model="form.lastName" required></label>
        <label>Город и страна проживания<input v-model="form.realLocation" placeholder="Tbilisi, Georgia" required></label>
          </div>
        </details>
        <details class="blocked-history intake-details" aria-labelledby="blocked-title" data-testid="linkedin-blocked-details">
          <summary id="blocked-title">Старые заблокированные аккаунты ({{ form.blockedAccounts.length }})</summary>
          <p>Если аккаунты LinkedIn были заблокированы, добавь их ниже. Можно ничего не добавлять; все поля необязательные.</p>
          <article v-for="(account, index) in form.blockedAccounts" :key="index" class="blocked-account">
            <h4>Аккаунт {{ index + 1 }}</h4>
            <label v-for="(label, field) in historyFields" :key="field">{{ label }}<input v-model="account[field]"></label>
            <label v-if="account.legacyText !== undefined">Ранее сохранённый текст<textarea v-model="account.legacyText" rows="4" /></label>
            <button type="button" @click="form.blockedAccounts.splice(index, 1)">Удалить аккаунт {{ index + 1 }}</button>
          </article>
          <button type="button" @click="form.blockedAccounts.push({})">＋ Добавить заблокированный аккаунт</button>
        </details>
        <p>После сохранения создадим заявку эксперту на подготовку LinkedIn. Недостающие профили Octo подготовятся автоматически; готовые профили и их прокси сохраняются.</p>
        <p v-if="validationError" class="validation-error" role="alert" data-testid="linkedin-validation-error">{{ validationError }}</p>
        <button type="submit" :disabled="!canSave">{{ saving ? 'Сохраняем…' : registrationPending ? 'Сохранить изменения' : hasDolphin ? 'Сохранить данные' : 'Сохранить и подготовить Octo' }}</button>
      </form>
      <p v-if="message" role="status">{{ message }}</p>
      <OctoAccessCard v-if="scenario === 'new' && newSaved && usesOcto && !registrationPending" :client-id="client.id" :setup-enabled="false" />
    </template>
    <Dialog v-model:visible="showSavedDialog" modal header="Спасибо, данные сохранены ✅" :closable="false" :draggable="false" :style="{ width: '32rem', maxWidth: 'calc(100vw - 2rem)' }">
      <p>{{ pendingMessage }}</p>
      <p v-if="!hadLinkedInBeforeTask">Пока ждёшь, пожалуйста, не заходи в профиль Octo: это может помешать регистрации.</p>
      <template #footer><button type="button" autofocus @click="showSavedDialog = false">Понятно</button></template>
    </Dialog>
  </section>
</template>
<style scoped>
.validation-error{color:#b91c1c;font-weight:600;grid-column:1 / -1}
input[aria-invalid="true"]{border-color:#b91c1c}
:global(.linkedin-intake-layout){min-width:0;grid-template-columns:minmax(0,1fr)}
:global(.linkedin-intake-layout > *){min-width:0}
.linkedin-card{grid-column:1 / -1;min-width:0;padding:24px;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:12px;background:var(--p-content-background,#fff);color:var(--p-text-color,#1f2937)}
h2{margin:0 0 12px;font-size:20px}p{line-height:1.5}.scenario-buttons{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.intake-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:20px}
.intake-form>details,.intake-form>section,.intake-form>p,.intake-form>button,.intake-form>.checkpoint{grid-column:1 / -1}
.intake-details{padding:14px;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:8px;min-width:0}
.intake-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}
.intake-fields>details{grid-column:1 / -1}
label{display:grid;gap:6px;font-weight:600}input,textarea{min-width:0;width:100%;padding:10px;border:1px solid var(--p-content-border-color,#cbd5e1);border-radius:6px;font:inherit;background:var(--p-content-background,#fff);color:inherit}
.checkpoint{display:flex;align-items:center;gap:10px}.checkpoint input{width:auto}.blocked-account{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:8px;margin:12px 0}h4{margin:0}.blocked-account>h4,.blocked-account>button{grid-column:1 / -1}
summary{cursor:pointer;font-weight:600}button{justify-self:start;padding:10px 14px;border:1px solid var(--p-primary-color,#2563eb);border-radius:6px;font:inherit;cursor:pointer}button[aria-pressed=true],button[type=submit]{background:var(--p-primary-color,#2563eb);color:var(--p-primary-contrast-color,#fff)}button:disabled{opacity:.55;cursor:default}
@media(max-width:640px){.intake-form,.intake-fields,.blocked-account{grid-template-columns:minmax(0,1fr)}.linkedin-card{padding:18px}}
</style>
