<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'

const emptyProfileForm = {
  firstName: '',
  lastName: '',
  fio: '',
  birthDate: '',
  education: '',
  realAge: '',
  stopListCompany: '',
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
const profileEditing = ref(false)
const accountEditorOpen = ref(false)
const telegramStatus = ref(null)
const telegramError = ref('')
const telegramLoading = ref(false)
const telegramCode = ref('')
const telegramPassword = ref('')
const telegramPhone = ref('')
const telegramOpen = ref(false)
const telegramPanelOpen = ref('')
const telegramFolders = ref([])
const telegramList = ref('main')
const telegramSearch = ref('')
const telegramDialogs = ref([])
const telegramMessages = ref([])
const telegramSelectedChatId = ref('')
const telegramMessageText = ref('')
const telegramCopiedUsername = ref('')
const telegramWriteEnabled = ref(false)
const telegramRenameFirstName = ref('')
const telegramRenameLastName = ref('')
const telegramRenameMessage = ref('')
const adminTelegramModalOpen = ref(false)
const adminTelegramSenders = ref([])
const adminTelegramSenderKey = ref('')
const adminTelegramSelectedMarket = ref('')
const adminTelegramSelectedStack = ref('')
const adminTelegramSenderOpen = ref(false)
const adminTelegramSenderQuery = ref('')
const adminTelegramRecipient = ref('@')
const adminTelegramMessage = ref('')
const adminTelegramAttachments = ref([])
const adminTelegramAlwaysVerify = ref(true)
const adminTelegramLoading = ref(false)
const adminTelegramStatus = ref('')
const adminTelegramError = ref('')
let telegramPollTimer = null
let countdownTimer = null
const SECURE_DNS_WARNING_KEY = 'webConsole.secureDnsWarningAccepted'
const REQUIRED_DATA_WARNING_PREFIX = 'webConsole.requiredDolphinDataWarning'

const isAdmin = computed(() => session.value?.role === 'admin')
const isProvider = computed(() => session.value?.role === 'provider')
const isClient = computed(() => session.value?.role === 'client')
const accountRows = computed(() => dashboard.value?.platformAccounts || [])
const telegramAccounts = computed(() => accountRows.value.filter(account => {
  const value = `${account.platform || ''} ${account.accountLabel || ''}`.toLowerCase()
  return value.includes('telegram') || value.includes('phone_en')
}))
const selectedTelegramAccount = computed(() => telegramAccounts.value[0] || null)
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
const adminCanOpenDolphinProfiles = computed(() =>
  isAdmin.value && dolphinProfileStatus.value?.action === 'open_existing' && (dolphinProfileStatus.value?.existingProfiles || []).length > 0
)
const hasActiveDolphinLease = computed(() => dolphinLeaseSecondsLeft.value > 0)
const telegramTargetPayload = computed(() => ({
  ...(isAdmin.value && dashboard.value?.client?.id ? { targetClientId: dashboard.value.client.id } : {}),
  ...(selectedTelegramAccount.value?.id ? { platformAccountId: selectedTelegramAccount.value.id } : {})
}))
const telegramDotClass = computed(() => {
  const status = telegramStatus.value?.status || selectedTelegramAccount.value?.telegramSessionStatus || 'disconnected'
  if (status === 'active') return 'status-dot green'
  if (['needs_code', 'needs_password', 'connecting'].includes(status)) return 'status-dot yellow'
  return 'status-dot red'
})
const telegramStatusLabel = computed(() => telegramStatus.value?.status || selectedTelegramAccount.value?.telegramSessionStatus || 'disconnected')
const telegramSelectedFolderTitle = computed(() => {
  const selected = telegramFolders.value.find(folder => folder.id === telegramList.value)
  return selected?.title || 'All chats'
})
const telegramSelectedDialog = computed(() =>
  telegramDialogs.value.find(dialog => dialog.id === telegramSelectedChatId.value) || null
)
const telegramModeLabel = computed(() => telegramWriteEnabled.value ? 'Writing enabled' : 'Read-only')
const telegramModeTitle = computed(() => telegramWriteEnabled.value
  ? 'Click to return Telegram to read-only mode.'
  : "in readonly mode you can't send messages, but also doesn't trigger unread messages status"
)
const adminTelegramSelectedSender = computed(() =>
  adminTelegramSenders.value.find(sender => adminTelegramSenderKey.value === `${sender.clientId}:${sender.accountId}`) || null
)
const adminTelegramSenderMarkets = computed(() => {
  const markets = new Set()
  for (const sender of adminTelegramSenders.value) markets.add(sender.market || 'No market')
  return [...markets].sort((left, right) => String(left).localeCompare(String(right)))
})
const adminTelegramSenderStacks = computed(() => {
  if (!adminTelegramSelectedMarket.value) return []
  const stacks = new Set()
  for (const sender of adminTelegramSenders.value) {
    if ((sender.market || 'No market') === adminTelegramSelectedMarket.value) {
      stacks.add(sender.stack || 'No stack')
    }
  }
  return [...stacks].sort((left, right) => String(left).localeCompare(String(right)))
})
const adminTelegramVisibleSenders = computed(() => {
  if (!adminTelegramSelectedMarket.value || !adminTelegramSelectedStack.value) return []
  const query = adminTelegramSenderQuery.value.trim().toLowerCase()
  return adminTelegramSenders.value
    .filter(sender =>
      (sender.market || 'No market') === adminTelegramSelectedMarket.value &&
      (sender.stack || 'No stack') === adminTelegramSelectedStack.value
    )
    .filter(sender => {
      if (!query) return true
      const haystack = `${sender.clientName || ''} ${sender.accountLabel || ''} ${sender.phone || ''} ${sender.platform || ''}`.toLowerCase()
      return haystack.includes(query)
    })
    .sort((left, right) =>
      String(left.clientName || '').localeCompare(String(right.clientName || '')) ||
      String(left.accountLabel || '').localeCompare(String(right.accountLabel || ''))
    )
})
const adminTelegramSenderSummary = computed(() => {
  if (adminTelegramLoading.value && !adminTelegramSenders.value.length) return 'Loading senders'
  const sender = adminTelegramSelectedSender.value
  if (!sender) return 'Choose sender'
  return `${sender.clientName} - ${sender.accountLabel} (${sender.phone || sender.platform})`
})
const adminTelegramVerifyTitle = computed(() => adminTelegramAlwaysVerify.value
  ? 'ask to verify every message'
  : 'check for enable verification'
)

function setError(value) {
  error.value = value instanceof Error ? value.message : String(value || '')
}

function telegramAdminErrorMessage(caught) {
  const code = caught?.body?.error
  if (code === 'telegram_connecting') return 'Telegram session is still reconnecting. Try Refresh, then send again.'
  if (code === 'telegram_tdlib_timeout') return 'Telegram did not answer in time. Check the session status and retry.'
  if (code === 'telegram_file_send_failed') return caught.message || 'Telegram could not send the file. Try a smaller file or retry.'
  if (code === 'telegram_sender_inactive') return 'Selected sender is not active. Refresh senders or reconnect Telegram.'
  if (code === 'telegram_invalid_username') return 'Recipient must be a valid @username.'
  if (code === 'telegram_empty_message') return 'Add message text or at least one attachment.'
  if (code === 'telegram_attachment_missing' || code === 'telegram_attachment_invalid') return 'Attachment is missing or empty. Add the file again.'
  return caught instanceof Error ? caught.message : String(caught || '')
}

function normalizeAdminTelegramRecipient() {
  const raw = adminTelegramRecipient.value.trim()
  adminTelegramRecipient.value = raw ? `@${raw.replace(/^@+/, '')}` : '@'
}

async function readFileAsBase64(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.includes(',') ? value.split(',').pop() : value)
    }
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'))
    reader.readAsDataURL(file)
  })
}

async function addAdminTelegramFiles(event) {
  const files = Array.from(event.target.files || [])
  const additions = []
  for (const file of files) {
    additions.push({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      dataBase64: await readFileAsBase64(file)
    })
  }
  adminTelegramAttachments.value = [...adminTelegramAttachments.value, ...additions]
  event.target.value = ''
}

function removeAdminTelegramAttachment(index) {
  adminTelegramAttachments.value = adminTelegramAttachments.value.filter((_, itemIndex) => itemIndex !== index)
}

function adminTelegramSenderKeyFor(sender) {
  return `${sender.clientId}:${sender.accountId}`
}

function selectAdminTelegramMarket(market) {
  adminTelegramSelectedMarket.value = market
  adminTelegramSelectedStack.value = ''
  adminTelegramSenderKey.value = ''
  adminTelegramSenderQuery.value = ''
}

function selectAdminTelegramStack(stack) {
  adminTelegramSelectedStack.value = stack
  adminTelegramSenderKey.value = ''
  adminTelegramSenderQuery.value = ''
}

function selectAdminTelegramSender(sender) {
  adminTelegramSenderKey.value = adminTelegramSenderKeyFor(sender)
  adminTelegramSenderOpen.value = false
}

function toggleAdminTelegramSenderPicker() {
  adminTelegramSenderOpen.value = !adminTelegramSenderOpen.value
}

async function openAdminTelegramModal() {
  adminTelegramModalOpen.value = true
  adminTelegramError.value = ''
  adminTelegramStatus.value = ''
  adminTelegramSenderOpen.value = false
  await loadAdminTelegramSenders()
}

async function loadAdminTelegramSenders() {
  adminTelegramLoading.value = true
  adminTelegramError.value = ''
  try {
    const result = await api.adminTelegramSenders()
    adminTelegramSenders.value = result.senders || []
    const currentSender = adminTelegramSelectedSender.value
    if (currentSender) {
      adminTelegramSelectedMarket.value = currentSender.market || 'No market'
      adminTelegramSelectedStack.value = currentSender.stack || 'No stack'
    } else {
      adminTelegramSelectedMarket.value = ''
      adminTelegramSelectedStack.value = ''
      adminTelegramSenderKey.value = ''
    }
  } catch (caught) {
    adminTelegramError.value = telegramAdminErrorMessage(caught)
  } finally {
    adminTelegramLoading.value = false
  }
}

async function sendAdminTelegramMessage() {
  normalizeAdminTelegramRecipient()
  const sender = adminTelegramSelectedSender.value
  if (!sender) {
    adminTelegramError.value = 'Choose Telegram sender'
    return
  }
  if (!/^@[A-Za-z0-9_]{5,32}$/.test(adminTelegramRecipient.value)) {
    adminTelegramError.value = 'Recipient must start from @'
    return
  }
  if (!adminTelegramMessage.value.trim() && !adminTelegramAttachments.value.length) {
    adminTelegramError.value = 'Message or file is required'
    return
  }
  if (adminTelegramAlwaysVerify.value && !window.confirm(`Send Telegram message to ${adminTelegramRecipient.value} from ${sender.clientName}?`)) {
    return
  }
  adminTelegramLoading.value = true
  adminTelegramError.value = ''
  adminTelegramStatus.value = ''
  try {
    await api.adminTelegramSend({
      targetClientId: sender.clientId,
      platformAccountId: sender.accountId,
      username: adminTelegramRecipient.value,
      text: adminTelegramMessage.value,
      attachments: adminTelegramAttachments.value
    })
    adminTelegramStatus.value = 'Message sent'
    adminTelegramMessage.value = ''
    adminTelegramAttachments.value = []
  } catch (caught) {
    adminTelegramError.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    adminTelegramLoading.value = false
  }
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
    realAge: client.realAge === undefined ? '' : String(client.realAge),
    stopListCompany: client.stopListCompany || '',
    englishLevelId: client.englishLevelId ? String(client.englishLevelId) : '',
    telegramPersonalChatId: client.telegramPersonalChatId || '',
    calendarEmail: client.calendarEmail || ''
  }
}

function resetAccountForm() {
  accountForm.value = { ...emptyAccountForm }
  accountError.value = ''
}

function resetTelegramUi() {
  telegramStatus.value = null
  telegramError.value = ''
  telegramCode.value = ''
  telegramPassword.value = ''
  telegramPhone.value = ''
  telegramOpen.value = false
  telegramPanelOpen.value = ''
  telegramFolders.value = []
  telegramList.value = 'main'
  telegramSearch.value = ''
  telegramDialogs.value = []
  telegramMessages.value = []
  telegramSelectedChatId.value = ''
  telegramMessageText.value = ''
  telegramCopiedUsername.value = ''
  telegramWriteEnabled.value = false
  telegramRenameFirstName.value = ''
  telegramRenameLastName.value = ''
  telegramRenameMessage.value = ''
}

function closeProfileEditor() {
  resetProfileForm()
  profileEditing.value = false
  profileEditorOpen.value = ''
}

function toggleProfileEditor() {
  if (profileEditing.value) {
    closeProfileEditor()
    return
  }
  resetProfileForm()
  profileEditing.value = true
  profileEditorOpen.value = 'details'
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
  resetTelegramUi()
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
      profileEditing.value = false
      profileEditorOpen.value = ''
      accountEditorOpen.value = false
      providerClients.value = []
      providerDolphinEmail.value = ''
      ownProxy.value = false
    }
    if ((isClient.value || isAdmin.value) && selectedTelegramAccount.value) {
      telegramPhone.value = selectedTelegramAccount.value.phone || selectedTelegramAccount.value.foreignNumber || ''
      await refreshTelegramStatus()
    }
  } catch (caught) {
    setError(caught)
  } finally {
    pageLoading.value = false
  }
}

async function refreshTelegramStatus() {
  if (!selectedTelegramAccount.value) return
  telegramLoading.value = true
  telegramError.value = ''
  try {
    telegramStatus.value = await api.telegramStatus(telegramTargetPayload.value)
  } catch (caught) {
    telegramError.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    telegramLoading.value = false
  }
}

async function connectTelegram() {
  if (!selectedTelegramAccount.value) return
  telegramLoading.value = true
  telegramError.value = ''
  try {
    telegramStatus.value = await api.telegramConnect({
      ...telegramTargetPayload.value,
      phone: telegramPhone.value || selectedTelegramAccount.value.phone || selectedTelegramAccount.value.foreignNumber || '',
      code: telegramCode.value || undefined,
      password: telegramPassword.value || undefined
    })
    if (telegramStatus.value.status === 'active') {
      telegramCode.value = ''
      telegramPassword.value = ''
    }
  } catch (caught) {
    telegramError.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    telegramLoading.value = false
  }
}

async function disconnectTelegram() {
  if (!selectedTelegramAccount.value) return
  telegramLoading.value = true
  telegramError.value = ''
  try {
    telegramStatus.value = await api.telegramDisconnect(telegramTargetPayload.value)
    telegramOpen.value = false
    telegramDialogs.value = []
    telegramMessages.value = []
  } catch (caught) {
    telegramError.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    telegramLoading.value = false
  }
}

async function openTelegram() {
  telegramOpen.value = true
  telegramPanelOpen.value = 'telegram'
  telegramWriteEnabled.value = false
  await loadTelegramFolders()
  await loadTelegramDialogs()
}

function hideTelegram() {
  telegramOpen.value = false
  telegramPanelOpen.value = ''
}

async function loadTelegramFolders() {
  if (!selectedTelegramAccount.value) return
  try {
    const result = await api.telegramFolders(telegramTargetPayload.value)
    telegramFolders.value = result.folders || []
    if (!telegramFolders.value.some(folder => folder.id === telegramList.value)) {
      telegramList.value = telegramFolders.value[0]?.id || 'main'
    }
  } catch {
    telegramFolders.value = [
      { id: 'main', title: 'All chats', type: 'main' },
      { id: 'archive', title: 'Archive', type: 'archive' }
    ]
  }
}

function telegramDialogParams() {
  const folderValue = telegramList.value || 'main'
  const folderMatch = folderValue.match(/^folder:(\d+)$/)
  return {
    ...telegramTargetPayload.value,
    list: folderMatch ? 'folder' : folderValue,
    folderId: folderMatch ? Number(folderMatch[1]) : undefined,
    query: telegramSearch.value.trim() || undefined,
    limit: 50
  }
}

async function loadTelegramDialogs() {
  if (!selectedTelegramAccount.value) return
  telegramLoading.value = true
  telegramError.value = ''
  try {
    const result = await api.telegramDialogs(telegramDialogParams())
    telegramDialogs.value = result.dialogs || []
    if (!telegramDialogs.value.some(dialog => dialog.id === telegramSelectedChatId.value)) {
      telegramSelectedChatId.value = ''
      telegramMessages.value = []
      resetTelegramRenameForm()
    }
    if (!telegramSearch.value.trim() && !telegramSelectedChatId.value && telegramDialogs.value[0]) {
      telegramSelectedChatId.value = telegramDialogs.value[0].id
    }
    if (telegramSelectedChatId.value) await loadTelegramMessages()
  } catch (caught) {
    telegramError.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    telegramLoading.value = false
  }
}

async function changeTelegramList() {
  telegramSelectedChatId.value = ''
  telegramMessages.value = []
  resetTelegramRenameForm()
  await loadTelegramDialogs()
}

async function loadTelegramMessages() {
  if (!selectedTelegramAccount.value || !telegramSelectedChatId.value) return
  const result = await api.telegramMessages({
    ...telegramTargetPayload.value,
    chatId: telegramSelectedChatId.value,
    limit: 50
  })
  telegramMessages.value = result.messages || []
}

async function selectTelegramDialog(dialog) {
  telegramSelectedChatId.value = dialog.id
  resetTelegramRenameForm(dialog)
  await loadTelegramMessages()
}

function toggleTelegramWriteMode() {
  telegramWriteEnabled.value = !telegramWriteEnabled.value
}

function resetTelegramRenameForm(dialog = telegramSelectedDialog.value) {
  telegramRenameMessage.value = ''
  if (!dialog?.isPrivate) {
    telegramRenameFirstName.value = ''
    telegramRenameLastName.value = ''
    return
  }
  const parts = String(dialog.title || '').trim().split(/\s+/).filter(Boolean)
  telegramRenameFirstName.value = parts[0] || ''
  telegramRenameLastName.value = parts.slice(1).join(' ')
}

async function copyTelegramUsername(username, event) {
  event?.stopPropagation?.()
  if (!username) return
  try {
    await navigator.clipboard?.writeText(username)
  } catch {
    // Copy status still confirms which handle the user selected.
  }
  telegramCopiedUsername.value = username
}

async function sendTelegramMessage() {
  const text = telegramMessageText.value.trim()
  if (!text || !telegramSelectedChatId.value) return
  if (!telegramWriteEnabled.value) {
    telegramError.value = 'Telegram is read-only. Enable writing before sending.'
    return
  }
  telegramLoading.value = true
  telegramError.value = ''
  try {
    await api.telegramSend({
      ...telegramTargetPayload.value,
      chatId: telegramSelectedChatId.value,
      text,
      allowWrite: telegramWriteEnabled.value
    })
    telegramMessageText.value = ''
    await loadTelegramMessages()
  } catch (caught) {
    telegramError.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    telegramLoading.value = false
  }
}

async function renameTelegramContact() {
  if (!telegramSelectedDialog.value?.isPrivate) return
  const firstName = telegramRenameFirstName.value.trim()
  if (!firstName) {
    telegramRenameMessage.value = 'First name is required'
    return
  }
  telegramLoading.value = true
  telegramError.value = ''
  telegramRenameMessage.value = ''
  try {
    const result = await api.telegramRenameContact({
      ...telegramTargetPayload.value,
      chatId: telegramSelectedChatId.value,
      firstName,
      lastName: telegramRenameLastName.value.trim() || undefined
    })
    const updated = result.dialog
    telegramDialogs.value = telegramDialogs.value.map(dialog =>
      dialog.id === updated.id ? { ...dialog, ...updated } : dialog
    )
    telegramRenameMessage.value = 'Saved on Telegram'
  } catch (caught) {
    telegramRenameMessage.value = caught instanceof Error ? caught.message : String(caught || '')
  } finally {
    telegramLoading.value = false
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
    profileEditing.value = false
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
    profileEditing.value = false
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
      : body.reason === 'gmail_oauth_invalid_grant'
        ? 'Gmail access expired. Contact Kira or Dasha for fixes.'
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
          <div class="topbar-actions">
            <Button v-if="isAdmin" icon="pi pi-telegram" severity="info" data-testid="admin-telegram-open-button" aria-label="Write in Telegram" @click="openAdminTelegramModal" />
            <Button label="Logout" icon="pi pi-sign-out" severity="secondary" data-testid="logout-button" @click="logout" />
          </div>
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
      <Dialog v-model:visible="adminTelegramModalOpen" modal header="Write in Telegram" class="admin-telegram-dialog" data-testid="admin-telegram-dialog">
        <div class="admin-telegram-form">
          <section class="field wide-field admin-telegram-sender-picker" data-testid="admin-telegram-sender-picker">
            <span>Who you want to write from</span>
            <button
              type="button"
              :class="['admin-telegram-sender-summary', { open: adminTelegramSenderOpen }]"
              data-testid="admin-telegram-sender-summary"
              aria-haspopup="listbox"
              :aria-expanded="adminTelegramSenderOpen ? 'true' : 'false'"
              @click="toggleAdminTelegramSenderPicker"
            >
              <span>{{ adminTelegramSenderSummary }}</span>
              <i :class="adminTelegramSenderOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
            </button>
            <div v-if="adminTelegramSenderOpen" class="sender-browser" data-testid="admin-telegram-sender-dropdown">
              <div class="sender-column" data-testid="admin-telegram-market-column">
                <span class="sender-column-title">Market</span>
                <p v-if="adminTelegramLoading && !adminTelegramSenders.length" class="sender-empty">Loading accounts...</p>
                <button
                  v-for="market in adminTelegramSenderMarkets"
                  :key="market"
                  type="button"
                  :class="['sender-option', { selected: adminTelegramSelectedMarket === market }]"
                  :data-testid="`admin-telegram-market-${market}`"
                  @click="selectAdminTelegramMarket(market)"
                >
                  {{ market }}
                </button>
                <p v-if="!adminTelegramLoading && !adminTelegramSenderMarkets.length" class="sender-empty">No connected accounts</p>
              </div>
              <div v-if="adminTelegramSelectedMarket" class="sender-column" data-testid="admin-telegram-stack-column">
                <span class="sender-column-title">Stack</span>
                <p v-if="adminTelegramLoading && !adminTelegramSenderStacks.length" class="sender-empty">Loading stacks...</p>
                <button
                  v-for="stack in adminTelegramSenderStacks"
                  :key="stack"
                  type="button"
                  :class="['sender-option', { selected: adminTelegramSelectedStack === stack }]"
                  :data-testid="`admin-telegram-stack-${stack}`"
                  @click="selectAdminTelegramStack(stack)"
                >
                  {{ stack }}
                </button>
                <p v-if="!adminTelegramLoading && !adminTelegramSenderStacks.length" class="sender-empty">No stacks</p>
              </div>
              <div v-if="adminTelegramSelectedStack" class="sender-column sender-column-accounts" data-testid="admin-telegram-account-column">
                <span class="sender-column-title">Telegram</span>
                <InputText
                  v-model="adminTelegramSenderQuery"
                  class="sender-search"
                  placeholder="Search account"
                  data-testid="admin-telegram-sender-search"
                />
                <button
                  v-for="sender in adminTelegramVisibleSenders"
                  :key="adminTelegramSenderKeyFor(sender)"
                  type="button"
                  :class="['sender-option sender-account-option', { selected: adminTelegramSenderKey === adminTelegramSenderKeyFor(sender) }]"
                  :data-testid="`admin-telegram-sender-${sender.clientId}-${sender.accountId}`"
                  @click="selectAdminTelegramSender(sender)"
                >
                  <span>{{ sender.clientName }} - {{ sender.accountLabel }}</span>
                  <small>{{ sender.phone || sender.platform }}</small>
                </button>
                <p v-if="adminTelegramLoading && !adminTelegramVisibleSenders.length" class="sender-empty">Loading Telegram accounts...</p>
                <p v-if="!adminTelegramLoading && !adminTelegramVisibleSenders.length" class="sender-empty">No connected Telegram accounts</p>
              </div>
            </div>
          </section>
          <label class="field">
            <span>Who you want to write to</span>
            <InputText v-model="adminTelegramRecipient" placeholder="@username" data-testid="admin-telegram-recipient" @blur="normalizeAdminTelegramRecipient" />
          </label>
          <label class="field wide-field">
            <span>Message</span>
            <textarea v-model="adminTelegramMessage" class="native-textarea" rows="7" data-testid="admin-telegram-message"></textarea>
          </label>
          <div class="admin-telegram-attachments wide-field">
            <label class="file-button">
              <i class="pi pi-image"></i>
              <span>Add image</span>
              <input type="file" accept="image/*" data-testid="admin-telegram-image-input" @change="addAdminTelegramFiles" />
            </label>
            <label class="file-button">
              <i class="pi pi-paperclip"></i>
              <span>Add file</span>
              <input type="file" data-testid="admin-telegram-file-input" @change="addAdminTelegramFiles" />
            </label>
            <div v-if="adminTelegramAttachments.length" class="attachment-list" data-testid="admin-telegram-attachments">
              <button v-for="(attachment, index) in adminTelegramAttachments" :key="`${attachment.fileName}-${index}`" type="button" class="attachment-chip" @click="removeAdminTelegramAttachment(index)">
                {{ attachment.fileName }} x
              </button>
            </div>
          </div>
          <label class="checkbox-field wide-field" :title="adminTelegramVerifyTitle">
            <input v-model="adminTelegramAlwaysVerify" type="checkbox" data-testid="admin-telegram-always-verify" />
            <span>Always verify</span>
          </label>
        </div>
        <template #footer>
          <div class="admin-telegram-footer">
            <Message v-if="adminTelegramError" severity="error" :closable="false" class="admin-telegram-footer-message" data-testid="admin-telegram-error">
              {{ adminTelegramError }}
            </Message>
            <Message v-else-if="adminTelegramStatus" severity="success" :closable="false" class="admin-telegram-footer-message" data-testid="admin-telegram-status">
              {{ adminTelegramStatus }}
            </Message>
            <span v-else class="admin-telegram-footer-spacer" aria-hidden="true"></span>
            <Button label="Refresh" icon="pi pi-refresh" severity="secondary" outlined :loading="adminTelegramLoading" data-testid="admin-telegram-refresh-button" @click="loadAdminTelegramSenders" />
            <Button label="Write" icon="pi pi-send" :loading="adminTelegramLoading" data-testid="admin-telegram-send-button" @click="sendAdminTelegramMessage" />
          </div>
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
          <template #title>
            <div class="profile-card-title-row">
              <span>{{ dashboard.client.clientName }}</span>
              <Button
                v-if="isClient"
                :label="profileEditing ? 'View' : 'Edit'"
                :icon="profileEditing ? 'pi pi-eye' : 'pi pi-pencil'"
                severity="secondary"
                size="small"
                data-testid="open-profile-editor-button"
                @click="toggleProfileEditor"
              />
            </div>
          </template>
          <template #subtitle>{{ isAdmin ? 'Latest created client' : 'Your profile' }}</template>
          <template #content>
            <Accordion v-if="isClient" v-model:value="profileEditorOpen" class="profile-accordion" data-testid="profile-accordion">
              <AccordionPanel value="details">
                <AccordionHeader data-testid="profile-details-accordion-header">
                  <span class="accordion-title">
                    <i :class="profileEditing ? 'pi pi-user-edit' : 'pi pi-id-card'" aria-hidden="true"></i>
                    {{ profileEditing ? 'Editable personal details' : 'Personal data' }}
                  </span>
                </AccordionHeader>
                <AccordionContent>
                  <form v-if="profileEditing" class="profile-form" data-testid="profile-form" @submit.prevent="saveProfile">
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
                      <small>Write "no" if you have no education.</small>
                    </label>
                    <label class="field">
                      <span>Real age</span>
                      <InputText v-model="profileForm.realAge" type="number" min="0" step="1" data-testid="profile-real-age" />
                    </label>
                    <label class="field wide-field">
                      <span>Company stop list</span>
                      <InputText v-model="profileForm.stopListCompany" data-testid="profile-stop-list-company" />
                      <small>Use "," as delimiter, without spaces.</small>
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
                  <dl v-else class="info-list compact-info">
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
                      <dt>Real age</dt>
                      <dd>{{ dashboard.client.realAge ?? 'empty' }}</dd>
                    </div>
                    <div>
                      <dt>Company stop list</dt>
                      <dd>{{ dashboard.client.stopListCompany || 'empty' }}</dd>
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
                </AccordionContent>
              </AccordionPanel>
            </Accordion>
            <span v-if="profileMessage" class="success-text profile-status" data-testid="profile-save-message">{{ profileMessage }}</span>
            <dl v-if="!isClient" class="info-list compact-info">
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
                <dt>Real age</dt>
                <dd>{{ dashboard.client.realAge ?? 'empty' }}</dd>
              </div>
              <div>
                <dt>Company stop list</dt>
                <dd>{{ dashboard.client.stopListCompany || 'empty' }}</dd>
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

        <Card v-if="isClient" class="action-card telegram-card" data-testid="telegram-card">
          <template #title>
            <div class="profile-card-title-row">
              <span>Telegram</span>
              <span :class="telegramDotClass" :title="telegramStatusLabel"></span>
            </div>
          </template>
          <template #subtitle>{{ selectedTelegramAccount ? selectedTelegramAccount.accountLabel : 'No Telegram account row' }}</template>
          <template #content>
            <Message v-if="telegramError" severity="error" :closable="false" data-testid="telegram-error">
              {{ telegramError }}
            </Message>
            <div v-if="selectedTelegramAccount" class="telegram-panel">
              <Message severity="info" :closable="false" data-testid="telegram-beta-message">
                Telegram writing is in beta.
              </Message>
              <div class="telegram-status-row">
                <span data-testid="telegram-status">Status: {{ telegramStatusLabel }}</span>
                <Button icon="pi pi-refresh" label="Refresh" size="small" severity="secondary" :loading="telegramLoading" data-testid="telegram-refresh-button" @click="refreshTelegramStatus" />
              </div>
              <div class="telegram-connect-row">
                <InputText v-model="telegramPhone" placeholder="Phone" data-testid="telegram-phone" />
                <InputText v-if="telegramStatusLabel === 'needs_code'" v-model="telegramCode" placeholder="Code" data-testid="telegram-code" />
                <Password v-if="telegramStatusLabel === 'needs_password'" v-model="telegramPassword" placeholder="Cloud password" toggle-mask :feedback="false" data-testid="telegram-password" />
                <Button label="Connect Telegram" icon="pi pi-link" :loading="telegramLoading" data-testid="telegram-connect-button" @click="connectTelegram" />
                <Button label="Disconnect" icon="pi pi-times" severity="danger" outlined :loading="telegramLoading" data-testid="telegram-disconnect-button" @click="disconnectTelegram" />
              </div>
              <div v-if="telegramStatusLabel === 'active'" class="telegram-open-row">
                <Button v-if="!telegramOpen" label="Open Telegram" icon="pi pi-comments" severity="info" data-testid="telegram-open-button" @click="openTelegram" />
                <Button v-else label="Hide Telegram" icon="pi pi-chevron-up" severity="secondary" outlined data-testid="telegram-hide-button" @click="hideTelegram" />
              </div>
              <Accordion v-if="telegramOpen" v-model:value="telegramPanelOpen" class="telegram-accordion" data-testid="telegram-accordion">
                <AccordionPanel value="telegram">
                  <AccordionHeader>
                    <span class="accordion-title">
                      <i class="pi pi-comments"></i>
                      <span>Telegram</span>
                      <small>{{ telegramSelectedFolderTitle }}</small>
                    </span>
                  </AccordionHeader>
                  <AccordionContent>
                    <div class="telegram-toolbar">
                      <button
                        type="button"
                        :class="['telegram-mode-toggle', { enabled: telegramWriteEnabled }]"
                        :title="telegramModeTitle"
                        data-testid="telegram-write-toggle"
                        @click="toggleTelegramWriteMode"
                      >
                        <i :class="telegramWriteEnabled ? 'pi pi-lock-open' : 'pi pi-lock'"></i>
                        <span>{{ telegramModeLabel }}</span>
                      </button>
                      <select v-model="telegramList" class="native-select telegram-folder-select" data-testid="telegram-folder-select" @change="changeTelegramList">
                        <option v-for="folder in telegramFolders" :key="folder.id" :value="folder.id">
                          {{ folder.title }}
                        </option>
                      </select>
                      <form class="telegram-search-form" data-testid="telegram-search-form" @submit.prevent="loadTelegramDialogs">
                        <InputText v-model="telegramSearch" placeholder="Search chats" data-testid="telegram-search-input" />
                        <Button type="submit" icon="pi pi-search" severity="secondary" :loading="telegramLoading" data-testid="telegram-search-button" />
                      </form>
                      <Button icon="pi pi-refresh" severity="secondary" outlined :loading="telegramLoading" data-testid="telegram-dialogs-refresh-button" @click="loadTelegramDialogs" />
                    </div>
                    <section class="telegram-workspace" data-testid="telegram-workspace">
                      <aside class="telegram-dialogs">
                        <div
                          v-for="dialog in telegramDialogs"
                          :key="dialog.id"
                          role="button"
                          tabindex="0"
                          :class="['telegram-dialog', { active: telegramSelectedChatId === dialog.id }]"
                          @click="selectTelegramDialog(dialog)"
                          @keydown.enter.prevent="selectTelegramDialog(dialog)"
                          @keydown.space.prevent="selectTelegramDialog(dialog)"
                        >
                          <span class="telegram-dialog-title">
                            <span>{{ dialog.title }}</span>
                            <span v-if="dialog.username" class="telegram-username-row">
                              <small>{{ dialog.username }}</small>
                              <button
                                type="button"
                                class="telegram-username-copy"
                                :aria-label="`Copy ${dialog.username}`"
                                :title="`Copy ${dialog.username}`"
                                data-testid="telegram-username-copy-button"
                                @click="copyTelegramUsername(dialog.username, $event)"
                              >
                                <i class="pi pi-copy"></i>
                              </button>
                            </span>
                          </span>
                          <small v-if="dialog.unreadCount">{{ dialog.unreadCount }}</small>
                        </div>
                        <p v-if="!telegramDialogs.length" class="telegram-empty">No chats</p>
                        <p v-if="telegramCopiedUsername" class="telegram-copy-status" data-testid="telegram-copy-status">
                          Copied {{ telegramCopiedUsername }}
                        </p>
                      </aside>
                      <div class="telegram-chat">
                        <form v-if="telegramSelectedDialog?.isPrivate" class="telegram-contact-form" data-testid="telegram-contact-form" @submit.prevent="renameTelegramContact">
                          <InputText v-model="telegramRenameFirstName" placeholder="First name" data-testid="telegram-contact-first-name" />
                          <InputText v-model="telegramRenameLastName" placeholder="Last name" data-testid="telegram-contact-last-name" />
                          <Button type="submit" icon="pi pi-save" label="Save name" size="small" severity="secondary" :loading="telegramLoading" data-testid="telegram-contact-save-button" />
                          <span v-if="telegramRenameMessage" class="telegram-contact-status" data-testid="telegram-contact-status">{{ telegramRenameMessage }}</span>
                        </form>
                        <div class="telegram-messages">
                          <div v-for="message in telegramMessages" :key="message.id" :class="['telegram-message', { outgoing: message.outgoing }]">
                            {{ message.text }}
                          </div>
                        </div>
                        <form class="telegram-send-row" @submit.prevent="sendTelegramMessage">
                          <InputText v-model="telegramMessageText" :placeholder="telegramWriteEnabled ? 'Message' : 'Read-only mode'" :disabled="!telegramWriteEnabled" data-testid="telegram-message-input" />
                          <Button type="submit" icon="pi pi-send" label="Send" :disabled="!telegramWriteEnabled" :loading="telegramLoading" data-testid="telegram-send-button" />
                        </form>
                      </div>
                    </section>
                  </AccordionContent>
                </AccordionPanel>
              </Accordion>
            </div>
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

        <Card v-if="adminCanOpenDolphinProfiles" class="action-card">
          <template #title>Dolphin profile</template>
          <template #subtitle>Open profiles for the latest client</template>
          <template #content>
            <Button v-if="!hasActiveDolphinLease" label="Open Dolphin profiles" icon="pi pi-external-link" severity="info" :loading="dolphinLeaseLoading" data-testid="open-dolphin-admin-button" @click="openDolphinProfile(dashboard.client.clientName, dashboard.client.id, 'open_existing')" />
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
