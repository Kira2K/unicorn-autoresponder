<script setup>
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import FieldInfoLabel from './FieldInfoLabel.vue'
import { usernameDisplay, updateUsernameInput } from './username-input.js'
import { studentPreviewLabel } from './student-preview-labels.js'
import { phoneInputValue, updateContactInput } from './contact-input.js'
import { platformDisplayLabel as previewPlatformLabel } from './platform-display-label.js'
const form = defineModel('form', { type: Object, required: true })
const props = defineProps({
  editing: Boolean, preview: Boolean, saving: Boolean, error: String,
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
const loginHint = computed(() => {
  if (!props.preview) return ''
  if (['telegram_ru', 'telegram_en'].includes(props.displayLabel)) return 'Номер телефона'
  const emailPlatform = { hh_ru: 'email_ru', hh_en: 'email_en' }[props.displayLabel]
  return emailPlatform ? platformDisplayLabel(emailPlatform) : ''
})
const digitsOnlyPhone = computed(() => props.preview && ['phone_en', 'phone_ru'].includes(props.displayLabel))
const formatPhone = value => phoneInputValue(value, props.displayLabel)
function capturePhone(event) {
  if (digitsOnlyPhone.value) updateContactInput(event, formatPhone)
}
</script>
<template>
<form class="account-form" data-testid="account-form" novalidate @submit.prevent="!saving && emit('save')">
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
    <small v-if="preview && phoneRuExists" class="phone-ru-hint">Телефон для ру рынка уже добавлен — отредактируйте существующий.</small>
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
    <InputText v-model="form.login" :disabled="!accountFieldEnabled('login')" :required="accountFieldRequired('login')" data-testid="account-login" />
  </label>
  <label class="field">
    <span>{{ ui('Phone') }}<span v-if="phoneRuSelected" class="required-star"> *</span></span>
    <InputText :model-value="digitsOnlyPhone ? formatPhone(form.phone) : form.phone" :inputmode="digitsOnlyPhone ? 'numeric' : undefined" :disabled="!accountFieldEnabled('phone')" :required="accountFieldRequired('phone')" :class="{ 'phone-ru-invalid': phoneRuValidationMessage }" :aria-invalid="Boolean(phoneRuValidationMessage)" data-testid="account-phone" @input.capture="capturePhone" @update:model-value="emit('phone', $event)" />
    <small v-if="phoneRuSelected" class="phone-ru-hint">Российский номер в формате +7XXXXXXXXXX. Этот номер используется для HH на ру рынке (вход и подтверждение по SMS).</small>
    <small v-if="phoneRuValidationMessage" class="phone-ru-error" role="alert">{{ phoneRuValidationMessage }}</small>
  </label>
  <label class="field">
    <span>{{ ui('Email') }}</span>
    <InputText v-model="form.email" :disabled="!accountFieldEnabled('email')" :required="accountFieldRequired('email')" data-testid="account-email" />
  </label>
  <label class="field">
    <span>{{ preview ? 'Username' : 'Nickname' }}</span>
    <InputText v-if="preview" :model-value="usernameDisplay(form.nickname)" :disabled="!accountFieldEnabled('nickname')" :required="accountFieldRequired('nickname')" pattern="@[A-Za-z]+" autocapitalize="none" :spellcheck="false" data-testid="account-nickname" @input.capture="form.nickname = updateUsernameInput($event)" />
    <InputText v-else v-model="form.nickname" :disabled="!accountFieldEnabled('nickname')" :required="accountFieldRequired('nickname')" data-testid="account-nickname" />
    <small v-if="preview && accountFieldEnabled('nickname')">Только латинские буквы A–Z, a–z. Знак @ добавляется автоматически.</small>
  </label>
  <label class="field wide-field">
    <span>
      <template v-if="preview && urlInfoVisible">URL <small class="account-login-hint">— ссылка без https://</small></template>
      <FieldInfoLabel v-else-if="editing && displayLabel === 'github'" label="URL" tooltip="ссылка без https://" test-id="account-url-info" />
      <template v-else>URL</template>
    </span>
    <InputText v-model="form.linkedInUrl" :disabled="!accountFieldEnabled('linkedInUrl')" :required="accountFieldRequired('linkedInUrl')" data-testid="account-linkedin-url" />
  </label>
  <label class="field">
    <span>{{ ui('Foreign number') }}</span>
    <InputText v-model="form.foreignNumber" :disabled="!accountFieldEnabled('foreignNumber')" :required="accountFieldRequired('foreignNumber')" data-testid="account-foreign-number" />
  </label>
  <label class="field">
    <span>{{ ui('Recovery codes') }}</span>
    <InputText v-model="form.recoveryCodes" :disabled="!accountFieldEnabled('recoveryCodes')" :required="accountFieldRequired('recoveryCodes')" data-testid="account-recovery-codes" />
  </label>
  <label class="field">
    <span>{{ ui('Password') }}</span>
    <Password v-model="form.password" :feedback="false" toggle-mask :disabled="!accountFieldEnabled('password') || (editing && !secretsReady)" :required="accountFieldRequired('password')" data-testid="account-password-widget" input-class="password-input" />
  </label>
  <label class="field">
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
.account-form-fields { display: grid; grid-template-columns: inherit; gap: 16px; grid-column: 1 / -1; margin: 0; padding: 0; border: 0; min-width: 0; }
</style>
