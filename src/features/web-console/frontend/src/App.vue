<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'

const emptyProfileForm = {
  firstName: '',
  lastName: '',
  fio: '',
  birthDate: '',
  education: '',
  englishLevelId: '',
  telegramPersonalChatId: '',
  calendarEmail: ''
}
const emptyAccountForm = {
  id: null,
  platformId: '',
  platform: '',
  accountLabel: '',
  login: '',
  phone: '',
  email: '',
  nickname: '',
  linkedInUrl: '',
  foreignNumber: '',
  recoveryCodes: '',
  password: '',
  emailPassword: ''
}

const session = ref(null)
const loading = ref(true)
const pageLoading = ref(false)
const error = ref('')
const email = ref('')
const password = ref('')
const dashboard = ref(null)
const providerClients = ref([])
const providerDolphinEmail = ref('')
const dryRunResult = ref(null)
const dolphinLease = ref(null)
const dolphinLeaseError = ref('')
const dolphinLeaseLoading = ref(false)
const dolphinProvisionMessage = ref('')
const dolphinProfileStatus = ref(null)
const providerDolphinProfileStatuses = ref({})
const ownProxy = ref(false)
const requiredDataDialogVisible = ref(false)
const requiredDataDialogField = ref(null)
const requiredDataDialogClientId = ref(null)
const secureDnsWarningVisible = ref(false)
const pendingDolphinLease = ref(null)
const verificationCode = ref(null)
const verificationCodeError = ref('')
const verificationCodeLoading = ref(false)
const nowMs = ref(Date.now())
const englishLevels = ref([])
const platforms = ref([])
const profileForm = ref({ ...emptyProfileForm })
const profileSaving = ref(false)
const profileMessage = ref('')
const accountForm = ref({ ...emptyAccountForm })
const accountSaving = ref(false)
const accountMessage = ref('')
const accountError = ref('')
const profileEditorOpen = ref('')
const accountEditorOpen = ref(false)
let countdownTimer = null
const SECURE_DNS_WARNING_KEY = 'webConsole.secureDnsWarningAccepted'
const REQUIRED_DATA_WARNING_PREFIX = 'webConsole.requiredDolphinDataWarning'

const isAdmin = computed(() => session.value?.role === 'admin')
const isProvider = computed(() => session.value?.role === 'provider')
const isClient = computed(() => session.value?.role === 'client')
const accountRows = computed(() => dashboard.value?.platformAccounts || [])
const editingAccount = computed(() => Boolean(accountForm.value.id))
const dryRunText = computed(() => {
  if (!dryRunResult.value) return ''
  return `${dryRunResult.value.message} ${dryRunResult.value.plannedCommand.command}`
})
const dolphinLeaseSecondsLeft = computed(() => {
  if (!dolphinLease.value) return 0
  return Math.max(0, Math.ceil((Number(dolphinLease.value.expiresAt) - nowMs.value) / 1000))
})
const dolphinActionMode = computed(() => {
  const status = dolphinProfileStatus.value
  if (!status) return 'open_existing'
  if (status.action === 'create_new') return 'create_new'
  if (status.action === 'blocked' && !(status.existingProfiles || []).length) return 'create_new'
  return 'open_existing'
})
const dolphinActionLabel = computed(() =>
  dolphinActionMode.value === 'create_new' ? 'Create new profiles' : 'Open Dolphin profiles'
)
const hasActiveDolphinLease = computed(() => dolphinLeaseSecondsLeft.value > 0)

function setError(value) {
  error.value = value instanceof Error ? value.message : String(value || '')
}

function requiredDataStorageKey(clientId, field) {
  return `${REQUIRED_DATA_WARNING_PREFIX}.${clientId}.${field}`
}

function firstRequiredDataField(status) {
  return (status?.requiredFields || [])[0] || null
}

function showRequiredDataDialog(field, clientId = null) {
  if (!field) return
  requiredDataDialogField.value = field
  requiredDataDialogClientId.value = clientId
  requiredDataDialogVisible.value = true
}

function confirmRequiredDataDialog() {
  const field = requiredDataDialogField.value
  const clientId = requiredDataDialogClientId.value || dolphinProfileStatus.value?.targetClientId
  if (field && clientId) {
    window.localStorage?.setItem(requiredDataStorageKey(clientId, field.field), 'true')
  }
  requiredDataDialogVisible.value = false
}

function blockRequiredDataAction(field, clientId) {
  if (!field) return
  const key = clientId ? requiredDataStorageKey(clientId, field.field) : ''
  if (key && window.localStorage?.getItem(key) === 'true') {
    dolphinLeaseError.value = `pls contact your mentor to add ${field.fieldLabel || 'required data'}.`
    return
  }
  showRequiredDataDialog(field, clientId)
}

function resetProfileForm() {
  const client = dashboard.value?.client || {}
  profileForm.value = {
    firstName: client.firstName || '',
    lastName: client.lastName || '',
    fio: client.fio || '',
    birthDate: client.birthDate || '',
    education: client.education || '',
    englishLevelId: client.englishLevelId ? String(client.englishLevelId) : '',
    telegramPersonalChatId: client.telegramPersonalChatId || '',
    calendarEmail: client.calendarEmail || ''
  }
}

function resetAccountForm() {
  accountForm.value = { ...emptyAccountForm }
  accountError.value = ''
}

function closeProfileEditor() {
  resetProfileForm()
  profileEditorOpen.value = ''
}

function openNewAccountForm() {
  resetAccountForm()
  accountEditorOpen.value = true
  accountMessage.value = ''
}

function closeAccountForm() {
  resetAccountForm()
  accountEditorOpen.value = false
}

function selectPlatformLabel(platformId) {
  const option = platforms.value.find(item => Number(item.id) === Number(platformId))
  return option?.label || ''
}

async function loadClientOptions() {
  if (!isClient.value) return
  const result = await api.clientProfileOptions()
  englishLevels.value = result.englishLevels || []
  platforms.value = result.platforms || []
}

async function loadDolphinStatus(targetClientId = null) {
  const status = await api.dolphinProfileStatus(targetClientId)
  if (isProvider.value && targetClientId) {
    providerDolphinProfileStatuses.value = {
      ...providerDolphinProfileStatuses.value,
      [targetClientId]: status
    }
  } else {
    dolphinProfileStatus.value = status
  }
  return status
}

async function loadProviderDolphinStatuses(clients) {
  providerDolphinProfileStatuses.value = {}
  await Promise.all((clients || []).map(async client => {
    try {
      await loadDolphinStatus(client.id)
    } catch {
      // Row-level status is best-effort; the action itself still validates server-side.
    }
  }))
}

async function loadDashboard() {
  if (!session.value) return
  pageLoading.value = true
  error.value = ''
  dryRunResult.value = null
  dolphinLeaseError.value = ''
  verificationCode.value = null
  verificationCodeError.value = ''
  profileMessage.value = ''
  accountMessage.value = ''
  try {
    if (isAdmin.value) {
      dashboard.value = await api.adminLatestClient()
      await loadDolphinStatus(dashboard.value?.client?.id)
      providerClients.value = []
      providerDolphinEmail.value = ''
    } else if (isProvider.value) {
      const result = await api.providerClients()
      dashboard.value = null
      providerClients.value = result.clients || []
      providerDolphinEmail.value = result.providerDolphinEmail || ''
      await loadProviderDolphinStatuses(providerClients.value)
    } else {
      await loadClientOptions()
      dashboard.value = await api.clientDashboard()
      await loadDolphinStatus(dashboard.value?.client?.id)
      resetProfileForm()
      resetAccountForm()
      profileEditorOpen.value = ''
      accountEditorOpen.value = false
      providerClients.value = []
      providerDolphinEmail.value = ''
      ownProxy.value = false
    }
  } catch (caught) {
    setError(caught)
  } finally {
    pageLoading.value = false
  }
}

async function login() {
  loading.value = true
  error.value = ''
  try {
    session.value = await api.login(email.value, password.value)
    await loadDashboard()
  } catch (caught) {
    setError(caught)
  } finally {
    loading.value = false
  }
}

async function logout() {
  loading.value = true
  error.value = ''
  try {
    await api.logout()
  } catch {
    // Local state is still cleared if the server session is already gone.
  } finally {
    session.value = null
    dashboard.value = null
    providerClients.value = []
    providerDolphinEmail.value = ''
    dolphinProfileStatus.value = null
    providerDolphinProfileStatuses.value = {}
    ownProxy.value = false
    dryRunResult.value = null
    dolphinLease.value = null
    dolphinLeaseError.value = ''
    verificationCode.value = null
    verificationCodeError.value = ''
    englishLevels.value = []
    platforms.value = []
    resetAccountForm()
    profileEditorOpen.value = ''
    accountEditorOpen.value = false
    password.value = ''
    loading.value = false
  }
}

async function saveProfile() {
  profileSaving.value = true
  profileMessage.value = ''
  error.value = ''
  try {
    dashboard.value = await api.updateClientProfile({
      ...profileForm.value,
      englishLevelId: profileForm.value.englishLevelId ? Number(profileForm.value.englishLevelId) : null
    })
    resetProfileForm()
    profileEditorOpen.value = ''
    profileMessage.value = 'Profile saved'
  } catch (caught) {
    setError(caught)
  } finally {
    profileSaving.value = false
  }
}

function editAccount(account) {
  accountMessage.value = ''
  accountError.value = ''
  accountEditorOpen.value = true
  accountForm.value = {
    id: account.id,
    platformId: account.platformId ? String(account.platformId) : '',
    platform: account.platform || '',
    accountLabel: account.accountLabel || '',
    login: account.login || '',
    phone: account.phone || '',
    email: account.email || '',
    nickname: account.nickname || '',
    linkedInUrl: account.linkedInUrl || '',
    foreignNumber: account.foreignNumber || '',
    recoveryCodes: account.recoveryCodes || '',
    password: '',
    emailPassword: ''
  }
}

function accountPayload() {
  const selectedPlatform = selectPlatformLabel(accountForm.value.platformId)
  return {
    ...accountForm.value,
    platformId: accountForm.value.platformId ? Number(accountForm.value.platformId) : null,
    platform: selectedPlatform || accountForm.value.platform,
    id: undefined
  }
}

async function saveAccount() {
  accountSaving.value = true
  accountMessage.value = ''
  accountError.value = ''
  try {
    const payload = accountPayload()
    if (!payload.platform && !payload.platformId) {
      accountError.value = 'Choose a platform'
      return
    }
    const wasEditing = editingAccount.value
    dashboard.value = wasEditing
      ? await api.updatePlatformAccount(accountForm.value.id, payload)
      : await api.createPlatformAccount(payload)
    resetAccountForm()
    accountEditorOpen.value = false
    accountMessage.value = wasEditing ? 'Account updated' : 'Account added'
  } catch (caught) {
    accountError.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    accountSaving.value = false
  }
}

async function deleteAccount(account) {
  if (!window.confirm(`Delete ${account.accountLabel || account.platform}?`)) return
  accountSaving.value = true
  accountMessage.value = ''
  accountError.value = ''
  try {
    const deletedOpenAccount = accountForm.value.id === account.id
    dashboard.value = await api.deletePlatformAccount(account.id)
    if (deletedOpenAccount) {
      resetAccountForm()
      accountEditorOpen.value = false
    }
    accountMessage.value = 'Account deleted'
  } catch (caught) {
    accountError.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    accountSaving.value = false
  }
}

async function startHhResponses() {
  pageLoading.value = true
  error.value = ''
  dryRunResult.value = null
  try {
    dryRunResult.value = await api.startHhResponsesDryRun()
  } catch (caught) {
    setError(caught)
  } finally {
    pageLoading.value = false
  }
}

async function openDolphinProfile(clientName, clientId, mode = 'open_existing') {
  dolphinLeaseLoading.value = true
  dolphinLeaseError.value = ''
  dolphinProvisionMessage.value = mode === 'create_new'
    ? 'Creating new Dolphin profiles. This can take a few minutes.'
    : 'Opening Dolphin profiles.'
  verificationCode.value = null
  verificationCodeError.value = ''
  try {
    const status = isProvider.value
      ? providerDolphinProfileStatuses.value[clientId] || await loadDolphinStatus(clientId)
      : dolphinProfileStatus.value || await loadDolphinStatus(clientId)
    const blocker = firstRequiredDataField(status)
    if (blocker) {
      blockRequiredDataAction(blocker, status?.targetClientId || clientId)
      return
    }
    const lease = await api.acquireDolphinLease(clientName, clientId, {
      mode,
      ownProxy: mode === 'create_new' && ownProxy.value
    })
    if (window.localStorage?.getItem(SECURE_DNS_WARNING_KEY) === 'true') {
      dolphinLease.value = lease
    } else {
      pendingDolphinLease.value = lease
      secureDnsWarningVisible.value = true
    }
    nowMs.value = Date.now()
    await loadDolphinStatus(clientId)
  } catch (caught) {
    const body = caught?.body || {}
    const dolphinCode = body.dolphin?.code ? ` (${body.dolphin.code})` : ''
    const attempted = body.attemptedUsername ? ` Tried: ${body.attemptedUsername}.` : ''
    if (body.requiredFields?.length) {
      blockRequiredDataAction(body.requiredFields[0], body.targetClientId || clientId)
      return
    }
    dolphinLeaseError.value = caught.status === 409
      ? 'Account is busy now. Please come back in 5 mins.'
      : `${caught instanceof Error ? caught.message : String(caught || '')}${dolphinCode}${attempted}`
  } finally {
    dolphinLeaseLoading.value = false
    dolphinProvisionMessage.value = ''
  }
}

function confirmSecureDnsWarning() {
  window.localStorage?.setItem(SECURE_DNS_WARNING_KEY, 'true')
  dolphinLease.value = pendingDolphinLease.value
  pendingDolphinLease.value = null
  secureDnsWarningVisible.value = false
}

async function getDolphinVerificationCode() {
  verificationCodeLoading.value = true
  verificationCodeError.value = ''
  try {
    verificationCode.value = await api.latestDolphinVerificationCode()
  } catch (caught) {
    const body = caught?.body || {}
    verificationCode.value = null
    verificationCodeError.value = body.error === 'code_not_found'
      ? 'No fresh Dolphin verification code was found.'
      : caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    verificationCodeLoading.value = false
  }
}

async function copyVerificationCode() {
  if (!verificationCode.value?.code) return
  await navigator.clipboard?.writeText(String(verificationCode.value.code).replace(/\s+/g, ''))
}

onMounted(async () => {
  countdownTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
  try {
    session.value = await api.me()
    await loadDashboard()
  } catch {
    session.value = null
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  if (countdownTimer) window.clearInterval(countdownTimer)
})
</script>

<template>
  <main class="app-shell">
    <Card v-if="!session" class="auth-card" data-testid="login-page">
      <template #title>HH Web Console</template>
      <template #subtitle>Sign in with your account login</template>
      <template #content>
        <form class="auth-form" @submit.prevent="login">
          <label class="field">
            <span>Login</span>
            <InputText v-model="email" type="text" autocomplete="username" data-testid="email-input" />
          </label>
          <label class="field">
            <span>Password</span>
            <Password
              v-model="password"
              :feedback="false"
              toggle-mask
              autocomplete="current-password"
              input-id="password"
              data-testid="password-widget"
              input-class="password-input"
            />
          </label>
          <Message v-if="error" severity="error" :closable="false" :text="error" />
          <Button type="submit" label="Sign in" icon="pi pi-sign-in" :loading="loading" data-testid="login-button" />
        </form>
      </template>
    </Card>

    <section
      v-else
      class="dashboard"
      :data-testid="isAdmin ? 'admin-dashboard' : isProvider ? 'provider-dashboard' : 'client-dashboard'"
    >
      <Toolbar class="topbar">
        <template #start>
          <div>
            <h1>{{ isAdmin ? 'Admin console' : isProvider ? 'Provider console' : 'Client console' }}</h1>
            <p>{{ session.email }}</p>
          </div>
        </template>
        <template #end>
          <Button label="Logout" icon="pi pi-sign-out" severity="secondary" data-testid="logout-button" @click="logout" />
        </template>
      </Toolbar>

      <Message v-if="error" severity="error" :closable="false" :text="error" />
      <Message v-if="dolphinLeaseError" severity="error" :closable="false" data-testid="dolphin-lease-error">
        {{ dolphinLeaseError }}
      </Message>
      <Message v-if="dolphinProvisionMessage" severity="info" :closable="false" data-testid="dolphin-provision-message">
        {{ dolphinProvisionMessage }}
      </Message>
      <Dialog v-model:visible="secureDnsWarningVisible" modal header="Before opening LinkedIn" data-testid="secure-dns-warning">
        <p class="dialog-text">Are you sure you have switched secure DNS off before opening LinkedIn?</p>
        <template #footer>
          <Button label="Confirm" icon="pi pi-check" data-testid="confirm-secure-dns-warning-button" @click="confirmSecureDnsWarning" />
        </template>
      </Dialog>
      <Dialog v-model:visible="requiredDataDialogVisible" modal header="Required profile data" class="required-data-dialog" data-testid="required-data-dialog">
        <p class="required-data-dialog-text" data-testid="required-data-dialog-text">
          pls contact your mentor to add {{ requiredDataDialogField?.fieldLabel || 'required data' }}.
        </p>
        <template #footer>
          <Button label="OK" icon="pi pi-check" data-testid="confirm-required-data-dialog-button" @click="confirmRequiredDataDialog" />
        </template>
      </Dialog>

      <Card v-if="isAdmin" class="verification-card">
        <template #title>Dolphin verification code</template>
        <template #subtitle>Use this when Dolphin asks for the email code</template>
        <template #content>
          <div class="verification-panel">
            <Button label="Get verification code" icon="pi pi-envelope" size="small" :loading="verificationCodeLoading" data-testid="get-verification-code-button" @click="getDolphinVerificationCode" />
            <Message v-if="verificationCodeError" severity="error" :closable="false" data-testid="verification-code-error">
              {{ verificationCodeError }}
            </Message>
            <div v-if="verificationCode" class="verification-code-row">
              <span data-testid="verification-code-value">Code: {{ verificationCode.code }}</span>
              <Button label="Copy" icon="pi pi-copy" size="small" severity="secondary" data-testid="copy-verification-code-button" @click="copyVerificationCode" />
            </div>
          </div>
        </template>
      </Card>

      <div v-if="pageLoading" class="loading-panel">
        <ProgressSpinner aria-label="Loading" />
      </div>

      <div v-else-if="isProvider" class="dashboard-grid provider-grid">
        <Card class="provider-card">
          <template #title>Clients on English market</template>
          <template #subtitle>{{ providerClients.length }} visible clients. Shared Dolphin login: {{ providerDolphinEmail || 'empty' }}</template>
          <template #content>
            <div class="dolphin-action-panel">
              <div>
                <h2>Dolphin profile access</h2>
                <p>Use the code button if Dolphin asks for email verification.</p>
              </div>
              <div class="verification-panel">
                <Button label="Get verification code" icon="pi pi-envelope" size="small" :loading="verificationCodeLoading" data-testid="get-verification-code-button" @click="getDolphinVerificationCode" />
                <Message v-if="verificationCodeError" severity="error" :closable="false" data-testid="verification-code-error">
                  {{ verificationCodeError }}
                </Message>
                <div v-if="verificationCode" class="verification-code-row">
                  <span data-testid="verification-code-value">Code: {{ verificationCode.code }}</span>
                  <Button label="Copy" icon="pi pi-copy" size="small" severity="secondary" data-testid="copy-verification-code-button" @click="copyVerificationCode" />
                </div>
              </div>
            </div>
            <section v-if="dolphinLease" class="lease-panel" data-testid="dolphin-lease-panel">
              <h3>Dolphin access</h3>
              <p>Open Dolphin Anty and enter the credentials below.</p>
              <p>{{ dolphinLease.targetClientName }}</p>
              <dl class="info-list lease-info-list">
                <div>
                  <dt>Dolphin login</dt>
                  <dd data-testid="dolphin-lease-email">{{ dolphinLease.username }}</dd>
                </div>
                <div v-if="dolphinLease.sourceEmail && dolphinLease.sourceEmail !== dolphinLease.username">
                  <dt>Client email</dt>
                  <dd>{{ dolphinLease.sourceEmail }}</dd>
                </div>
                <div>
                  <dt>Password</dt>
                  <dd data-testid="dolphin-lease-password">{{ dolphinLease.password }}</dd>
                </div>
                <div>
                  <dt>Profiles</dt>
                  <dd data-testid="dolphin-lease-profiles">{{ (dolphinLease.profileIds || []).join(', ') || 'empty' }}</dd>
                </div>
                <div>
                  <dt>Guaranteed authorization time left</dt>
                  <dd data-testid="dolphin-lease-countdown">{{ dolphinLeaseSecondsLeft }} sec</dd>
                </div>
              </dl>
            </section>
            <DataTable :value="providerClients" striped-rows responsive-layout="scroll" data-testid="provider-clients-table">
              <Column field="clientName" header="Name" />
              <Column field="primaryStack" header="Stack" />
              <Column field="linkedInEmail" header="LinkedIn email" />
              <Column header="Action">
                <template #body="{ data }">
                  <Button v-if="!hasActiveDolphinLease" label="Open Dolphin profiles" icon="pi pi-external-link" size="small" :loading="dolphinLeaseLoading" data-testid="open-dolphin-provider-button" @click="openDolphinProfile(data.clientName, data.id, 'open_existing')" />
                </template>
              </Column>
            </DataTable>
          </template>
        </Card>
      </div>

      <div v-else-if="dashboard" class="dashboard-grid">
        <Card class="profile-card">
          <template #title>{{ dashboard.client.clientName }}</template>
          <template #subtitle>{{ isAdmin ? 'Latest created client' : 'Your editable profile' }}</template>
          <template #content>
            <Accordion v-if="isClient" v-model:value="profileEditorOpen" class="profile-accordion" data-testid="profile-accordion">
              <AccordionPanel value="profile">
                <AccordionHeader data-testid="profile-accordion-header">
                  <span class="accordion-title">
                    <i class="pi pi-user-edit" aria-hidden="true"></i>
                    Editable personal details
                  </span>
                </AccordionHeader>
                <AccordionContent>
                  <form class="profile-form" data-testid="profile-form" @submit.prevent="saveProfile">
                    <label class="field">
                      <span>First name</span>
                      <InputText v-model="profileForm.firstName" data-testid="profile-first-name" />
                    </label>
                    <label class="field">
                      <span>Last name</span>
                      <InputText v-model="profileForm.lastName" data-testid="profile-last-name" />
                    </label>
                    <label class="field wide-field">
                      <span>Full legal name</span>
                      <InputText v-model="profileForm.fio" data-testid="profile-fio" />
                    </label>
                    <label class="field">
                      <span>Birth date</span>
                      <InputText v-model="profileForm.birthDate" type="date" data-testid="profile-birth-date" />
                    </label>
                    <label class="field">
                      <span>English level</span>
                      <select v-model="profileForm.englishLevelId" class="native-select" data-testid="profile-english-level">
                        <option value="">Empty</option>
                        <option v-for="level in englishLevels" :key="level.id" :value="String(level.id)">
                          {{ level.label }}
                        </option>
                      </select>
                    </label>
                    <label class="field wide-field">
                      <span>Education</span>
                      <InputText v-model="profileForm.education" data-testid="profile-education" />
                    </label>
                    <label class="field">
                      <span>Calendar email</span>
                      <InputText v-model="profileForm.calendarEmail" type="email" data-testid="profile-calendar-email" />
                    </label>
                    <label class="field">
                      <span>Personal Telegram</span>
                      <InputText v-model="profileForm.telegramPersonalChatId" data-testid="profile-telegram" />
                    </label>
                    <div class="form-actions wide-field">
                      <Button type="submit" label="Save profile" icon="pi pi-save" :loading="profileSaving" data-testid="save-profile-button" />
                      <Button type="button" label="Cancel" icon="pi pi-times" severity="secondary" data-testid="close-profile-editor-button" @click="closeProfileEditor" />
                    </div>
                  </form>
                </AccordionContent>
              </AccordionPanel>
            </Accordion>
            <span v-if="profileMessage" class="success-text profile-status" data-testid="profile-save-message">{{ profileMessage }}</span>
            <dl class="info-list compact-info">
              <div>
                <dt>First name</dt>
                <dd>{{ dashboard.client.firstName || 'empty' }}</dd>
              </div>
              <div>
                <dt>Last name</dt>
                <dd>{{ dashboard.client.lastName || 'empty' }}</dd>
              </div>
              <div>
                <dt>Education</dt>
                <dd>{{ dashboard.client.education || 'empty' }}</dd>
              </div>
              <div>
                <dt>English level</dt>
                <dd>{{ dashboard.client.englishLevel || 'empty' }}</dd>
              </div>
              <div>
                <dt>Client Id</dt>
                <dd>{{ dashboard.client.id }}</dd>
              </div>
              <div>
                <dt>Stack</dt>
                <dd>{{ dashboard.client.primaryStack || 'empty' }}</dd>
              </div>
              <div>
                <dt>Market</dt>
                <dd>{{ dashboard.client.market || 'empty' }}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{{ dashboard.client.clientStatus || 'empty' }}</dd>
              </div>
              <div>
                <dt>Common Chat</dt>
                <dd>{{ dashboard.client.commonChatId || 'empty' }}</dd>
              </div>
              <div>
                <dt>Mentors</dt>
                <dd>{{ (dashboard.client.mentors || []).join(', ') || 'empty' }}</dd>
              </div>
              <div>
                <dt>Resume status</dt>
                <dd>{{ dashboard.client.resumeStatus || 'empty' }}</dd>
              </div>
              <div>
                <dt>LinkedIn status</dt>
                <dd>{{ dashboard.client.linkedInStatus || 'empty' }}</dd>
              </div>
            </dl>
          </template>
        </Card>

        <Card v-if="isClient" class="action-card">
          <template #title>Dolphin profile</template>
          <template #subtitle>{{ dolphinActionMode === 'create_new' ? 'Create the missing automation profiles' : 'Open the connected automation profiles' }}</template>
          <template #content>
            <div v-if="dolphinActionMode === 'create_new'" class="proxy-choice-panel" data-testid="own-proxy-panel">
              <label class="checkbox-field">
                <input v-model="ownProxy" type="checkbox" data-testid="own-proxy-checkbox" />
                <span>I have my own proxy</span>
              </label>
            </div>
            <Button v-if="!hasActiveDolphinLease" :label="dolphinActionLabel" icon="pi pi-external-link" severity="info" :loading="dolphinLeaseLoading" data-testid="open-dolphin-client-button" @click="openDolphinProfile(dashboard.client.clientName, dashboard.client.id, dolphinActionMode)" />
            <section v-if="dolphinLease" class="lease-panel" data-testid="dolphin-lease-panel">
              <h3>Dolphin access</h3>
              <p>Open Dolphin Anty and enter the credentials below.</p>
              <p>{{ dolphinLease.targetClientName }}</p>
              <p v-if="dolphinLease.ownProxyName" class="helper-text" data-testid="actual-proxy-name">
                Please name your proxy exactly: {{ dolphinLease.ownProxyName }}
              </p>
              <dl class="info-list lease-info-list">
                <div>
                  <dt>Dolphin login</dt>
                  <dd data-testid="dolphin-lease-email">{{ dolphinLease.username }}</dd>
                </div>
                <div v-if="dolphinLease.sourceEmail && dolphinLease.sourceEmail !== dolphinLease.username">
                  <dt>Client email</dt>
                  <dd>{{ dolphinLease.sourceEmail }}</dd>
                </div>
                <div>
                  <dt>Password</dt>
                  <dd data-testid="dolphin-lease-password">{{ dolphinLease.password }}</dd>
                </div>
                <div>
                  <dt>Profiles</dt>
                  <dd data-testid="dolphin-lease-profiles">{{ (dolphinLease.profileIds || []).join(', ') || 'empty' }}</dd>
                </div>
                <div>
                  <dt>Guaranteed authorization time left</dt>
                  <dd data-testid="dolphin-lease-countdown">{{ dolphinLeaseSecondsLeft }} sec</dd>
                </div>
              </dl>
            </section>
            <div class="verification-panel">
              <Button label="Get verification code" icon="pi pi-envelope" size="small" severity="secondary" :loading="verificationCodeLoading" data-testid="get-verification-code-button" @click="getDolphinVerificationCode" />
              <Message v-if="verificationCodeError" severity="error" :closable="false" data-testid="verification-code-error">
                {{ verificationCodeError }}
              </Message>
              <div v-if="verificationCode" class="verification-code-row">
                <span data-testid="verification-code-value">Code: {{ verificationCode.code }}</span>
                <Button label="Copy" icon="pi pi-copy" size="small" severity="secondary" data-testid="copy-verification-code-button" @click="copyVerificationCode" />
              </div>
            </div>
          </template>
        </Card>

        <Card v-if="isAdmin" class="action-card">
          <template #title>Dolphin profile</template>
          <template #subtitle>{{ dolphinActionMode === 'create_new' ? 'Create missing profiles for the latest client' : 'Open profiles for the latest client' }}</template>
          <template #content>
            <div v-if="dolphinActionMode === 'create_new'" class="proxy-choice-panel" data-testid="own-proxy-panel">
              <label class="checkbox-field">
                <input v-model="ownProxy" type="checkbox" data-testid="own-proxy-checkbox" />
                <span>I have my own proxy</span>
              </label>
            </div>
            <Button v-if="!hasActiveDolphinLease" :label="dolphinActionLabel" icon="pi pi-external-link" severity="info" :loading="dolphinLeaseLoading" data-testid="open-dolphin-admin-button" @click="openDolphinProfile(dashboard.client.clientName, dashboard.client.id, dolphinActionMode)" />
            <section v-if="dolphinLease" class="lease-panel" data-testid="dolphin-lease-panel">
              <h3>Dolphin access</h3>
              <p>Open Dolphin Anty and enter the credentials below.</p>
              <p>{{ dolphinLease.targetClientName }}</p>
              <p v-if="dolphinLease.ownProxyName" class="helper-text" data-testid="actual-proxy-name">
                Please name your proxy exactly: {{ dolphinLease.ownProxyName }}
              </p>
              <dl class="info-list lease-info-list">
                <div>
                  <dt>Dolphin login</dt>
                  <dd data-testid="dolphin-lease-email">{{ dolphinLease.username }}</dd>
                </div>
                <div v-if="dolphinLease.sourceEmail && dolphinLease.sourceEmail !== dolphinLease.username">
                  <dt>Client email</dt>
                  <dd>{{ dolphinLease.sourceEmail }}</dd>
                </div>
                <div>
                  <dt>Password</dt>
                  <dd data-testid="dolphin-lease-password">{{ dolphinLease.password }}</dd>
                </div>
                <div>
                  <dt>Profiles</dt>
                  <dd data-testid="dolphin-lease-profiles">{{ (dolphinLease.profileIds || []).join(', ') || 'empty' }}</dd>
                </div>
                <div>
                  <dt>Guaranteed authorization time left</dt>
                  <dd data-testid="dolphin-lease-countdown">{{ dolphinLeaseSecondsLeft }} sec</dd>
                </div>
              </dl>
            </section>
          </template>
        </Card>

        <Card v-if="isAdmin" class="action-card">
          <template #title>HH responses</template>
          <template #subtitle>Dry-run action for the latest client</template>
          <template #content>
            <Button label="start HH responses" icon="pi pi-play" severity="success" size="large" data-testid="start-hh-button" @click="startHhResponses" />
            <p v-if="dryRunResult" class="result-message" data-testid="dry-run-result">
              {{ dryRunText }}
            </p>
          </template>
        </Card>

        <Card class="accounts-card">
          <template #title>Platform accounts</template>
          <template #subtitle>{{ accountRows.length }} connected rows</template>
          <template #content>
            <div v-if="isClient" class="feature-toolbar">
              <Button label="Add account" icon="pi pi-plus" severity="secondary" data-testid="open-account-editor-button" @click="openNewAccountForm" />
              <span v-if="accountMessage" class="success-text" data-testid="account-save-message">{{ accountMessage }}</span>
              <span v-if="accountError" class="error-text" data-testid="account-error">{{ accountError }}</span>
            </div>
            <form v-if="isClient && accountEditorOpen" class="account-form" data-testid="account-form" @submit.prevent="saveAccount">
              <label class="field">
                <span>Platform</span>
                <select v-model="accountForm.platformId" class="native-select" data-testid="account-platform">
                  <option value="">Choose platform</option>
                  <option v-for="platform in platforms" :key="platform.id" :value="String(platform.id)">
                    {{ platform.label }}
                  </option>
                </select>
              </label>
              <label class="field">
                <span>Label</span>
                <InputText v-model="accountForm.accountLabel" data-testid="account-label" />
              </label>
              <label class="field">
                <span>Login</span>
                <InputText v-model="accountForm.login" data-testid="account-login" />
              </label>
              <label class="field">
                <span>Phone</span>
                <InputText v-model="accountForm.phone" data-testid="account-phone" />
              </label>
              <label class="field">
                <span>Email</span>
                <InputText v-model="accountForm.email" data-testid="account-email" />
              </label>
              <label class="field">
                <span>Nickname</span>
                <InputText v-model="accountForm.nickname" data-testid="account-nickname" />
              </label>
              <label class="field wide-field">
                <span>LinkedIn URL</span>
                <InputText v-model="accountForm.linkedInUrl" data-testid="account-linkedin-url" />
              </label>
              <label class="field">
                <span>Foreign number</span>
                <InputText v-model="accountForm.foreignNumber" data-testid="account-foreign-number" />
              </label>
              <label class="field">
                <span>Recovery codes</span>
                <InputText v-model="accountForm.recoveryCodes" data-testid="account-recovery-codes" />
              </label>
              <label class="field">
                <span>Password</span>
                <Password v-model="accountForm.password" :feedback="false" toggle-mask data-testid="account-password-widget" input-class="password-input" />
              </label>
              <label class="field">
                <span>Email password</span>
                <Password v-model="accountForm.emailPassword" :feedback="false" toggle-mask data-testid="account-email-password-widget" input-class="password-input" />
              </label>
              <div class="form-actions wide-field">
                <Button type="submit" :label="editingAccount ? 'Save account' : 'Add account'" icon="pi pi-save" :loading="accountSaving" data-testid="save-account-button" />
                <Button type="button" label="Cancel" icon="pi pi-times" severity="secondary" data-testid="close-account-editor-button" @click="closeAccountForm" />
              </div>
            </form>

            <DataTable :value="accountRows" striped-rows responsive-layout="scroll" data-testid="accounts-table">
              <Column field="platform" header="Platform" />
              <Column field="accountLabel" header="Label" />
              <Column field="login" header="Login" />
              <Column field="phone" header="Phone" />
              <Column field="email" header="Email" />
              <Column field="nickname" header="Nickname" />
              <Column header="Password">
                <template #body="{ data }">
                  <Tag v-if="data.password" :value="data.password" severity="secondary" />
                  <span v-else>empty</span>
                </template>
              </Column>
              <Column v-if="isClient" header="Actions">
                <template #body="{ data }">
                  <div class="row-actions">
                    <Button icon="pi pi-pencil" aria-label="Edit account" size="small" severity="secondary" data-testid="edit-account-button" @click="editAccount(data)" />
                    <Button icon="pi pi-trash" aria-label="Delete account" size="small" severity="danger" data-testid="delete-account-button" @click="deleteAccount(data)" />
                  </div>
                </template>
              </Column>
            </DataTable>
          </template>
        </Card>
      </div>
    </section>
  </main>
</template>
