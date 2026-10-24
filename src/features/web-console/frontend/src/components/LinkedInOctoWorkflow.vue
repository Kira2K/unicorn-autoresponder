<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import OctoAccessCard from './OctoAccessCard.vue'
import { intakeRequest, intakeScenario, infrastructureReady, infrastructureSignature } from '../linkedin-intake.js'
import { isOutlookLogin } from '../../../../linkedin-automation/console-intake/contracts.mts'
const props = defineProps({ client: { type: Object, required: true }, hasDolphin: { type: Boolean, default: false } })
const emit = defineEmits(['saved'])
const loaded = ref(false), loading = ref(false), loadError = ref(''), message = ref(''), saving = ref(false)
const scenario = ref(''), existing = ref(false), newSaved = ref(false), opened = ref(false), status = ref(null)
const form = ref({ url: '', login: '', password: '', outlookLogin: '', outlookPassword: '', firstName: '', lastName: '', realLocation: '', blockedAccounts: [], loggedIn: false })
const secrets = ref({ hasPassword: false, hasOutlookPassword: false })
const controller = new AbortController()
const outlookError = ref('')
const ready = computed(() => infrastructureReady(status.value))
const historyFields = { fullName: 'Какие имя и фамилия стояли?', country: 'Какая страна была указана?', company: 'Какая компания была указана?', position: 'Какая должность была указана?', blockedAt: 'Когда заблокировали аккаунт?', newFullName: 'Имя и фамилия латиницей для нового аккаунта' }
const canSave = computed(() => loaded.value && !saving.value && (scenario.value === 'new' || (!props.hasDolphin && ready.value && opened.value && form.value.loggedIn)))
async function load() {
  if (loading.value) return
  loading.value = true; loadError.value = ''
  try {
    const data = await intakeRequest('GET', undefined, controller.signal)
    if (controller.signal.aborted) return
    form.value = { ...form.value, ...data, realLocation: data.realLocation || props.client.realLocation || '', password: '', outlookPassword: '', loggedIn: false }
    secrets.value = data; scenario.value = intakeScenario(data); existing.value = !!scenario.value
    newSaved.value = !!data.hasOutlookPassword && !!data.firstName; loaded.value = true
  } catch (error) { if (error.name !== 'AbortError') loadError.value = 'Не удалось загрузить данные LinkedIn. Попробуйте ещё раз.' }
  finally { loading.value = false }
}
function resetConfirmation() { form.value.loggedIn = false; opened.value = false }
watch(() => [form.value.url, form.value.login, form.value.password], () => { form.value.loggedIn = false })
watch(() => infrastructureSignature(status.value), resetConfirmation)
watch(scenario, () => { resetConfirmation(); form.value.password = ''; form.value.outlookPassword = ''; message.value = '' })
function selectScenario(value) { scenario.value = value }
async function save() {
  if (!canSave.value) return
  outlookError.value = ''
  if (scenario.value === 'new' && !isOutlookLogin(form.value.outlookLogin)) {
    outlookError.value = 'Укажите полный адрес почты Outlook, например name@outlook.com.'
    return
  }
  saving.value = true; message.value = ''
  try {
    await intakeRequest('PUT', { ...form.value, scenario: scenario.value }, controller.signal)
    if (controller.signal.aborted) return
    if (scenario.value === 'new') {
      newSaved.value = true; secrets.value.hasOutlookPassword = true
      message.value = props.hasDolphin ? 'Данные сохранены. Продолжайте использовать существующие профили Dolphin. Сам аккаунт LinkedIn пока не создаётся.' :
        'Данные сохранены. Создаём профили Octo — это произойдёт в фоновом режиме. Сам аккаунт LinkedIn пока не создаётся.'
    } else { existing.value = true; secrets.value.hasPassword = true; message.value = 'Данные LinkedIn сохранены.' }
    form.value.password = ''; form.value.outlookPassword = ''; form.value.loggedIn = false; emit('saved')
  } catch (error) {
    if (error.name === 'AbortError') return
    if (error.message === 'commit_uncertain') {
      loaded.value = false
      form.value.password = ''; form.value.outlookPassword = ''
      loadError.value = 'Результат сохранения неизвестен. Нажмите «Повторить», чтобы перечитать сохранённые данные. Повторная отправка не запускается автоматически.'
      return
    }
    message.value = error.message.includes('ambiguous') ? 'Найдено несколько аккаунтов. Обратитесь в поддержку: данные не перезаписаны.' :
      'Не удалось сохранить. Проверьте поля и состояние Octo; при повторной ошибке обратитесь в поддержку.'
  } finally { saving.value = false }
}
onMounted(load)
onUnmounted(() => { controller.abort(); form.value.password = ''; form.value.outlookPassword = '' })
</script>
<template>
  <section v-if="!hasDolphin || (loaded && !existing) || loadError" class="linkedin-card" aria-labelledby="linkedin-intake-title" data-testid="linkedin-octo-workflow">
    <h2 id="linkedin-intake-title">LinkedIn</h2>
    <p v-if="loading" role="status">Загружаем данные…</p>
    <div v-if="loadError" role="alert">{{ loadError }} <button type="button" @click="load">Повторить</button></div>
    <template v-if="loaded">
      <div v-if="!existing" class="scenario-buttons" aria-label="Выберите сценарий LinkedIn">
        <button type="button" :aria-pressed="scenario === 'existing'" @click="selectScenario('existing')">У меня есть LinkedIn</button>
        <button type="button" :aria-pressed="scenario === 'new'" @click="selectScenario('new')">Нет LinkedIn / аккаунт заблокирован</button>
      </div>
      <p v-if="scenario === 'existing' && hasDolphin">Откройте свой профиль через карточку Dolphin выше. Данные существующего LinkedIn можно сохранить в разделе «Аккаунты платформ».</p>
      <template v-if="scenario === 'existing' && !hasDolphin">
        <h3>Сначала настройте Octo и войдите в LinkedIn</h3>
        <p>Используйте свой прокси. Готовые профили и сохранённый прокси повторно создавать не нужно. Получите доступ к EN-профилю и войдите в свой LinkedIn.</p>
        <OctoAccessCard :client-id="client.id" @status="status = $event" @access-issued="opened = true" @proxy-changed="resetConfirmation" />
        <form v-if="ready" @submit.prevent="save" class="intake-form" data-testid="linkedin-existing-form">
          <label>Ссылка на профиль<input v-model="form.url" required placeholder="https://www.linkedin.com/in/…" autocomplete="off"></label>
          <label>Логин LinkedIn (email или телефон)<input v-model="form.login" required autocomplete="off"></label>
          <label>Пароль LinkedIn<input v-model="form.password" type="password" :required="!secrets.hasPassword" :placeholder="secrets.hasPassword ? 'Сохранён. Оставьте пустым, чтобы не менять' : ''" autocomplete="new-password"></label>
          <label class="checkpoint"><input v-model="form.loggedIn" type="checkbox" :disabled="!opened">Я успешно вошёл/вошла в LinkedIn через Octo</label>
          <p v-if="!opened">Сначала получите доступ к EN-профилю Octo и войдите в LinkedIn.</p>
          <button type="submit" :disabled="!canSave">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button>
        </form>
      </template>
      <form v-if="scenario === 'new'" @submit.prevent="save" class="intake-form" data-testid="linkedin-new-form">
        <details><summary>Инструкция по созданию почты Outlook</summary><ol>
          <li>Создай новую почту на outlook.com с телефона через мобильный интернет. VPN выключи, твоя локация не имеет значения.</li>
          <li>Адрес — имя.фамилия латиницей. Если занят — добавь цифры.</li>
          <li>Номер телефона к почте привязывать не нужно.</li>
          <li>Почте нужно «полежать» хотя бы сутки до регистрации LinkedIn, поэтому сделай её сегодня.</li>
          <li>Двухфакторку не ставь.</li>
        </ol></details>
        <label>Логин от новой почты Outlook<input v-model="form.outlookLogin" type="email" required autocomplete="off" aria-label="Логин от новой почты Outlook" :aria-invalid="!!outlookError" :aria-describedby="outlookError ? 'outlook-error' : undefined" @input="outlookError = ''">
          <span v-if="outlookError" id="outlook-error" role="alert">{{ outlookError }}</span>
        </label>
        <label>Пароль от новой почты Outlook<input v-model="form.outlookPassword" type="password" :required="!secrets.hasOutlookPassword" :placeholder="secrets.hasOutlookPassword ? 'Сохранён. Оставьте пустым, чтобы не менять' : ''" autocomplete="new-password"></label>
        <label>Имя латиницей (как в иностранных документах)<input v-model="form.firstName" required></label>
        <label>Фамилия латиницей (как в иностранных документах)<input v-model="form.lastName" required></label>
        <label>Реальная локация<input v-model="form.realLocation" required></label>
        <section class="blocked-history" aria-labelledby="blocked-title">
          <h3 id="blocked-title">Старые заблокированные аккаунты</h3>
          <p>Если аккаунты LinkedIn были заблокированы, добавь их ниже. Можно ничего не добавлять; все поля необязательные.</p>
          <article v-for="(account, index) in form.blockedAccounts" :key="index" class="blocked-account">
            <h4>Аккаунт {{ index + 1 }}</h4>
            <label v-for="(label, field) in historyFields" :key="field">{{ label }}<input v-model="account[field]"></label>
            <label v-if="account.legacyText !== undefined">Ранее сохранённый текст<textarea v-model="account.legacyText" rows="4" /></label>
            <button type="button" @click="form.blockedAccounts.splice(index, 1)">Удалить аккаунт {{ index + 1 }}</button>
          </article>
          <button type="button" @click="form.blockedAccounts.push({})">＋ Добавить заблокированный аккаунт</button>
        </section>
        <p>{{ hasDolphin ? 'Существующие профили Dolphin сохраняются. Новые профили Octo не создаются.' : 'После сохранения недостающие профили Octo будут созданы без прокси; готовые профили и их прокси сохраняются.' }} Сам аккаунт LinkedIn сейчас не создаётся.</p>
        <button type="submit" :disabled="!canSave">{{ saving ? 'Сохраняем…' : hasDolphin ? 'Сохранить данные' : 'Сохранить и подготовить Octo' }}</button>
      </form>
      <p v-if="message" role="status">{{ message }}</p>
      <OctoAccessCard v-if="scenario === 'new' && newSaved && !hasDolphin" :client-id="client.id" :setup-enabled="false" />
    </template>
  </section>
</template>
<style scoped>
:global(.linkedin-intake-layout){min-width:0;grid-template-columns:minmax(0,1fr)}
:global(.linkedin-intake-layout > *){min-width:0}
.linkedin-card{grid-column:1 / -1;min-width:0;padding:24px;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:12px;background:var(--p-content-background,#fff);color:var(--p-text-color,#1f2937)}
h2{margin:0 0 12px;font-size:20px}p{line-height:1.5}.scenario-buttons{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.intake-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:20px}
.intake-form>details,.intake-form>section,.intake-form>p,.intake-form>button,.intake-form>.checkpoint{grid-column:1 / -1}
label{display:grid;gap:6px;font-weight:600}input,textarea{min-width:0;width:100%;padding:10px;border:1px solid var(--p-content-border-color,#cbd5e1);border-radius:6px;font:inherit;background:var(--p-content-background,#fff);color:inherit}
.checkpoint{display:flex;align-items:center;gap:10px}.checkpoint input{width:auto}.blocked-account{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px;border:1px solid var(--p-content-border-color,#dbe3ee);border-radius:8px;margin:12px 0}h4{margin:0}.blocked-account>h4,.blocked-account>button{grid-column:1 / -1}
summary{cursor:pointer;font-weight:600}button{justify-self:start;padding:10px 14px;border:1px solid var(--p-primary-color,#2563eb);border-radius:6px;font:inherit;cursor:pointer}button[aria-pressed=true],button[type=submit]{background:var(--p-primary-color,#2563eb);color:var(--p-primary-contrast-color,#fff)}button:disabled{opacity:.55;cursor:default}
@media(max-width:640px){.intake-form,.blocked-account{grid-template-columns:minmax(0,1fr)}.linkedin-card{padding:18px}}
</style>
