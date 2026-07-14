type ResumeStatus =
  | 'stopped'
  | "collection student's data"
  | "collection Kira's comments"
  | 'Draft in process'
  | 'Draft in approve by Kira'
  | 'Draft in approve by student'
  | 'English version in progress'
  | 'English version in approve by Kira'
  | 'English version in approve by student'
  | 'Russian version in process'
  | 'Russian version in approve by Kira'
  | 'Russian version in approve by student'
  | 'moved to filling'
  | 'filled'

type ResumeActorRole = 'student' | 'kira' | 'provider' | 'unknown'
type ResumeNotificationKind = 'common_chat' | 'private_kira' | 'private_provider' | 'hh_summary'

type ResumeActorInput = {
  userId?: string
  username?: string
  chatId?: string
  chatType?: string
}

type ResumeActor = ResumeActorInput & {
  role: ResumeActorRole
}

type ResumeWorkflowRecord = {
  id: number
  clientId: number
  clientName: string
  clientMarket?: string
  clientTelegramUsername?: string
  clientGoogleFolder?: string
  commonChatId?: string
  education?: string
  englishLevel?: string
  englishLevelId?: number
  status: ResumeStatus | string
  studentDataFolderUrl: string
  cvDraftUrl: string
  enVersionUrl: string
  ruVersionUrl: string
  additionalVersions: string
  kirasComments: string
  lastResponsible: string
  lastWorkflowError: string
  workflowTrace: string
}

type ResumeWorkflowPatch = Partial<{
  status: ResumeStatus
  studentDataFolderUrl: string
  cvDraftUrl: string
  enVersionUrl: string
  ruVersionUrl: string
  additionalVersions: string
  kirasComments: string
  lastResponsible: string
  lastWorkflowError: string
  workflowTrace: string
}>

type ResumeWorkflowNotification = {
  kind: ResumeNotificationKind
  chatId?: string
  text: string
}

type ResumeProviderTask = {
  id: number
  clientId: number
  clientName: string
  status: string
  expectedStatus: string
  message: string
  callbackData: string
}

type ResumeWorkflowRepository = {
  getResumeWorkflowByTelegramChatId(chatId: string, options?: { ensure?: boolean }): Promise<ResumeWorkflowRecord | null>
  getResumeWorkflowById?(workflowId: number): Promise<ResumeWorkflowRecord | null>
  getProviderResumeTasks?(): Promise<ResumeWorkflowRecord[]>
  patchResumeWorkflow(recordId: number, patch: ResumeWorkflowPatch): Promise<ResumeWorkflowRecord>
}

type ResumeWorkflowOptions = {
  actor?: ResumeActorInput
  expectedStatus?: string
  studentDataFolderUrl?: string
}

type ResumeWorkflowResult = {
  found: boolean
  chatId: string
  testMode: boolean
  completed?: boolean
  stopped?: boolean
  client?: { id: number; name: string }
  workflow?: ResumeWorkflowRecord
  actor?: ResumeActor
  transitions?: string[]
  notifications?: ResumeWorkflowNotification[]
  message: string
}

type ProviderTaskListResult = {
  actor: ResumeActor
  tasks: ResumeProviderTask[]
  message: string
  replyMarkup?: unknown
}

const RESUME_STATUSES: ResumeStatus[] = [
  'stopped',
  "collection student's data",
  "collection Kira's comments",
  'Draft in process',
  'Draft in approve by Kira',
  'Draft in approve by student',
  'English version in progress',
  'English version in approve by Kira',
  'English version in approve by student',
  'Russian version in process',
  'Russian version in approve by Kira',
  'Russian version in approve by student',
  'moved to filling',
  'filled'
]

const PROVIDER_RESPONSIBLE_STATUSES = new Set([
  'Draft in process',
  'English version in progress',
  'Russian version in process',
  'moved to filling'
])

const KIRA_RESPONSIBLE_STATUSES = new Set([
  "collection Kira's comments",
  'Draft in approve by Kira',
  'English version in approve by Kira',
  'Russian version in approve by Kira'
])

const DEFAULT_TEST_CONFIG = {
  studentDataFolderUrl: 'https://drive.google.com/drive/folders/test-student-data',
  draftUrl: 'https://docs.google.com/document/d/test-draft',
  englishUrl: 'https://docs.google.com/document/d/test-english-version',
  russianUrl: 'https://docs.google.com/document/d/test-russian-version',
  kirasComments: 'Looks good for test. Please prepare the draft based on provided source data.'
}

const DEFAULT_KIRA_USER_IDS = ['7586552066']
const DEFAULT_PROVIDER_USER_IDS = ['8222949251']
const DEFAULT_KIRA_PLATFORM_REFS = ['1:452']
const DEFAULT_PROVIDER_PLATFORM_REFS = ['102:473']

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeUsername(value: unknown): string {
  return normalizeText(value).replace(/^@+/, '').toLowerCase()
}

function normalizeId(value: unknown): string {
  return normalizeText(value).replace(/\.0$/, '')
}

function envList(name: string, fallback: string[] = []): string[] {
  const raw = normalizeText(process.env[name])
  if (!raw) return fallback
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function envIdSet(name: string, fallback: string[] = []): Set<string> {
  return new Set(envList(name, fallback).map(normalizeId).filter(Boolean))
}

function envClientIdSetFromRefs(name: string, fallback: string[] = []): Set<number> {
  const clientIds = envList(name, fallback)
    .map(item => Number(normalizeText(item).split(':')[0]))
    .filter(clientId => Number.isFinite(clientId) && clientId > 0)
  return new Set(clientIds)
}

function resumeWorkflowTestMode(): boolean {
  return normalizeText(process.env.RESUME_WORKFLOW_TEST_MODE).toLowerCase() === 'true'
}

function resumeWorkflowFakeDataMode(): boolean {
  return normalizeText(process.env.RESUME_WORKFLOW_FAKE_DATA_MODE).toLowerCase() === 'true'
}

function fakeConfig() {
  return {
    studentDataFolderUrl: normalizeText(process.env.RESUME_WORKFLOW_FAKE_STUDENT_DATA_FOLDER) || DEFAULT_TEST_CONFIG.studentDataFolderUrl,
    draftUrl: normalizeText(process.env.RESUME_WORKFLOW_FAKE_DRAFT_LINK) || DEFAULT_TEST_CONFIG.draftUrl,
    englishUrl: normalizeText(process.env.RESUME_WORKFLOW_FAKE_ENGLISH_LINK) || DEFAULT_TEST_CONFIG.englishUrl,
    russianUrl: normalizeText(process.env.RESUME_WORKFLOW_FAKE_RUSSIAN_LINK) || DEFAULT_TEST_CONFIG.russianUrl,
    kirasComments: normalizeText(process.env.RESUME_WORKFLOW_FAKE_KIRAS_COMMENTS) || DEFAULT_TEST_CONFIG.kirasComments
  }
}

function defaultKiraNotifyChatId(): string {
  return normalizeText(process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID) || envList('RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS', DEFAULT_KIRA_USER_IDS)[0] || ''
}

function defaultProviderNotifyChatId(): string {
  return normalizeText(process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID) || envList('RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS', DEFAULT_PROVIDER_USER_IDS)[0] || ''
}

function statusText(record: ResumeWorkflowRecord | null): ResumeStatus | string {
  return normalizeText(record?.status) || "collection student's data"
}

function actorLabel(actor: ResumeActor): string {
  const pieces = [
    actor.role,
    actor.userId ? `user:${actor.userId}` : undefined,
    actor.username ? `@${normalizeUsername(actor.username)}` : undefined
  ].filter(Boolean)
  return pieces.join(' ')
}

function appendTrace(record: ResumeWorkflowRecord, event: string, actor?: ResumeActor): string {
  const previous = normalizeText(record.workflowTrace)
  const actorPart = actor ? ` by ${actorLabel(actor)}` : ''
  const line = `${new Date().toISOString()} ${event}${actorPart}`
  return previous ? `${previous}\n${line}` : line
}

function publicWorkflow(record: ResumeWorkflowRecord) {
  return {
    id: record.id,
    clientId: record.clientId,
    clientName: record.clientName,
    clientMarket: record.clientMarket,
    status: statusText(record),
    studentDataFolderUrl: record.studentDataFolderUrl,
    cvDraftUrl: record.cvDraftUrl,
    enVersionUrl: record.enVersionUrl,
    ruVersionUrl: record.ruVersionUrl,
    kirasComments: record.kirasComments,
    lastResponsible: record.lastResponsible,
    lastWorkflowError: record.lastWorkflowError
  }
}

function statusResponsibility(status: string): ResumeActorRole | 'done' | 'admin' {
  if (status === 'filled') return 'done'
  if (status === 'stopped') return 'admin'
  if (status.includes('Kira')) return 'kira'
  if (status.includes('student')) return 'student'
  if (status.includes('process') || status.includes('progress') || status === 'moved to filling') return 'provider'
  return 'student'
}

function displayResponsibility(status: string): string {
  const responsibility = statusResponsibility(status)
  if (responsibility === 'kira') return 'Kira'
  return responsibility
}

function nextActionForStatus(status: string): string {
  switch (status) {
    case "collection student's data":
      return 'Next: student should complete the required profile details in the Console. The bot will verify the root Google folder from Noco.'
    case "collection Kira's comments":
      return "Next: Kira should add comments for the provider."
    case 'Draft in process':
      return 'Next: provider should prepare the draft CV.'
    case 'Draft in approve by Kira':
      return 'Next: Kira should approve the draft.'
    case 'Draft in approve by student':
      return 'Next: student should approve the draft.'
    case 'English version in progress':
      return 'Next: provider should prepare the English version.'
    case 'English version in approve by Kira':
      return 'Next: Kira should approve the English version.'
    case 'English version in approve by student':
      return 'Next: student should approve the English version.'
    case 'Russian version in process':
      return 'Next: provider should prepare the Russian version.'
    case 'Russian version in approve by Kira':
      return 'Next: Kira should approve the Russian version.'
    case 'Russian version in approve by student':
      return 'Next: student should approve the Russian version.'
    case 'moved to filling':
      return 'Next: provider should move final versions to filling.'
    default:
      return ''
  }
}

function studentApprovalDetails(record: ResumeWorkflowRecord): string {
  const status = statusText(record)
  const link = status === 'Draft in approve by student'
    ? normalizeText(record.cvDraftUrl)
    : status === 'English version in approve by student'
      ? normalizeText(record.enVersionUrl)
      : status === 'Russian version in approve by student'
        ? normalizeText(record.ruVersionUrl)
        : ''
  if (!link) return ''
  const label = status === 'Draft in approve by student'
    ? 'Draft CV'
    : status === 'English version in approve by student'
      ? 'English CV version'
      : 'Russian CV version'
  return [
    `${label}: ${link}`,
    'Please review the file above.',
    'To approve it, send:',
    '/resume I approve',
    'After that I will move the resume workflow to the next step.'
  ].join('\n')
}

function statusInstruction(record: ResumeWorkflowRecord): string {
  const status = statusText(record)
  if (status === 'filled') {
    return [
      `Resume workflow is completed for ${record.clientName}.`,
      record.enVersionUrl ? `English version: ${record.enVersionUrl}` : '',
      record.ruVersionUrl ? `Russian version: ${record.ruVersionUrl}` : ''
    ].filter(Boolean).join('\n')
  }
  if (status === 'stopped') {
    return [
      `Resume workflow is stopped for ${record.clientName}.`,
      record.lastWorkflowError ? `Last error: ${record.lastWorkflowError}` : 'Last error is empty.',
      'Use /resume_reset_test only in test mode, or ask admin to retry after fixing the problem.'
    ].join('\n')
  }
  return [
    `Resume workflow status for ${record.clientName}: ${status}`,
    `Responsible: ${displayResponsibility(status)}`,
    nextActionForStatus(status),
    studentApprovalDetails(record)
  ].filter(Boolean).join('\n')
}

function parseStudentUserIdMap(): Map<number, Set<string>> {
  const raw = normalizeText(process.env.RESUME_WORKFLOW_STUDENT_USER_IDS_BY_CLIENT)
  const result = new Map<number, Set<string>>()
  if (!raw) return result
  for (const pair of raw.split(',')) {
    const [clientIdRaw, userIdRaw] = pair.split(':')
    const clientId = Number(clientIdRaw)
    const userId = normalizeId(userIdRaw)
    if (!Number.isFinite(clientId) || clientId <= 0 || !userId) continue
    result.set(clientId, new Set([...(result.get(clientId) ?? []), userId]))
  }
  return result
}

function resolveActorForWorkflow(input: ResumeActorInput | undefined, workflow?: ResumeWorkflowRecord | null): ResumeActor {
  const userId = normalizeId(input?.userId)
  const username = normalizeUsername(input?.username)
  const actorBase = {
    userId,
    username,
    chatId: normalizeId(input?.chatId),
    chatType: normalizeText(input?.chatType)
  }

  const configuredRole = (): ResumeActorRole => {
    if (userId && envIdSet('RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS', DEFAULT_KIRA_USER_IDS).has(userId)) {
      return 'kira'
    }
    if (userId && envIdSet('RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS', DEFAULT_PROVIDER_USER_IDS).has(userId)) {
      return 'provider'
    }
    return 'unknown'
  }
  const configuredActorRole = configuredRole()

  if (!workflow && configuredActorRole !== 'unknown') {
    return { ...actorBase, role: configuredActorRole }
  }

  if (workflow && statusResponsibility(statusText(workflow)) !== 'student' && configuredActorRole !== 'unknown') {
    return { ...actorBase, role: configuredActorRole }
  }

  if (workflow) {
    const expectedStudentUsername = normalizeUsername(workflow.clientTelegramUsername)
    const studentUserIds = parseStudentUserIdMap().get(Number(workflow.clientId)) ?? new Set<string>()
    const workflowChatId = normalizeId(workflow.commonChatId)
    const actorChatId = normalizeId(input?.chatId)
    const chatType = normalizeText(input?.chatType).toLowerCase()
    const isLinkedClientChat = Boolean(workflowChatId && actorChatId && workflowChatId === actorChatId)
    const isGroupChat = chatType === 'group' || chatType === 'supergroup'

    if (isLinkedClientChat || isGroupChat) {
      if (expectedStudentUsername && username && expectedStudentUsername === username) {
        return { ...actorBase, role: 'student' }
      }
      if (userId && studentUserIds.has(userId)) {
        return { ...actorBase, role: 'student' }
      }
    }
  }

  if (configuredActorRole !== 'unknown') {
    return { ...actorBase, role: configuredActorRole }
  }

  if (workflow) {
    const expectedStudentUsername = normalizeUsername(workflow.clientTelegramUsername)
    const studentUserIds = parseStudentUserIdMap().get(Number(workflow.clientId)) ?? new Set<string>()
    if (expectedStudentUsername && username && expectedStudentUsername === username) {
      return { ...actorBase, role: 'student' }
    }
    if (userId && studentUserIds.has(userId)) {
      return { ...actorBase, role: 'student' }
    }
  }

  return { ...actorBase, role: 'unknown' }
}

function resolveGlobalActor(input: ResumeActorInput | undefined): ResumeActor {
  return resolveActorForWorkflow(input, null)
}

function taskActorTitle(actor: ResumeActor): string {
  return actor.role === 'kira' ? 'Kira' : 'Provider'
}

function ensureTaskActor(actor: ResumeActor): void {
  if (actor.role !== 'provider' && actor.role !== 'kira') {
    throw Object.assign(new Error('Only configured Kira or provider Telegram accounts can open resume tasks.'), {
      code: 'forbidden'
    })
  }
}

function taskStatusesForActor(actor: ResumeActor): Set<string> {
  return actor.role === 'kira' ? KIRA_RESPONSIBLE_STATUSES : PROVIDER_RESPONSIBLE_STATUSES
}

function providerCanAccessWorkflow(workflow: ResumeWorkflowRecord): boolean {
  const allowedClientIds = envClientIdSetFromRefs(
    'RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS',
    DEFAULT_PROVIDER_PLATFORM_REFS
  )
  return allowedClientIds.size === 0 || allowedClientIds.has(Number(workflow.clientId))
}

function actorCanAccessTaskWorkflow(workflow: ResumeWorkflowRecord, actor: ResumeActor): boolean {
  if (!taskStatusesForActor(actor).has(statusText(workflow))) return false
  if (actor.role === 'provider') return providerCanAccessWorkflow(workflow)
  return actor.role === 'kira'
}

function ensureActorCanAdvance(workflow: ResumeWorkflowRecord, actor: ResumeActor): void {
  const status = statusText(workflow)
  const required = statusResponsibility(status)
  if (required === 'done') {
    throw Object.assign(new Error('Resume workflow is already completed.'), { code: 'resume_workflow_noop' })
  }
  if (required === 'admin') {
    throw Object.assign(new Error('Resume workflow is stopped and requires admin action.'), { code: 'resume_workflow_stopped' })
  }
  if (actor.role !== required) {
    throw Object.assign(
      new Error(`This step must be advanced by ${displayResponsibility(status)}.`),
      { code: 'forbidden', requiredRole: required, actorRole: actor.role }
    )
  }
  if (required === 'provider' && !providerCanAccessWorkflow(workflow)) {
    throw Object.assign(
      new Error(`Provider account is not assigned to ${workflow.clientName}.`),
      { code: 'forbidden', requiredRole: required, actorRole: actor.role, clientId: workflow.clientId }
    )
  }
}

function ensureExpectedStatus(workflow: ResumeWorkflowRecord, expectedStatus?: string): void {
  const expected = normalizeText(expectedStatus)
  if (!expected) return
  const current = statusText(workflow)
  if (current !== expected) {
    throw Object.assign(
      new Error(`Resume workflow status changed from ${expected} to ${current}. Refresh tasks and try again.`),
      { code: 'resume_workflow_stale_status' }
    )
  }
}

function requiredClientDataIssues(record: ResumeWorkflowRecord): string[] {
  const issues: string[] = []
  if (!normalizeText(record.education)) issues.push('Education')
  if (!normalizeText(record.englishLevel) && !record.englishLevelId) issues.push('English level')
  return issues
}

function ensureRequiredClientData(record: ResumeWorkflowRecord): void {
  const issues = requiredClientDataIssues(record)
  if (!issues.length) return
  throw Object.assign(
    new Error(`Please add missing fields in your Console before continuing: ${issues.join(', ')}.`),
    { code: 'resume_required_data_missing', missingFields: issues }
  )
}

function normalizeOptionalUrl(value: unknown): string {
  const url = normalizeText(value)
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error('Please send a valid Google folder link after /resume.'), {
      code: 'invalid_student_data_folder_url'
    })
  }
  return url
}

function missingAdvanceFields(record: ResumeWorkflowRecord, fakeDataMode = resumeWorkflowFakeDataMode()): string[] {
  switch (statusText(record)) {
    case "collection student's data":
      return [
        normalizeText(record.clientGoogleFolder) ? undefined : 'root_google_folder',
        normalizeText(record.studentDataFolderUrl) ? undefined : 'student_data_folder_url'
      ].filter((item): item is string => Boolean(item))
    case "collection Kira's comments":
      if (fakeDataMode) return []
      return normalizeText(record.kirasComments) ? [] : ['kiras_comments']
    case 'Draft in process':
      if (fakeDataMode) return []
      return normalizeText(record.cvDraftUrl) ? [] : ['cv_draft_url']
    case 'English version in progress':
      if (fakeDataMode) return []
      return normalizeText(record.enVersionUrl) ? [] : ['en_version_url']
    case 'Russian version in process':
      if (fakeDataMode) return []
      return normalizeText(record.ruVersionUrl) ? [] : ['ru_version_url']
    default:
      return []
  }
}

function valueOrFake(value: unknown, fakeValue: string, fakeDataMode: boolean): string {
  return normalizeText(value) || (fakeDataMode ? fakeValue : '')
}

function plannedPatch(record: ResumeWorkflowRecord, fakeDataMode: boolean): ResumeWorkflowPatch | null {
  const status = statusText(record)
  const fake = fakeConfig()

  if (status === 'filled' || status === 'stopped') return null

  switch (status) {
    case "collection student's data":
      ensureRequiredClientData(record)
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return {
        status: "collection Kira's comments",
        lastResponsible: 'Kira'
      }
    case "collection Kira's comments":
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return {
        status: 'Draft in process',
        kirasComments: valueOrFake(record.kirasComments, fake.kirasComments, fakeDataMode),
        lastResponsible: 'provider'
      }
    case 'Draft in process':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return {
        status: 'Draft in approve by Kira',
        cvDraftUrl: valueOrFake(record.cvDraftUrl, fake.draftUrl, fakeDataMode),
        lastResponsible: 'Kira'
      }
    case 'Draft in approve by Kira':
      return { status: 'Draft in approve by student', lastResponsible: 'student' }
    case 'Draft in approve by student':
      return { status: 'English version in progress', lastResponsible: 'provider' }
    case 'English version in progress':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return {
        status: 'English version in approve by Kira',
        enVersionUrl: valueOrFake(record.enVersionUrl, fake.englishUrl, fakeDataMode),
        lastResponsible: 'Kira'
      }
    case 'English version in approve by Kira':
      return { status: 'English version in approve by student', lastResponsible: 'student' }
    case 'English version in approve by student':
      return { status: 'Russian version in process', lastResponsible: 'provider' }
    case 'Russian version in process':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return {
        status: 'Russian version in approve by Kira',
        ruVersionUrl: valueOrFake(record.ruVersionUrl, fake.russianUrl, fakeDataMode),
        lastResponsible: 'Kira'
      }
    case 'Russian version in approve by Kira':
      return { status: 'Russian version in approve by student', lastResponsible: 'student' }
    case 'Russian version in approve by student':
      return { status: 'filled', lastResponsible: 'done' }
    case 'moved to filling':
      return { status: 'filled', lastResponsible: 'done' }
    default:
      return { status: "collection student's data", lastResponsible: 'student' }
  }
}

function clientMention(record: ResumeWorkflowRecord): string {
  const username = normalizeUsername(record.clientTelegramUsername)
  return username ? `@${username}` : record.clientName
}

function clientMarketLabel(record: ResumeWorkflowRecord): string {
  const market = normalizeText(record.clientMarket)
  return [record.clientName, market].filter(Boolean).join(' ')
}

function notificationForNextResponsible(record: ResumeWorkflowRecord): ResumeWorkflowNotification | null {
  const status = statusText(record)
  const responsible = statusResponsibility(status)
  const mention = clientMention(record)
  const intro = `${mention}, resume workflow for ${clientMarketLabel(record)} moved to "${status}".`
  const action = nextActionForStatus(status)

  if (status === 'filled') {
    const chatId = defaultKiraNotifyChatId()
    if (!chatId) return null
    const text = [
      `Resume workflow for ${clientMarketLabel(record)} is filled.`,
      record.enVersionUrl ? `English version: ${record.enVersionUrl}` : undefined,
      record.ruVersionUrl ? `Russian version: ${record.ruVersionUrl}` : undefined
    ].filter(Boolean).join('\n')
    return { kind: 'private_kira', chatId, text }
  }

  if (responsible === 'student') {
    const chatId = normalizeId(record.commonChatId)
    if (!chatId) return null
    const text = [intro, action, studentApprovalDetails(record)].filter(Boolean).join('\n')
    return { kind: 'common_chat', chatId, text }
  }
  if (responsible === 'kira') {
    const chatId = defaultKiraNotifyChatId()
    if (!chatId) return null
    const text = [
      intro,
      action,
      '',
      'Open /open_my_tasks to process this task.',
      '',
      providerTaskMessage(record)
    ].filter(Boolean).join('\n')
    return { kind: 'private_kira', chatId, text }
  }
  if (responsible === 'provider') {
    const chatId = defaultProviderNotifyChatId()
    if (!chatId) return null
    const text = [
      intro,
      action,
      '',
      'Open /open_my_tasks to process this task.',
      '',
      providerTaskMessage(record)
    ].filter(Boolean).join('\n')
    return { kind: 'private_provider', chatId, text }
  }

  return null
}

function movedToFillingSummary(record: ResumeWorkflowRecord, testMode: boolean): ResumeWorkflowNotification | null {
  if (!testMode || statusText(record) !== 'moved to filling') return null
  return {
    kind: 'hh_summary',
    text: `Test mode, do nothing. Account of ${clientMarketLabel(record)} is ready to filling, links to RU: ${record.ruVersionUrl || 'n/a'}, EN: ${record.enVersionUrl || 'n/a'}. @kirasamsonova fyi`
  }
}

function buildTransitionNotifications(record: ResumeWorkflowRecord, testMode: boolean): ResumeWorkflowNotification[] {
  return [
    notificationForNextResponsible(record),
    movedToFillingSummary(record, testMode)
  ].filter((item): item is ResumeWorkflowNotification => Boolean(item))
}

function callbackData(action: 'open' | 'advance', workflowId: number, expectedStatus?: string): string {
  const encodedStatus = expectedStatus ? Buffer.from(expectedStatus, 'utf8').toString('base64url') : ''
  return ['resume', action, String(workflowId), encodedStatus].filter(Boolean).join(':')
}

function decodeCallbackStatus(value: string | undefined): string {
  if (!value) return ''
  return Buffer.from(value, 'base64url').toString('utf8')
}

function providerTaskFromWorkflow(workflow: ResumeWorkflowRecord): ResumeProviderTask {
  const status = statusText(workflow)
  return {
    id: workflow.id,
    clientId: workflow.clientId,
    clientName: workflow.clientName,
    status,
    expectedStatus: status,
    message: `${workflow.clientName}: ${status}`,
    callbackData: callbackData('open', workflow.id)
  }
}

function providerTaskMessage(workflow: ResumeWorkflowRecord): string {
  const missing = missingAdvanceFields(workflow)
  const explicitSourceFolder = normalizeText(workflow.studentDataFolderUrl)
  const rootGoogleFolder = normalizeText(workflow.clientGoogleFolder)
  const rows = [
    `Student: ${workflow.clientName}`,
    workflow.clientMarket ? `Market: ${workflow.clientMarket}` : undefined,
    `Status: ${statusText(workflow)}`,
    rootGoogleFolder ? `Root Google folder: ${rootGoogleFolder}` : undefined,
    explicitSourceFolder && explicitSourceFolder !== rootGoogleFolder ? `Source data folder: ${explicitSourceFolder}` : undefined,
    workflow.kirasComments ? `Kira comments: ${workflow.kirasComments}` : undefined,
    workflow.cvDraftUrl ? `Draft: ${workflow.cvDraftUrl}` : undefined,
    workflow.enVersionUrl ? `EN: ${workflow.enVersionUrl}` : undefined,
    workflow.ruVersionUrl ? `RU: ${workflow.ruVersionUrl}` : undefined,
    missing.length ? `Required before processing: ${missing.join(', ')}` : undefined
  ].filter(Boolean)

  return rows.join('\n')
}

function missingDataInstruction(workflow: ResumeWorkflowRecord): string {
  const missing = missingAdvanceFields(workflow)
  if (statusText(workflow) === "collection student's data" && missing.includes('root_google_folder')) {
    return `@veu_support pls add ${workflow.clientName}'s root Google folder in Noco clients.google_folder`
  }
  if (statusText(workflow) === "collection student's data" && missing.includes('student_data_folder_url')) {
    const rootFolder = normalizeText(workflow.clientGoogleFolder)
    return [
      'Please add your self-presentation and resume/source files to the correct Google folder.',
      rootFolder ? `Main/root Google folder: ${rootFolder}` : undefined,
      'Then send /resume <link to the self-presentation/source-data folder>.'
    ].filter(Boolean).join('\n')
  }
  return 'No status change yet. Add the required data in Noco/Admin Console, then run the command again.'
}

function taskReplyMarkup(workflow: ResumeWorkflowRecord) {
  const status = statusText(workflow)
  const buttons: Array<Array<{ text: string; callback_data: string }>> = []
  if (!missingAdvanceFields(workflow).length) {
    buttons.push([
      {
        text: 'Process next step',
        callback_data: callbackData('advance', workflow.id, status)
      }
    ])
  }
  buttons.push([
    {
      text: 'Back to tasks',
      callback_data: 'resume:tasks'
    }
  ])
  return {
    inline_keyboard: buttons
  }
}

function taskListReplyMarkup(tasks: ResumeProviderTask[]) {
  return {
    inline_keyboard: tasks.map(task => ([
      {
        text: task.message.slice(0, 60),
        callback_data: task.callbackData
      }
    ]))
  }
}

async function getResumeStatus(chatId: string, repository: ResumeWorkflowRepository, options: ResumeWorkflowOptions = {}): Promise<ResumeWorkflowResult> {
  const workflow = await repository.getResumeWorkflowByTelegramChatId(chatId, { ensure: true })
  if (!workflow) {
    return {
      found: false,
      chatId,
      testMode: resumeWorkflowTestMode(),
      actor: resolveGlobalActor(options.actor),
      message: [
        'No student found for this Telegram chat.',
        '',
        `Chat ID: ${chatId}`,
        'Please link this chat ID to a student in NocoDB/Admin Console.'
      ].join('\n')
    }
  }
  const status = statusText(workflow)
  return {
    found: true,
    chatId,
    testMode: resumeWorkflowTestMode(),
    completed: status === 'filled',
    stopped: status === 'stopped',
    client: { id: workflow.clientId, name: workflow.clientName },
    workflow,
    actor: resolveActorForWorkflow(options.actor, workflow),
    message: statusInstruction(workflow)
  }
}

async function advanceWorkflow(workflow: ResumeWorkflowRecord, repository: ResumeWorkflowRepository, options: ResumeWorkflowOptions = {}): Promise<ResumeWorkflowResult> {
  const testMode = resumeWorkflowTestMode()
  const actor = resolveActorForWorkflow(options.actor, workflow)
  const before = statusText(workflow)
  ensureExpectedStatus(workflow, options.expectedStatus)
  ensureActorCanAdvance(workflow, actor)

  const suppliedStudentDataFolderUrl = before === "collection student's data" && actor.role === 'student'
    ? normalizeOptionalUrl(options.studentDataFolderUrl)
    : ''
  if (
    suppliedStudentDataFolderUrl &&
    before === "collection student's data" &&
    actor.role === 'student' &&
    !normalizeText(workflow.studentDataFolderUrl)
  ) {
    workflow = await repository.patchResumeWorkflow(workflow.id, {
      studentDataFolderUrl: suppliedStudentDataFolderUrl,
      lastWorkflowError: '',
      workflowTrace: appendTrace(workflow, 'student_data_folder_url saved', actor)
    })
  }

  const patch = plannedPatch(workflow, resumeWorkflowFakeDataMode())
  const transitions: string[] = []
  if (patch) {
    const after = patch.status ?? before
    workflow = await repository.patchResumeWorkflow(workflow.id, {
      ...patch,
      lastWorkflowError: '',
      workflowTrace: appendTrace(workflow, `${before} -> ${after}`, actor)
    })
    transitions.push(`${before} -> ${after}`)
  }

  const status = statusText(workflow)
  return {
    found: true,
    chatId: normalizeText(workflow.commonChatId),
    testMode,
    completed: status === 'filled',
    stopped: status === 'stopped',
    client: { id: workflow.clientId, name: workflow.clientName },
    workflow,
    actor,
    transitions,
    notifications: transitions.length ? buildTransitionNotifications(workflow, testMode) : [],
    message: transitions.length
      ? statusInstruction(workflow)
      : [
          statusInstruction(workflow),
          '',
          missingDataInstruction(workflow)
        ].join('\n')
  }
}

async function resumeWorkflow(chatId: string, repository: ResumeWorkflowRepository, options: ResumeWorkflowOptions = {}): Promise<ResumeWorkflowResult> {
  const testMode = resumeWorkflowTestMode()
  const workflow = await repository.getResumeWorkflowByTelegramChatId(chatId, { ensure: true })
  if (!workflow) {
    return {
      found: false,
      chatId,
      testMode,
      actor: resolveGlobalActor(options.actor),
      message: [
        'No student found for this Telegram chat.',
        '',
        `Chat ID: ${chatId}`,
        'Please link this chat ID to a student in NocoDB/Admin Console.'
      ].join('\n')
    }
  }

  return await advanceWorkflow(workflow, repository, {
    ...options,
    actor: {
      ...options.actor,
      chatId: options.actor?.chatId || chatId
    }
  })
}

async function resumeWorkflowById(workflowId: number, repository: ResumeWorkflowRepository, options: ResumeWorkflowOptions = {}): Promise<ResumeWorkflowResult> {
  if (!repository.getResumeWorkflowById) {
    throw new Error('Repository does not support resume workflow lookup by id.')
  }
  const workflow = await repository.getResumeWorkflowById(workflowId)
  if (!workflow) {
    return {
      found: false,
      chatId: '',
      testMode: resumeWorkflowTestMode(),
      actor: resolveGlobalActor(options.actor),
      message: 'Resume workflow was not found.'
    }
  }
  return await advanceWorkflow(workflow, repository, options)
}

async function resetResumeWorkflowForTest(chatId: string, repository: ResumeWorkflowRepository): Promise<ResumeWorkflowResult> {
  const testMode = resumeWorkflowTestMode()
  if (!testMode) {
    throw Object.assign(new Error('/resume_reset_test is available only when RESUME_WORKFLOW_TEST_MODE=true.'), {
      code: 'resume_reset_test_disabled'
    })
  }
  const workflow = await repository.getResumeWorkflowByTelegramChatId(chatId, { ensure: true })
  if (!workflow) {
    return {
      found: false,
      chatId,
      testMode,
      message: 'No student found for this Telegram chat.'
    }
  }
  const reset = await repository.patchResumeWorkflow(workflow.id, {
    status: "collection student's data",
    studentDataFolderUrl: '',
    cvDraftUrl: '',
    enVersionUrl: '',
    ruVersionUrl: '',
    additionalVersions: '',
    kirasComments: '',
    lastResponsible: 'student',
    lastWorkflowError: '',
    workflowTrace: appendTrace(workflow, 'reset test workflow')
  })
  return {
    found: true,
    chatId,
    testMode,
    client: { id: reset.clientId, name: reset.clientName },
    workflow: reset,
    transitions: ['reset'],
    message: `Resume test workflow reset for ${reset.clientName}.`
  }
}

async function getProviderTasks(repository: ResumeWorkflowRepository, actorInput?: ResumeActorInput): Promise<ProviderTaskListResult> {
  const actor = resolveGlobalActor(actorInput)
  ensureTaskActor(actor)
  if (!repository.getProviderResumeTasks) {
    throw new Error('Repository does not support provider resume tasks.')
  }

  const workflows = (await repository.getProviderResumeTasks())
    .filter(workflow => actorCanAccessTaskWorkflow(workflow, actor))
  const tasks = workflows.map(providerTaskFromWorkflow)
  const title = taskActorTitle(actor)

  return {
    actor,
    tasks,
    message: tasks.length
      ? [
          `${title} resume tasks:`,
          '',
          ...workflows.map((workflow, index) => `${index + 1}.\n${providerTaskMessage(workflow)}`)
        ].join('\n')
      : `No ${title.toLowerCase()} resume tasks are waiting right now.`,
    replyMarkup: tasks.length ? taskListReplyMarkup(tasks) : undefined
  }
}

async function getProviderTaskById(workflowId: number, repository: ResumeWorkflowRepository, actorInput?: ResumeActorInput): Promise<ProviderTaskListResult & { workflow?: ResumeWorkflowRecord }> {
  const actor = resolveGlobalActor(actorInput)
  ensureTaskActor(actor)
  if (!repository.getResumeWorkflowById) {
    throw new Error('Repository does not support resume workflow lookup by id.')
  }
  const workflow = await repository.getResumeWorkflowById(workflowId)
  if (!workflow || !actorCanAccessTaskWorkflow(workflow, actor)) {
    return {
      actor,
      tasks: [],
      message: 'This resume task is not available anymore. Refresh your task list.'
    }
  }

  return {
    actor,
    workflow,
    tasks: [providerTaskFromWorkflow(workflow)],
    message: providerTaskMessage(workflow),
    replyMarkup: taskReplyMarkup(workflow)
  }
}

async function saveKiraCommentsFromChat(repository: ResumeWorkflowRepository, actorInput: ResumeActorInput | undefined, comments: string): Promise<ProviderTaskListResult & { workflow?: ResumeWorkflowRecord }> {
  const actor = resolveGlobalActor(actorInput)
  ensureTaskActor(actor)
  if (actor.role !== 'kira') {
    throw Object.assign(new Error('Only Kira can add Kira comments from chat.'), { code: 'forbidden' })
  }
  if (!repository.getProviderResumeTasks) {
    throw new Error('Repository does not support provider resume tasks.')
  }

  const text = normalizeText(comments)
  if (!text) {
    throw Object.assign(new Error('Kira comments text is required.'), { code: 'missing_kira_comments' })
  }

  const commentTasks = (await repository.getProviderResumeTasks())
    .filter(workflow => actorCanAccessTaskWorkflow(workflow, actor))
    .filter(workflow => statusText(workflow) === "collection Kira's comments")

  if (!commentTasks.length) {
    return {
      actor,
      tasks: [],
      message: 'No Kira resume task is waiting for comments right now.'
    }
  }

  if (commentTasks.length > 1) {
    return {
      actor,
      tasks: commentTasks.map(providerTaskFromWorkflow),
      message: 'More than one Kira resume task is waiting for comments. Open a specific task first.',
      replyMarkup: taskListReplyMarkup(commentTasks.map(providerTaskFromWorkflow))
    }
  }

  const workflow = commentTasks[0]
  const updated = await repository.patchResumeWorkflow(workflow.id, {
    kirasComments: text,
    lastWorkflowError: '',
    workflowTrace: appendTrace(workflow, 'Kira comments saved from Telegram chat', actor)
  })

  return {
    actor,
    workflow: updated,
    tasks: [providerTaskFromWorkflow(updated)],
    message: [
      `Kira comments saved for ${updated.clientName}.`,
      '',
      providerTaskMessage(updated)
    ].join('\n'),
    replyMarkup: taskReplyMarkup(updated)
  }
}

function providerLinkRequirement(workflow: ResumeWorkflowRecord): {
  field: 'cvDraftUrl' | 'enVersionUrl' | 'ruVersionUrl'
  label: string
  trace: string
} | null {
  switch (statusText(workflow)) {
    case 'Draft in process':
      return { field: 'cvDraftUrl', label: 'Draft link', trace: 'CV draft link saved from Telegram chat' }
    case 'English version in progress':
      return { field: 'enVersionUrl', label: 'English version link', trace: 'English version link saved from Telegram chat' }
    case 'Russian version in process':
      return { field: 'ruVersionUrl', label: 'Russian version link', trace: 'Russian version link saved from Telegram chat' }
    default:
      return null
  }
}

async function saveProviderLinkFromChat(repository: ResumeWorkflowRepository, actorInput: ResumeActorInput | undefined, link: string): Promise<ProviderTaskListResult & { workflow?: ResumeWorkflowRecord }> {
  const actor = resolveGlobalActor(actorInput)
  ensureTaskActor(actor)
  if (actor.role !== 'provider') {
    throw Object.assign(new Error('Only provider can add resume links from chat.'), { code: 'forbidden' })
  }
  if (!repository.getProviderResumeTasks) {
    throw new Error('Repository does not support provider resume tasks.')
  }

  const url = normalizeOptionalUrl(link)
  if (!url) {
    throw Object.assign(new Error('Resume link is required.'), { code: 'missing_provider_resume_link' })
  }

  const linkTasks = (await repository.getProviderResumeTasks())
    .filter(workflow => actorCanAccessTaskWorkflow(workflow, actor))
    .filter(workflow => providerLinkRequirement(workflow))

  if (!linkTasks.length) {
    return {
      actor,
      tasks: [],
      message: 'No provider resume task is waiting for a link right now.'
    }
  }

  if (linkTasks.length > 1) {
    return {
      actor,
      tasks: linkTasks.map(providerTaskFromWorkflow),
      message: 'More than one provider resume task is waiting for a link. Open a specific task first.',
      replyMarkup: taskListReplyMarkup(linkTasks.map(providerTaskFromWorkflow))
    }
  }

  const workflow = linkTasks[0]
  const requirement = providerLinkRequirement(workflow)!
  const updated = await repository.patchResumeWorkflow(workflow.id, {
    [requirement.field]: url,
    lastWorkflowError: '',
    workflowTrace: appendTrace(workflow, requirement.trace, actor)
  })

  return {
    actor,
    workflow: updated,
    tasks: [providerTaskFromWorkflow(updated)],
    message: [
      `${requirement.label} saved for ${updated.clientName}.`,
      '',
      providerTaskMessage(updated)
    ].join('\n'),
    replyMarkup: taskReplyMarkup(updated)
  }
}

async function saveResumeTaskInputFromChat(repository: ResumeWorkflowRepository, actorInput: ResumeActorInput | undefined, text: string): Promise<ProviderTaskListResult & { workflow?: ResumeWorkflowRecord }> {
  const actor = resolveGlobalActor(actorInput)
  if (actor.role === 'kira') return await saveKiraCommentsFromChat(repository, actorInput, text)
  if (actor.role === 'provider') return await saveProviderLinkFromChat(repository, actorInput, text)
  throw Object.assign(new Error('Only Kira or provider can add resume task data from private chat.'), { code: 'forbidden' })
}

module.exports = {
  DEFAULT_KIRA_PLATFORM_REFS,
  DEFAULT_KIRA_USER_IDS,
  DEFAULT_PROVIDER_PLATFORM_REFS,
  DEFAULT_PROVIDER_USER_IDS,
  DEFAULT_TEST_CONFIG,
  KIRA_RESPONSIBLE_STATUSES,
  PROVIDER_RESPONSIBLE_STATUSES,
  RESUME_STATUSES,
  callbackData,
  decodeCallbackStatus,
  defaultKiraNotifyChatId,
  defaultProviderNotifyChatId,
  getProviderTaskById,
  getProviderTasks,
  getResumeStatus,
  missingAdvanceFields,
  movedToFillingSummary,
  nextActionForStatus,
  publicWorkflow,
  requiredClientDataIssues,
  resetResumeWorkflowForTest,
  resolveActorForWorkflow,
  resolveGlobalActor,
  resumeWorkflowFakeDataMode,
  resumeWorkflow,
  resumeWorkflowById,
  saveKiraCommentsFromChat,
  saveProviderLinkFromChat,
  saveResumeTaskInputFromChat,
  statusInstruction,
  statusResponsibility,
  statusText
}
