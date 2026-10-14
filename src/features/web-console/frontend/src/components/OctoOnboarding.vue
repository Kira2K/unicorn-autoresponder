<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { octoApi } from '../octo-api.js'
import { canContinueOctoOnboarding, createOctoLocationPicker, missingOctoLocales, octoLocationComplete, octoOnboardingBusy } from '../octo-onboarding.js'

const props = defineProps({ status: { type: Object, required: true } })
const emit = defineEmits(['queued', 'denied'])
const windowsRequirement = 'Для работы с новыми профилями Octo нужен компьютер с Windows. Создавай профиль только если будешь открывать его в Octo на Windows.'
const warningVisible = ref(false)
const wizardVisible = ref(false)
const confirmDolphin = ref(false)
const source = ref('nodemaven')
const ownProxy = ref('')
const nodeKey = ref('')
const savedKey = ref(false)
const editingKey = ref(false)
const keySaving = ref(false)
const submitting = ref(false)
const message = ref('')
const profileId = ref('')
const locationState = ref({ location: {}, lists: {} })
let controller = new AbortController()
let mounted = true
const picker = createOctoLocationPicker((level, location) => octoApi.locations(level, location, { signal: controller.signal }), state => {
  if (mounted) locationState.value = state
})
const onboarding = computed(() => props.status.onboarding || {})
const busy = computed(() => submitting.value || octoOnboardingBusy(props.status))
const missingLocales = computed(() => missingOctoLocales(props.status))
const needsEn = computed(() => missingLocales.value.some(locale => locale.toLowerCase() === 'en'))
const dolphinProfiles = computed(() => onboarding.value.dolphinProfiles || [])
const importableProfiles = computed(() => dolphinProfiles.value.filter(profile => profile.hasProxy))
const hasKey = computed(() => savedKey.value || onboarding.value.hasNodeMavenKey === true)
const canContinue = computed(() => canContinueOctoOnboarding(onboarding.value))
const canSubmit = computed(() => !busy.value && !onboarding.value.developmentHelp && (
  source.value === 'own' ? Boolean(ownProxy.value.trim()) :
  source.value === 'dolphin' ? importableProfiles.value.some(profile => String(profile.id) === String(profileId.value)) :
  hasKey.value && !editingKey.value && !keySaving.value && octoLocationComplete(locationState.value.location, locationState.value.lists)
))

function handleError(error, fallback) {
  if (!mounted || error.name === 'AbortError') return
  if ([401, 403].includes(error.status)) { closeWizard(); emit('denied', error); return }
  message.value = fallback
}
function closeWizard() {
  wizardVisible.value = false
  ownProxy.value = ''
  nodeKey.value = ''
  editingKey.value = false
  keySaving.value = false
  picker.cancel()
  controller.abort()
  controller = new AbortController()
}
async function begin() {
  if (busy.value) return
  confirmDolphin.value = false
  message.value = ''
  if (dolphinProfiles.value.length) warningVisible.value = true
  else await openSetup()
}
async function confirmWarning() {
  warningVisible.value = false
  confirmDolphin.value = true
  await openSetup()
}
async function openSetup() {
  if (!needsEn.value) { await submit('none'); return }
  const previousSource = source.value
  source.value = 'nodemaven'
  profileId.value = importableProfiles.value[0]?.id || ''
  wizardVisible.value = true
  if (hasKey.value && previousSource === 'nodemaven') await picker.countries()
}
async function saveKey() {
  if (!nodeKey.value.trim() || keySaving.value) return
  keySaving.value = true
  message.value = ''
  const signal = controller.signal
  try {
    await octoApi.saveNodeMavenKey(nodeKey.value, { signal })
    if (!mounted || signal.aborted) return
    savedKey.value = true
    editingKey.value = false
    nodeKey.value = ''
    await picker.countries()
  } catch (error) { handleError(error, 'Не удалось сохранить ключ NodeMaven. Проверьте ключ и повторите попытку.') }
  finally { if (mounted && !signal.aborted) keySaving.value = false }
}
async function submit(selectedSource = source.value) {
  if (busy.value || (selectedSource !== 'none' && !canSubmit.value)) return
  submitting.value = true
  message.value = ''
  const signal = controller.signal
  const payload = { source: selectedSource, confirmDolphin: confirmDolphin.value }
  if (selectedSource === 'own') payload.proxy = ownProxy.value.trim()
  if (selectedSource === 'dolphin') payload.profileId = Number(profileId.value)
  if (selectedSource === 'nodemaven') {
    const { country, region, city } = locationState.value.location
    payload.location = { country, ...(region ? { region } : {}), ...(city ? { city } : {}) }
  }
  try {
    await octoApi.startOnboarding(payload, { signal })
    if (!mounted || signal.aborted) return
    closeWizard()
    emit('queued')
  } catch (error) { handleError(error, 'Не удалось начать настройку. Повторите попытку или обратитесь в поддержку.') }
  finally { if (mounted) submitting.value = false }
}
async function continueAnyway() {
  if (busy.value || !canContinue.value) return
  submitting.value = true
  message.value = ''
  const signal = controller.signal
  try {
    await octoApi.continueOnboarding(onboarding.value.id, { signal })
    if (mounted && !signal.aborted) emit('queued')
  } catch (error) { handleError(error, 'Не удалось продолжить настройку. Повторите попытку.') }
  finally { if (mounted) submitting.value = false }
}
watch(source, async next => {
  picker.cancel()
  ownProxy.value = ''
  nodeKey.value = ''
  message.value = ''
  if (next === 'nodemaven' && hasKey.value && wizardVisible.value) await picker.countries()
})
onUnmounted(() => { mounted = false; picker.cancel(); controller.abort(); nodeKey.value = ''; ownProxy.value = '' })
</script>

<template>
  <div class="octo-onboarding" data-testid="octo-onboarding">
    <p v-if="missingLocales.length" class="octo-warning" role="note">{{ windowsRequirement }}</p>
    <div v-if="onboarding.developmentHelp" class="octo-warning" role="alert" data-testid="octo-checker-local-help">
      <p>{{ onboarding.developmentHelp.message }}</p>
      <a :href="onboarding.developmentHelp.repositoryUrl" target="_blank" rel="noopener noreferrer">Установить proxy-checker — репозиторий и инструкции</a>
    </div>
    <div v-if="busy" class="octo-progress" role="status" aria-live="polite">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" />
      <div><strong>{{ onboarding.phase === 'provisioning' ? 'Создаём профили и подключаем прокси…' : 'Проверяем и настраиваем доступ…' }}</strong><p>Проверка может занять до 4 минут.</p></div>
    </div>
    <div v-else-if="onboarding.phase === 'awaiting_confirmation'" class="octo-warning" role="alert">
      <p>Оценка прокси: <strong>{{ onboarding.score ?? '—' }}/100</strong>. Качество ниже рекомендуемого. Обратитесь в поддержку, чтобы проверить настройки.</p>
      <a href="https://t.me/veu_support_bot" target="_blank" rel="noopener noreferrer">Поддержка</a>
      <Button v-if="canContinue" label="Продолжить в любом случае" severity="warn" @click="continueAnyway" />
    </div>
    <template v-else>
      <p v-if="onboarding.phase === 'complete'" role="status">{{ onboarding.source === 'none' ? 'Профили созданы.' : 'Профили созданы, прокси подключён.' }} Нажмите «Получить доступ» для нужного профиля.</p>
      <div v-if="['blocked', 'unknown'].includes(onboarding.phase) || onboarding.error" class="octo-warning" role="alert">
        <p>Не удалось завершить проверку или настройку. Обратитесь в поддержку перед повторной попыткой.</p>
        <a href="https://t.me/veu_support_bot" target="_blank" rel="noopener noreferrer">Поддержка</a>
      </div>
      <Button v-if="missingLocales.length && !['unknown', 'blocked'].includes(onboarding.phase)" :disabled="needsEn && !!onboarding.developmentHelp" :label="needsEn ? 'Сгенерировать NodeMaven прокси или протестировать свой' : 'Создать профили'" icon="pi pi-plus" @click="begin" />
    </template>
    <p v-if="message && !wizardVisible" role="alert">{{ message }}</p>

    <Dialog :visible="warningVisible" modal header="У тебя уже есть профиль в Dolphin" :style="{ width: 'min(620px, 94vw)' }" @update:visible="warningVisible = false"
      :pt="{ pcCloseButton: { root: { 'aria-label': 'Закрыть предупреждение' } } }">
      <p class="octo-dialog-copy">Если профиль Dolphin готов к работе, продолжай использовать его. Если создаёшь новый аккаунт после бана, сначала удали прежний аккаунт из Dolphin. При сомнениях обратись в поддержку.</p>
      <a href="https://t.me/veu_support_bot" target="_blank" rel="noopener noreferrer">Связаться с поддержкой</a>
      <template #footer>
        <Button label="Отмена" severity="secondary" @click="warningVisible = false" />
        <Button label="Продолжить в любом случае" severity="warn" @click="confirmWarning" />
      </template>
    </Dialog>

    <Dialog :visible="wizardVisible" modal header="Настройка прокси для Octo" :style="{ width: 'min(680px, 94vw)' }" :closable="!submitting" :close-on-escape="!submitting" :dismissable-mask="false" @update:visible="closeWizard"
      :pt="{ pcCloseButton: { root: { 'aria-label': 'Закрыть настройку прокси' } } }">
      <form class="octo-setup-form" data-testid="octo-setup-form" @submit.prevent="submit()">
        <p class="octo-warning" role="note">{{ windowsRequirement }}</p>
        <p>Сначала проверим прокси, затем создадим недостающие профили. Проверка может занять до 4 минут.</p>
        <fieldset :disabled="submitting || keySaving"><legend>Откуда взять прокси</legend>
          <label><input v-model="source" type="radio" value="nodemaven"> Сгенерировать прокси NodeMaven</label>
          <label><input v-model="source" type="radio" value="own"> Проверить свой SOCKS5 прокси</label>
          <label v-if="importableProfiles.length"><input v-model="source" type="radio" value="dolphin"> Использовать прокси из Dolphin</label>
        </fieldset>
        <label v-if="source === 'own'" class="octo-setup-field">Строка SOCKS5 прокси
          <input v-model="ownProxy" type="password" aria-label="Строка SOCKS5 прокси" required autocomplete="new-password" spellcheck="false" placeholder="socks5://логин:пароль@адрес:порт" :disabled="submitting">
          <small>Например: socks5://login:password@proxy.example:1080</small>
        </label>
        <label v-if="source === 'dolphin'" class="octo-setup-field">Профиль Dolphin с прокси
          <select v-model="profileId" aria-label="Профиль Dolphin с прокси" :disabled="submitting"><option v-for="profile in importableProfiles" :key="profile.id" :value="profile.id">{{ profile.locale.toUpperCase() }} · профиль {{ profile.id }}</option></select>
        </label>
        <template v-if="source === 'nodemaven'">
          <div v-if="hasKey && !editingKey"><p role="status">Ключ NodeMaven сохранён. Выбери местоположение прокси.</p><Button type="button" label="Изменить ключ" size="small" text :disabled="submitting || keySaving" @click="editingKey = true" /></div>
          <label v-else class="octo-setup-field">Ключ NodeMaven
            <input v-model="nodeKey" type="password" aria-label="Ключ NodeMaven" autocomplete="new-password" spellcheck="false" :disabled="keySaving || submitting">
            <Button type="button" label="Сохранить ключ" :loading="keySaving" :disabled="!nodeKey.trim() || submitting" @click="saveKey" />
          </label>
          <template v-if="hasKey">
            <label class="octo-setup-field">Страна
              <select aria-label="Страна" :value="locationState.location.country || ''" :disabled="submitting || keySaving || editingKey || locationState.lists.countries?.loading" @change="picker.country($event.target.value)">
                <option value="">Выбери страну</option><option v-for="item in locationState.lists.countries?.items || []" :key="item.code" :value="item.code">{{ item.name }}</option>
              </select>
            </label>
            <label v-if="locationState.lists.regions?.items.length" class="octo-setup-field">Регион
              <select aria-label="Регион" :value="locationState.location.region" :disabled="submitting || keySaving || editingKey" required @change="picker.region($event.target.value)">
                <option value="">Выбери регион</option><option v-for="item in locationState.lists.regions.items" :key="item.code" :value="item.code">{{ item.name }}</option>
              </select>
            </label>
            <label v-if="locationState.lists.cities?.items.length" class="octo-setup-field">Город
              <select aria-label="Город" :value="locationState.location.city" :disabled="submitting || keySaving || editingKey" required @change="picker.city($event.target.value)">
                <option value="">Выбери город</option><option v-for="item in locationState.lists.cities.items" :key="item.code" :value="item.code">{{ item.name }}</option>
              </select>
            </label>
            <template v-for="(list, level) in locationState.lists" :key="level">
              <p v-if="list.loading" role="status">Загружаем {{ level === 'countries' ? 'страны' : level === 'regions' ? 'регионы' : 'города' }}…</p>
              <div v-if="list.error" role="alert">{{ list.error }} <Button type="button" label="Повторить" severity="secondary" @click="level === 'countries' ? picker.countries() : level === 'regions' ? picker.country(locationState.location.country) : picker.retryCities()" /></div>
            </template>
          </template>
        </template>
        <p v-if="message" role="alert">{{ message }}</p>
        <div class="octo-setup-actions"><Button type="button" label="Отмена" severity="secondary" :disabled="submitting" @click="closeWizard" /><Button type="submit" label="Проверить прокси и создать профили" :loading="submitting" :disabled="!canSubmit" /></div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.octo-onboarding { margin: 18px 0; }
.octo-progress { display: flex; align-items: center; gap: 14px; padding: 18px; background: #eff6ff; border-radius: 12px; color: #1e40af; }
.octo-progress p { margin: 8px 0 0; }
.octo-warning { padding: 16px; border: 1px solid #fde68a; background: #fffbeb; border-radius: 10px; }
.octo-warning a { margin-right: 16px; }
.octo-dialog-copy { font-size: 17px; line-height: 1.7; }
.octo-setup-form { display: grid; gap: 18px; }
.octo-setup-form p { margin: 0; line-height: 1.6; }
.octo-setup-form fieldset { display: grid; gap: 14px; border: 1px solid #dbe3ee; border-radius: 10px; padding: 18px; }
.octo-setup-form legend { font-weight: 700; }
.octo-setup-field { display: grid; gap: 8px; font-weight: 600; }
.octo-setup-field input, .octo-setup-field select { width: 100%; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.octo-setup-field small { font-weight: 400; overflow-wrap: anywhere; }
.octo-setup-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
</style>
