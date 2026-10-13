<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { octoApi, octoGrantForDisplay } from '../octo-api.js'

const props = defineProps({ clientId: { type: [Number, String], required: true } })
const visible = ref(false)
const status = ref({ profiles: [], requiredLocales: [] })
const grants = ref({})
const requesting = ref({})
const creating = ref(false)
const ownProxy = ref(false)
const message = ref('')
const copied = ref('')
const now = ref(Date.now())
const missingProfiles = computed(() => status.value.requiredLocales.some(locale =>
  !status.value.profiles.some(profile => profile.locale === locale)))
const provisioning = computed(() => ['preparing', 'queued', 'running', 'provisioning'].includes(status.value.provisioning?.phase))
const phaseLabels = {
  preparing: 'Подготавливаем доступ…', granted: 'Доступ выдан',
  awaiting_close: 'Ожидаем закрытия браузера', complete: 'Доступ завершён', blocked: 'Доступ заблокирован'
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
  creating.value = false
  requesting.value = {}
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
    visible.value = true
    message.value = ''
    const profileIds = new Set(nextStatus.profiles.map(profile => String(profile.id)))
    grants.value = Object.fromEntries(Object.entries(grants.value).filter(([id]) => profileIds.has(id)))
    await Promise.all(nextStatus.profiles.map(async profile => {
      const current = grants.value[profile.id]
      const grantId = (current && !['complete', 'blocked'].includes(current.phase) ? current.id : profile.grantId) || current?.id
      if (!grantId) return
      try {
        const grant = await octoApi.grant(grantId, { signal: controller.signal })
        if (active(version) && grants.value[profile.id]?.id === current?.id) {
          grants.value = { ...grants.value, [profile.id]: octoGrantForDisplay(grant) }
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

async function createProfiles() {
  if (creating.value || !visible.value || document.hidden) return
  const version = generation
  creating.value = true
  message.value = ''
  try {
    await octoApi.ensureProfiles(ownProxy.value, { signal: controller.signal })
    if (active(version)) status.value = { ...status.value, provisioning: { phase: 'preparing' } }
  } catch (error) {
    if (active(version) && error.name !== 'AbortError' && !denied(error)) message.value = 'Не удалось создать профили. Попробуйте ещё раз.'
  } finally {
    if (active(version)) creating.value = false
  }
}

function canRequest(profile) {
  const phase = grants.value[profile.id]?.phase
  return profile.phase === 'ready' && !requesting.value[profile.id] &&
    !['preparing', 'granted', 'awaiting_close'].includes(phase)
}

async function requestAccess(profile) {
  if (!canRequest(profile) || !visible.value || document.hidden) return
  const version = generation
  requesting.value[profile.id] = true
  message.value = ''
  try {
    const grant = await octoApi.requestGrant(profile.id, { signal: controller.signal })
    if (active(version)) grants.value = { ...grants.value, [profile.id]: octoGrantForDisplay(grant) }
  } catch (error) {
    if (active(version) && error.name !== 'AbortError' && !denied(error)) message.value = 'Не удалось запросить доступ. Попробуйте ещё раз.'
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
  ownProxy.value = false
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
    <h2 id="octo-title">Тестируем новый браузер - твоего профиля тут пока нет</h2>
    <p>Создайте профили для тестирования Octo Browser и запросите временный доступ отдельно для каждого рынка.</p>
    <div v-if="missingProfiles || !status.profiles.length" class="octo-create">
      <label><input v-model="ownProxy" type="checkbox" :disabled="creating || provisioning"> Использовать свой прокси</label>
      <button type="button" :disabled="creating || provisioning" @click="createProfiles">
        {{ creating || provisioning ? 'Создаём профили…' : 'Создать профили' }}
      </button>
    </div>
    <p v-if="status.provisioning?.phase === 'blocked' || status.provisioning?.error" role="alert">
      {{ status.provisioning.error || 'Создание профилей заблокировано.' }}
    </p>
    <p v-if="message" role="status">{{ message }}</p>
    <article v-for="profile in status.profiles" :key="profile.id" class="octo-profile">
      <h3>{{ profile.title }} · {{ profile.locale.toUpperCase() }}</h3>
      <p>{{ phaseLabels[grants[profile.id]?.phase || profile.phase] || (profile.phase === 'ready' ? 'Профиль готов' : 'Профиль подготавливается…') }}</p>
      <button type="button" :disabled="!canRequest(profile)" @click="requestAccess(profile)">
        {{ requesting[profile.id] ? 'Запрашиваем доступ…' : 'Получить доступ' }}
      </button>
      <div v-if="grants[profile.id]?.password" class="octo-credentials">
        <p v-if="grants[profile.id].alias">Профиль в браузере: <strong>{{ grants[profile.id].alias }}</strong></p>
        <p role="timer">Доступ действует ещё {{ countdown(grants[profile.id]) }}</p>
        <label class="octo-field">Пароль доступа
          <span><input :value="grants[profile.id].password" type="text" readonly autocomplete="off" spellcheck="false" aria-label="Пароль доступа">
            <button type="button" @click="copy(profile.id, 'password')">{{ copied === `${profile.id}:password` ? 'Скопировано' : 'Копировать' }}</button></span>
        </label>
        <template v-if="grants[profile.id].guest">
          <label class="octo-field">Почта гостя
            <span><input :value="grants[profile.id].guest.email" type="text" readonly autocomplete="off" aria-label="Почта гостя">
              <button type="button" @click="copy(profile.id, 'email')">{{ copied === `${profile.id}:email` ? 'Скопировано' : 'Копировать' }}</button></span>
          </label>
          <label class="octo-field">Пароль гостя
            <span><input :value="grants[profile.id].guest.password" type="text" readonly autocomplete="off" spellcheck="false" aria-label="Пароль гостя">
              <button type="button" @click="copy(profile.id, 'guestPassword')">{{ copied === `${profile.id}:guestPassword` ? 'Скопировано' : 'Копировать' }}</button></span>
          </label>
        </template>
      </div>
      <p v-else-if="grants[profile.id]?.phase === 'granted'">Данные входа скрыты. Если срок доступа истёк, дождитесь завершения доступа.</p>
      <p v-if="grants[profile.id]?.phase === 'blocked' || profile.phase === 'blocked'" role="alert">{{ failureMessage(profile) }}</p>
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
.octo-card button { justify-self: start; padding: 10px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font: inherit; cursor: pointer; }
.octo-card button:disabled { opacity: .55; cursor: default; }
.octo-card button:focus-visible, .octo-field input:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.octo-note { color: #526176; font-size: 14px; margin-bottom: 0; }
</style>
