<script setup>
import { computed, ref, watch } from 'vue'
import { isOutlookLogin, outlookLoginError } from '../../../linkedin-automation/console-intake/contracts.mts'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import FieldInfoLabel from './FieldInfoLabel.vue'
import { usernameDisplay, updateUsernameInput } from './username-input.js'
import { studentPreviewLabel } from './student-preview-labels.js'
import { isAccountPhoneField, phoneInputValue, updateContactInput } from './contact-input.js'
import { platformDisplayLabel as previewPlatformLabel } from './platform-display-label.js'
const form = defineModel('form', { type: Object, required: true })
const props = defineProps({
  editing: Boolean, preview: Boolean, saving: Boolean, error: String,studentView:Boolean,
  secretsLoading: Boolean, secretsReady: { type: Boolean, default: true },
  platforms: Array, policy: Object, displayLabel: String,
  phoneRuSelected: Boolean, phoneRuExists: Boolean, phoneRuValidationMessage: String
})
const emit = defineEmits(['save', 'cancel', 'phone'])
const ui = text => studentPreviewLabel(text, props.preview)
const platformDisplayLabel = text => props.preview ? previewPlatformLabel(text) : text
const accountFieldEnabled = field => props.policy?.fields.includes(field) ?? false
const accountFieldRequired = field => props.policy?.requiredFields.includes(field) ?? false
const urlInfoVisible = computed(() => ['github', 'linkedin'].includes(props.displayLabel))
const githubSelected = computed(() => props.displayLabel === 'github')
const outlookSelected = computed(() => props.displayLabel === 'email_outlook')
const loginTouched = ref(false)
const outlookInvalid = computed(() => outlookSelected.value && loginTouched.value && !isOutlookLogin(form.value.login))
watch(() => props.displayLabel, () => { loginTouched.value = false })
function submit() {
  loginTouched.value = true
  if (!props.saving && !outlookInvalid.value) emit('save')
}
const loginHint = computed(() => {
  if (!props.preview) return ''
  if (['telegram_ru', 'telegram_en'].includes(props.displayLabel)) return 'Номер телефона'
  const emailPlatform = { hh_ru: 'email_ru', hh_en: 'email_en' }[props.displayLabel]
  return emailPlatform ? platformDisplayLabel(emailPlatform) : ''
})
const phoneLogin = computed(() => isAccountPhoneField('login', props.displayLabel))
const formatPhone = value => phoneInputValue(value, props.displayLabel)
function capturePhone(event) {
  updateContactInput(event, formatPhone)
}
</script>
<template>
<form class="account-form" data-testid="account-form" novalidate @submit.prevent="submit">
<p v-if="error" class="error-text wide-field" role="alert" data-testid="account-form-error">{{ ui(error) }}</p>
<fieldset class="account-form-fields" :disabled="saving">
  <label v-if="!editing" class="field">
    <span>{{ ui('Platform') }}</span>
    <select v-model="form.platformId" class="native-select" required data-testid="account-platform">
      <option value="">{{ ui('Choose platform') }}</option>
      <option v-for="platform in platforms" :key="platform.id" :value="String(platform.id)" :disabled="preview && platform.label === 'phone_ru' && phoneRuExists" :title="preview && platform.label === 'phone_ru' && phoneRuExists ? 'Уже добавлен — отредактируйте существующий' : ''">
        {{ platformDisplayLabel(platform.label) }}{{ preview && platform.label === 'phone_ru' && phoneRuExists ? ' (уже добавлен)' : '' }}
      </option>
    </select>
  </label>
  <label v-else class="field">
    <span>{{ ui('Platform') }}</span>
    <InputText :model-value="platformDisplayLabel(form.platform)" disabled data-testid="account-platform-locked" />
  </label>
  <label class="field">
    <span>{{ ui('Label') }}</span>
    <InputText :model-value="platformDisplayLabel(displayLabel)" disabled data-testid="account-label" />
  </label>
  <label class="field">
    <span>{{ ui('Login') }}<small v-if="loginHint" class="account-login-hint"> — {{ loginHint }}</small></span>
    <InputText v-if="phoneLogin" :model-value="formatPhone(form.login)" inputmode="tel" placeholder="+кодномер" :disabled="!accountFieldEnabled('login')" :required="accountFieldRequired('login')" data-testid="account-login" @input.capture="capturePhone" @update:model-value="form.login = $event" />
    <InputText v-else v-model="form.login" :disabled="!accountFieldEnabled('login')" :required="accountFieldRequired('login')" :placeholder="outlookSelected ? 'name@outlook.com' : undefined" :invalid="outlookInvalid" :aria-invalid="outlookInvalid" :aria-describedby="outlookSelected ? 'account-outlook-hint' : undefined" data-testid="account-login" @blur="loginTouched = true" />
    <small v-if="outlookSelected" id="account-outlook-hint" :class="{ 'error-text': outlookInvalid }" :role="outlookInvalid ? 'alert' : undefined">{{ outlookInvalid ? outlookLoginError : 'Только почта @outlook.com' }}</small>
    <small v-if="phoneLogin">Формат: +кодномер, без пробелов и скобок.</small>
  </label>
  <label class="field">
    <span>{{ ui('Phone') }}<span v-if="phoneRuSelected" class="required-star"> *</span></span>
    <InputText :model-value="accountFieldEnabled('phone') ? formatPhone(form.phone) : form.phone" inputmode="tel" :placeholder="accountFieldEnabled('phone') ? '+кодномер' : undefined" :disabled="!accountFieldEnabled('phone')" :required="accountFieldRequired('phone')" :class="{ 'phone-ru-invalid': phoneRuValidationMessage }" :aria-invalid="Boolean(phoneRuValidationMessage)" data-testid="account-phone" @input.capture="capturePhone" @update:model-value="emit('phone', $event)" />
    <small v-if="accountFieldEnabled('phone') && !phoneRuSelected">Формат: +кодномер, без пробелов и скобок.</small>
    <small v-if="phoneRuSelected" class="phone-ru-hint">Номер с любым кодом страны в формате +кодномер, от 6 до 15 цифр. Используется для HH на ру рынке (вход и подтверждение по SMS).</small>
    <small v-if="phoneRuValidationMessage" class="phone-ru-error" role="alert">{{ phoneRuValidationMessage }}</small>
  </label>
  <label class="field">
    <span>{{ ui('Email') }}</span>
    <InputText v-model="form.email" :disabled="!accountFieldEnabled('email')" :required="accountFieldRequired('email')" data-testid="account-email" />
  </label>
  <label class="field">
    <span>{{ preview ? 'Username' : 'Nickname' }}</span>
    <InputText v-if="preview" :model-value="usernameDisplay(form.nickname)" :disabled="!accountFieldEnabled('nickname')" :required="accountFieldRequired('nickname')" pattern="@[A-Za-z0-9_]+" autocapitalize="none" :spellcheck="false" data-testid="account-nickname" @input.capture="form.nickname = updateUsernameInput($event)" />
    <InputText v-else v-model="form.nickname" :disabled="!accountFieldEnabled('nickname')" :required="accountFieldRequired('nickname')" data-testid="account-nickname" />
    <small v-if="preview && accountFieldEnabled('nickname')">Латинские буквы A–Z, a–z, цифры 0–9 и «_». Знак @ добавляется автоматически.</small>
  </label>
  <label class="field" :class="{ 'wide-field': !githubSelected }">
    <span>
      <template v-if="preview && urlInfoVisible">URL <small class="account-login-hint">— ссылка без https://</small></template>
      <FieldInfoLabel v-else-if="editing && displayLabel === 'github'" label="URL" tooltip="ссылка без https://" test-id="account-url-info" />
      <template v-else>URL</template>
    </span>
    <InputText v-model="form.linkedInUrl" :disabled="!accountFieldEnabled('linkedInUrl')" :required="accountFieldRequired('linkedInUrl')" data-testid="account-linkedin-url" />
  </label>
  <label v-if="githubSelected" class="github-empty-field">
    <input v-model="form.githubEmpty" type="checkbox" data-testid="account-github-empty" />
    <span>GitHub пустой</span>
  </label>
  <label class="field">
    <span>{{ ui('Foreign number') }}</span>
    <InputText :model-value="accountFieldEnabled('foreignNumber') ? phoneInputValue(form.foreignNumber) : form.foreignNumber" inputmode="tel" :disabled="!accountFieldEnabled('foreignNumber')" :required="accountFieldRequired('foreignNumber')" data-testid="account-foreign-number" @input.capture="updateContactInput($event, phoneInputValue)" @update:model-value="form.foreignNumber = $event" />
  </label>
  <label class="field">
    <span>{{ ui('Password') }}</span>
    <Password v-model="form.password" :feedback="false" toggle-mask :disabled="!accountFieldEnabled('password') || (editing && !secretsReady)" :required="accountFieldRequired('password')" data-testid="account-password-widget" input-class="password-input" />
  </label>
  <label v-if="!studentView||displayLabel!=='linkedin'" class="field">
    <span>{{ ui('Email password') }}</span>
    <Password v-model="form.emailPassword" :feedback="false" toggle-mask :disabled="!accountFieldEnabled('emailPassword') || (editing && !secretsReady)" :required="accountFieldRequired('emailPassword')" data-testid="account-email-password-widget" input-class="password-input" />
  </label>
  <div class="form-actions wide-field">
    <Button type="submit" :label="ui(editing ? 'Save account' : 'Add account')" icon="pi pi-save" :loading="saving || secretsLoading" :disabled="editing && !secretsReady" data-testid="save-account-button" />
    <Button type="button" :label="ui('Cancel')" icon="pi pi-times" severity="secondary" data-testid="close-account-editor-button" @click="emit('cancel')" />
  </div>
</fieldset>
</form>
</template>
<style scoped>
.account-login-hint { color: #64748b; font-weight: 400; }
.github-empty-field { display: flex; align-items: center; gap: 10px; align-self: end; min-height: 44px; cursor: pointer; }
.github-empty-field input { width: 20px; height: 20px; margin: 0; flex: 0 0 auto; accent-color: var(--p-primary-color, #0ea5e9); }
.account-form-fields { display: grid; grid-template-columns: inherit; gap: 16px; grid-column: 1 / -1; margin: 0; padding: 0; border: 0; min-width: 0; }
</style>
