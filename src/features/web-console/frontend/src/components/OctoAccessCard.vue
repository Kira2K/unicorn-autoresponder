<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { octoApi, octoGrantForDisplay, octoProxyDraft } from '../octo-api.js'
import OctoManualSetup from './OctoManualSetup.vue'
import OctoProxyFields from './OctoProxyFields.vue'
import { octoOnboardingBusy } from '../octo-onboarding.js'

const props = defineProps({ clientId: { type: [Number, String], required: true }, setupEnabled: { type: Boolean, default: true } })
const emit = defineEmits(['status', 'access-issued', 'proxy-changed'])
const visible = ref(false)
const status = ref({ profiles: [], requiredLocales: [] })
const grants = ref({})
const requesting = ref({})
const requestErrors = ref({})
const proxyDrafts = ref({})
const proxySaving = ref({})
const proxyMessages = ref({})
const message = ref('')
const copied = ref('')
const now = ref(Date.now())
const phaseLabels = {
  preparing: 'Подготавливаем доступ…', granted: 'Доступ выдан',
  awaiting_close: 'Ожидаем закрытия браузера', complete: 'Доступ завершён', blocked: 'Доступ заблокирован',
  deleting: 'Профиль удалён в Octo. Очищаем связанные данные…', deletion_blocked: 'Не удалось завершить очистку удалённого профиля'
}
function phaseLabel(profile) {
  const grant = grants.value[profile.id]
  if ((grant?.phase || profile.phase) === 'awaiting_close' && (grant?.error || profile.error) === 'octo_bridge_waiting')
    return 'Браузер закрыт. Завершаем доступ…'
  return phaseLabels[grant?.phase || profile.phase] || (profile.phase === 'ready' ? 'Профиль готов' : 'Профиль подготавливается…')
}
const proxyPhaseLabels = { queued: 'Прокси ожидает сохранения…', creating: 'Создаём прокси…',
  attaching: 'Подключаем прокси к профилю…', complete: 'Прокси сохранён', blocked: 'Не удалось сохранить прокси. Обратитесь к команде поддержки.' }
function proxyPending(profile) {
  return ['queued', 'creating', 'attaching'].includes(profile.proxy?.phase)
}
function canEditProxy(profile) {
  return profile.canEditProxy === true && !proxyPending(profile) && !proxySaving.value[profile.id] &&
    !requesting.value[profile.id] && !['preparing', 'granted', 'awaiting_close'].includes(grants.value[profile.id]?.phase || profile.phase)
}
function failureMessage(profile) {
  const code = grants.value[profile.id]?.error || profile.error
  if (code === 'octo_proxy_unavailable') return 'Для английского профиля пока нет свободного прокси.'
  if (['octo_event_history_gap', 'octo_force_stop_observed'].includes(code))
    return 'Профиль скрыт и остаётся защищённым. Для завершения доступа обратитесь к команде поддержки.'
  return 'Не удалось завершить операцию. Обратитесь к команде поддержки.'
}
let generation = 0
let mounted = false
let pollTimer
let clockTimer
let controller

function active(version) {
  return mounted && version === generation && !document.hidden
}

function stop() {
  generation += 1
  clearTimeout(pollTimer)
  clearInterval(clockTimer)
  controller?.abort()
  controller = undefined
  requesting.value = {}
  proxyDrafts.value = {}
  proxySaving.value = {}
  proxyMessages.value = {}
  copied.value = ''
  // Retain public IDs to resume polling, discard credentials immediately.
  grants.value = Object.fromEntries(Object.entries(grants.value).map(([id, grant]) => {
    const { password, guest, ...publicFields } = grant
    return [id, publicFields]
  }))
}

function denied(error) {
  if (![401, 403].includes(error.status)) return false
  stop()
  visible.value = false
  status.value = { profiles: [], requiredLocales: [] }
  grants.value = {}
  requestErrors.value = {}
  message.value = ''
  return true
}

function expireCredentials() {
  now.value = Date.now()
  grants.value = Object.fromEntries(Object.entries(grants.value).map(([id, grant]) =>
    [id, octoGrantForDisplay(grant, now.value)]))
}

async function refresh(version) {
  if (!active(version)) return
  try {
    const nextStatus = await octoApi.profileStatus({ signal: controller.signal })
    if (!active(version)) return
    status.value = nextStatus
    emit('status', nextStatus)
    visible.value = true
    message.value = ''
    const profileIds = new Set(nextStatus.profiles.map(profile => String(profile.id)))
    proxyDrafts.value = Object.fromEntries(nextStatus.profiles.map(profile =>
      [profile.id, proxyDrafts.value[profile.id] || octoProxyDraft(profile.proxy)]))
    proxyMessages.value = Object.fromEntries(Object.entries(proxyMessages.value).filter(([id]) => profileIds.has(id)))
    grants.value = Object.fromEntries(Object.entries(grants.value).filter(([id]) => profileIds.has(id)))
    requestErrors.value = Object.fromEntries(Object.entries(requestErrors.value).filter(([id]) => profileIds.has(id)))
    await Promise.all(nextStatus.profiles.map(async profile => {
      if (['deleting', 'deletion_blocked'].includes(profile.phase)) {
        delete grants.value[profile.id]
        delete requestErrors.value[profile.id]
        delete proxyDrafts.value[profile.id]
        return
      }
      const current = grants.value[profile.id]
      const grantId = (current && !['complete', 'blocked'].includes(current.phase) ? current.id : profile.grantId) || current?.id
      if (!grantId) return
      try {
        const grant = await octoApi.grant(grantId, { signal: controller.signal })
        if (active(version) && grants.value[profile.id]?.id === current?.id) {
          grants.value = { ...grants.value, [profile.id]: octoGrantForDisplay(grant) }
          if (profile.locale === 'en' && grant.phase === 'granted' && grant.expiresAt > Date.now()) emit('access-issued', profile.id)
          if (['preparing', 'granted'].includes(grant.phase)) delete requestErrors.value[profile.id]
        }
      } catch (error) {
        if (!active(version) || error.name === 'AbortError') return
        if (!denied(error)) {
          const previous = grants.value[profile.id]
          if (previous && previous.id === current?.id) {
            const { password, guest, ...publicFields } = previous
            grants.value[profile.id] = publicFields
          }
          message.value = 'Не удалось обновить доступ. Повторяем проверку…'
        }
      }
    }))
  } catch (error) {
    if (active(version) && error.name !== 'AbortError' && !denied(error) && visible.value) {
      message.value = 'Не удалось обновить состояние. Повторяем проверку…'
    }
  } finally {
    if (active(version)) pollTimer = setTimeout(() => refresh(version), 2000)
  }
}

function start() {
  stop()
  if (!mounted || document.hidden || !props.clientId) return
  controller = new AbortController()
  const version = generation
  expireCredentials()
  clockTimer = setInterval(expireCredentials, 1000)
  refresh(version)
}

function onboardingQueued() {
  status.value = { ...status.value, onboarding: { ...status.value.onboarding, phase: 'queued', error: undefined } }
}

function canRequest(profile) {
  const phase = grants.value[profile.id]?.phase
  return profile.phase === 'ready' && !octoOnboardingBusy(status.value) && status.value.onboarding?.phase !== 'awaiting_confirmation' &&
    !requesting.value[profile.id] && !proxySaving.value[profile.id] && !proxyPending(profile) &&
    !['preparing', 'granted', 'awaiting_close'].includes(phase)
}

async function saveProxy(profile) {
  if (!canEditProxy(profile) || !visible.value || document.hidden) return
  const version = generation
  proxySaving.value[profile.id] = true
  proxyMessages.value[profile.id] = ''
  try {
    await octoApi.saveProxy(profile.id, proxyDrafts.value[profile.id], { signal: controller.signal })
    emit('proxy-changed')
    if (active(version)) {
      const draft = proxyDrafts.value[profile.id]
      proxyDrafts.value[profile.id] = octoProxyDraft({ type: draft.type, host: draft.host, port: draft.port })
      status.value = { ...status.value, profiles: status.value.profiles.map(item => item.id === profile.id
        ? { ...item, canEditProxy: false, proxy: { ...item.proxy, phase: 'queued' } } : item) }
      proxyMessages.value[profile.id] = 'Прокси отправлен на сохранение.'
    }
  } catch (error) {
    if (active(version) && error.name !== 'AbortError' && !denied(error)) {
      proxyMessages.value[profile.id] = error.message === 'invalid_proxy_fields'
        ? 'Проверьте тип, адрес, порт и URL смены IP.' : 'Не удалось сохранить прокси. Попробуйте ещё раз.'
    }
  } finally {
    if (active(version)) proxySaving.value[profile.id] = false
  }
}

async function requestAccess(profile) {
  if (!canRequest(profile) || !visible.value || document.hidden) return
  const version = generation
  requesting.value[profile.id] = true
  delete requestErrors.value[profile.id]
  message.value = ''
  try {
    const grant = await octoApi.requestGrant(profile.id, { signal: controller.signal })
    if (active(version)) grants.value = { ...grants.value, [profile.id]: octoGrantForDisplay(grant) }
  } catch (error) {
    if (active(version) && error.name !== 'AbortError' && !denied(error))
      requestErrors.value[profile.id] = 'Не удалось запросить доступ. Обратитесь в поддержку.'
  } finally {
    if (active(version)) requesting.value[profile.id] = false
  }
}

function countdown(grant) {
  const seconds = Math.max(0, Math.ceil((grant.expiresAt - now.value) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

async function copy(profileId, field) {
  expireCredentials()
  const grant = grants.value[profileId]
  if (!grant?.password) return
  const value = field === 'email' ? grant.guest?.email : field === 'guestPassword' ? grant.guest?.password : grant.password
  if (typeof value !== 'string') return
  const version = generation
  try {
    await navigator.clipboard.writeText(value)
    if (active(version)) copied.value = `${profileId}:${field}`
  } catch {
    if (active(version)) message.value = 'Не удалось скопировать. Выделите поле и скопируйте вручную.'
  }
}

function visibilityChanged() {
  if (document.hidden) stop()
  else start()
}

watch(() => props.clientId, () => {
  stop()
  visible.value = false
  status.value = { profiles: [], requiredLocales: [] }
  grants.value = {}
  requestErrors.value = {}
  message.value = ''
  start()
})
onMounted(() => {
  mounted = true
  document.addEventListener('visibilitychange', visibilityChanged)
  start()
})
onUnmounted(() => {
  mounted = false
  stop()
  grants.value = {}
  document.removeEventListener('visibilitychange', visibilityChanged)
})
</script>

<template>
  <section v-if="visible" class="octo-card" aria-labelledby="octo-title">
    <h2 id="octo-title">Профиль Octo — бета</h2>
    <p>Создай профили Octo Browser и получи временный доступ отдельно для каждого рынка.</p>
    <OctoManualSetup v-if="setupEnabled" :status="status" @queued="onboardingQueued" @denied="denied" />
    <p v-if="status.provisioning?.phase === 'blocked' || status.provisioning?.error" role="alert">
      {{ status.provisioning.error || 'Создание профилей заблокировано.' }}
    </p>
    <p v-if="message" role="status">{{ message }}</p>
    <article v-for="profile in status.profiles" :key="profile.id" class="octo-profile" :data-testid="`octo-profile-${profile.id}`">
      <h3>{{ profile.title }} · {{ profile.locale.toUpperCase() }}</h3>
      <p>{{ phaseLabel(profile) }}</p>
      <button type="button" :disabled="!canRequest(profile)" @click="requestAccess(profile)">
        {{ requesting[profile.id] ? 'Запрашиваем доступ…' : 'Получить доступ' }}
      </button>
      <div v-if="requestErrors[profile.id]" role="alert">
        <p>{{ requestErrors[profile.id] }}</p>
        <a href="https://t.me/veu_support_bot" target="_blank" rel="noopener noreferrer">Поддержка</a>
      </div>
      <div v-if="grants[profile.id]?.password" class="octo-credentials">
        <p v-if="grants[profile.id].alias">Профиль в браузере: <strong>{{ grants[profile.id].alias }}</strong></p>
        <p role="timer">Доступ действует ещё {{ countdown(grants[profile.id]) }}</p>
        <template v-if="grants[profile.id].guest">
          <label class="octo-field">Почта
            <span><input :value="grants[profile.id].guest.email" type="text" readonly autocomplete="off" aria-label="Почта">
              <button type="button" @click="copy(profile.id, 'email')">{{ copied === `${profile.id}:email` ? 'Скопировано' : 'Копировать' }}</button></span>
          </label>
          <label class="octo-field">Пароль от аккаунта (вводится вместе с почтой)
            <span><input :value="grants[profile.id].guest.password" type="text" readonly autocomplete="off" spellcheck="false" aria-label="Пароль от аккаунта (вводится вместе с почтой)">
              <button type="button" @click="copy(profile.id, 'guestPassword')">{{ copied === `${profile.id}:guestPassword` ? 'Скопировано' : 'Копировать' }}</button></span>
          </label>
        </template>
        <label class="octo-field">Пароль к профилям (пароли идентичны для всех твоих профилей)
          <span><input :value="grants[profile.id].password" type="text" readonly autocomplete="off" spellcheck="false" aria-label="Пароль к профилям (пароли идентичны для всех твоих профилей)">
            <button type="button" @click="copy(profile.id, 'password')">{{ copied === `${profile.id}:password` ? 'Скопировано' : 'Копировать' }}</button></span>
        </label>
      </div>
      <p v-else-if="grants[profile.id]?.phase === 'granted'">Данные входа скрыты. Если срок доступа истёк, дождитесь завершения доступа.</p>
      <p v-if="grants[profile.id]?.phase === 'blocked' || ['blocked', 'deletion_blocked'].includes(profile.phase)" role="alert">{{ failureMessage(profile) }}</p>
      <div class="octo-proxy" :data-testid="`octo-proxy-status-${profile.id}`">
        <h4>Прокси профиля</h4>
        <p v-if="profile.proxy?.configured">Текущий прокси: {{ profile.proxy.type }} · {{ profile.proxy.host }}:{{ profile.proxy.port }}</p>
        <p v-else>Прокси пока не настроен.</p>
        <p v-if="profile.proxy?.phase" :role="profile.proxy.phase === 'blocked' ? 'alert' : 'status'">{{ proxyPhaseLabels[profile.proxy.phase] || 'Проверяем состояние прокси…' }}</p>
        <p v-else-if="profile.proxy?.error" role="alert">Не удалось обновить прокси. Обратитесь к команде поддержки.</p>
        <p v-if="proxyMessages[profile.id]" role="status">{{ proxyMessages[profile.id] }}</p>
      </div>
      <details class="octo-proxy-settings">
        <summary>Свой прокси — дополнительные настройки</summary>
        <p>Этот раздел нужен только для пользователей со своей настройкой прокси.</p>
        <form v-if="proxyDrafts[profile.id]" class="octo-proxy-form" :data-testid="`octo-proxy-form-${profile.id}`" @submit.prevent="saveProxy(profile)">
          <fieldset :disabled="!canEditProxy(profile)">
            <legend>Настроить прокси</legend>
            <OctoProxyFields v-model="proxyDrafts[profile.id]" :prefix="`octo-proxy-${profile.id}`" />
            <button type="submit" :data-testid="`octo-proxy-save-${profile.id}`">{{ proxySaving[profile.id] ? 'Сохраняем прокси…' : 'Сохранить прокси' }}</button>
          </fieldset>
        </form>
      </details>
    </article>
    <p class="octo-note">После окончания срока доступа уже открытый браузер можно продолжать использовать. Для завершения работы закройте его.</p>
  </section>
</template>

<style scoped>
.octo-card { padding: 24px; border: 1px solid #dbe3ee; border-radius: 12px; background: #fff; }
.octo-card h2 { margin: 0 0 12px; font-size: 20px; }
.octo-card h3 { margin: 0; font-size: 17px; }
.octo-card p { line-height: 1.5; }
.octo-create, .octo-credentials { display: grid; gap: 12px; }
.octo-profile { margin-top: 20px; padding-top: 20px; border-top: 1px solid #dbe3ee; }
.octo-field { display: grid; gap: 6px; font-weight: 600; }
.octo-field span { display: flex; gap: 8px; flex-wrap: wrap; }
.octo-field input { min-width: 0; flex: 1; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; }
.octo-proxy { margin-top: 20px; }
.octo-proxy h4 { margin: 0; }
.octo-proxy-form fieldset { margin: 12px 0 0; padding: 16px; border: 1px solid #dbe3ee; border-radius: 8px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.octo-proxy-form legend { font-weight: 600; padding: 0 6px; }
.octo-field select { padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; background: #fff; }
@media (max-width: 600px) { .octo-proxy-form fieldset { grid-template-columns: 1fr; } }
.octo-card button { justify-self: start; padding: 10px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font: inherit; cursor: pointer; }
.octo-card button:disabled { opacity: .55; cursor: default; }
.octo-card button:focus-visible, .octo-field input:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.octo-note { color: #526176; font-size: 14px; margin-bottom: 0; }
</style>
