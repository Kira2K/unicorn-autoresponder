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
type ResumeNotificationKind = 'common_chat' | 'private_kira' | 'private_provider' | 'linkedin_ready' | 'hh_summary'

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
  clientStack?: string
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
  chatIds?: string[]
  messageThreadId?: number
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
  offset?: number
  total?: number
}

type ResumeTaskInputOptions = {
  workflowId?: number
  expectedStatus?: string
}

type ResumeTaskInputResult = ProviderTaskListResult & {
  workflow?: ResumeWorkflowRecord
  clearActiveTask?: boolean
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
const DEFAULT_PROVIDER_PLATFORM_REFS: string[] = []
const TASK_LIST_PAGE_SIZE = 15
const TASK_LIST_MAX_MESSAGE_LENGTH = 3500

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

function defaultProviderNotifyChatIds(): string[] {
  return [
    normalizeText(process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID),
    ...envList('RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS', DEFAULT_PROVIDER_USER_IDS)
  ].map(normalizeId).filter((item, index, items) => item && items.indexOf(item) === index)
}

function linkedinReadyNotifyChatId(): string {
  return normalizeText(process.env.RESUME_WORKFLOW_LINKEDIN_READY_CHAT_ID) ||
    normalizeText(process.env.summary_logs_channel_id) ||
    normalizeText(process.env.SUMMARY_LOGS_CHANNEL_ID)
}

function linkedinReadyNotifyThreadId(): number | undefined {
  const value = Number(process.env.RESUME_WORKFLOW_LINKEDIN_READY_THREAD_ID)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
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
  if (status === 'moved to filling') return 'done'
  if (status === 'filled') return 'done'
  if (status === 'stopped') return 'admin'
  if (status.includes('Kira')) return 'kira'
  if (status.includes('student')) return 'student'
  if (status.includes('process') || status.includes('progress')) return 'provider'
  return 'student'
}

function displayResponsibility(status: string): string {
  const responsibility = statusResponsibility(status)
  if (responsibility === 'kira') return 'Кира'
  if (responsibility === 'provider') return 'подрядчик'
  if (responsibility === 'student') return 'ученик'
  if (responsibility === 'admin') return 'админ'
  if (responsibility === 'done') return 'готово'
  return responsibility
}

function displayStatus(status: string): string {
  switch (status) {
    case "collection student's data":
      return 'сбор данных ученика'
    case "collection Kira's comments":
      return 'сбор комментариев Киры'
    case 'Draft in process':
      return 'черновик в работе'
    case 'Draft in approve by Kira':
      return 'черновик на проверке у Киры'
    case 'Draft in approve by student':
      return 'черновик на согласовании у ученика'
    case 'English version in progress':
      return 'английская версия в работе'
    case 'English version in approve by Kira':
      return 'английская версия на проверке у Киры'
    case 'English version in approve by student':
      return 'английская версия на согласовании у ученика'
    case 'Russian version in process':
      return 'русская версия в работе'
    case 'Russian version in approve by Kira':
      return 'русская версия на проверке у Киры'
    case 'Russian version in approve by student':
      return 'русская версия на согласовании у ученика'
    case 'filled':
      return 'заполнено'
    case 'stopped':
      return 'остановлено'
    case 'moved to filling':
      return 'перенесено на заполнение'
    default:
      return status
  }
}

function displayMissingField(field: string): string {
  switch (field) {
    case 'Education':
      return 'образование'
    case 'English level':
      return 'уровень английского'
    case 'root_google_folder':
      return 'корневая Google-папка'
    case 'student_data_folder_url':
      return 'папка с самопрезентацией/исходными данными'
    case 'kiras_comments':
      return 'комментарии Киры'
    case 'cv_draft_url':
      return 'ссылка на черновик'
    case 'en_version_url':
      return 'ссылка на английскую версию'
    case 'ru_version_url':
      return 'ссылка на русскую версию'
    default:
      return field
  }
}

function missingActionInstruction(missing: string[]): string {
  if (missing.length === 1) {
    switch (missing[0]) {
      case 'cv_draft_url':
        return 'Отправь ссылку на черновик следующим сообщением.'
      case 'en_version_url':
        return 'Отправь ссылку на английскую версию следующим сообщением.'
      case 'ru_version_url':
        return 'Отправь ссылку на русскую версию следующим сообщением.'
      case 'kiras_comments':
        return 'Отправь комментарий Киры следующим сообщением.'
    }
  }
  return `Нужно заполнить перед обработкой: ${missing.map(displayMissingField).join(', ')}.`
}

function nextActionForStatus(status: string): string {
  switch (status) {
    case "collection student's data":
      return 'Дальше: ученик должен заполнить обязательные данные в ЛК.'
    case "collection Kira's comments":
      return 'Дальше: Кира должна добавить комментарии для подрядчика.'
    case 'Draft in process':
      return 'Дальше: подрядчик должен подготовить черновик CV.'
    case 'Draft in approve by Kira':
      return 'Дальше: Кира должна проверить черновик.'
    case 'Draft in approve by student':
      return 'Дальше: ученик должен согласовать черновик.'
    case 'English version in progress':
      return 'Дальше: подрядчик должен подготовить английскую версию.'
    case 'English version in approve by Kira':
      return 'Дальше: Кира должна проверить английскую версию.'
    case 'English version in approve by student':
      return 'Дальше: ученик должен согласовать английскую версию.'
    case 'Russian version in process':
      return 'Дальше: подрядчик должен подготовить русскую версию.'
    case 'Russian version in approve by Kira':
      return 'Дальше: Кира должна проверить русскую версию.'
    case 'Russian version in approve by student':
      return 'Дальше: ученик должен согласовать русскую версию.'
    case 'moved to filling':
      return 'Дальше: финальные версии нужно перенести на заполнение.'
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
    ? 'Черновик CV'
    : status === 'English version in approve by student'
      ? 'Английская версия CV'
      : 'Русская версия CV'
  return [
    `${label}: ${link}`,
    'Проверь файл выше.',
    'Чтобы согласовать, отправь:',
    '/resume I approve',
    'После этого я переведу резюме на следующий шаг.'
  ].join('\n')
}

function statusInstruction(record: ResumeWorkflowRecord): string {
  const status = statusText(record)
  if (status === 'moved to filling') {
    return [
      `Резюме для ${record.clientName} передано на заполнение.`,
      record.enVersionUrl ? `Английская версия: ${record.enVersionUrl}` : '',
      record.ruVersionUrl ? `Русская версия: ${record.ruVersionUrl}` : ''
    ].filter(Boolean).join('\n')
  }
  if (status === 'filled') {
    return [
      `Работа над резюме для ${record.clientName} завершена.`,
      record.enVersionUrl ? `Английская версия: ${record.enVersionUrl}` : '',
      record.ruVersionUrl ? `Русская версия: ${record.ruVersionUrl}` : ''
    ].filter(Boolean).join('\n')
  }
  if (status === 'stopped') {
    return [
      `Работа над резюме для ${record.clientName} остановлена.`,
      record.lastWorkflowError ? `Последняя ошибка: ${record.lastWorkflowError}` : 'Последняя ошибка не указана.',
      'Используй /resume_reset_test только в тестовом режиме или попроси админа повторить шаг после исправления проблемы.'
    ].join('\n')
  }
  return [
    `Статус резюме для ${record.clientName}: ${displayStatus(status)}`,
    `Ответственный: ${displayResponsibility(status)}`,
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
  return actor.role === 'kira' ? 'Киры' : 'подрядчика'
}

function ensureTaskActor(actor: ResumeActor): void {
  if (actor.role !== 'provider' && actor.role !== 'kira') {
    throw Object.assign(new Error('Открывать задачи по резюме могут только настроенные Telegram-аккаунты Киры или подрядчика.'), {
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
    throw Object.assign(new Error('Работа над резюме уже завершена.'), { code: 'resume_workflow_noop' })
  }
  if (required === 'admin') {
    throw Object.assign(new Error('Работа над резюме остановлена и требует действия админа.'), { code: 'resume_workflow_stopped' })
  }
  if (actor.role !== required) {
    throw Object.assign(
      new Error(`Этот шаг должен выполнить: ${displayResponsibility(status)}.`),
      { code: 'forbidden', requiredRole: required, actorRole: actor.role }
    )
  }
  if (required === 'provider' && !providerCanAccessWorkflow(workflow)) {
    throw Object.assign(
      new Error(`Этот аккаунт подрядчика не назначен на ${workflow.clientName}.`),
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
      new Error(`Статус резюме изменился с «${displayStatus(expected)}» на «${displayStatus(current)}». Обнови задачи и попробуй снова.`),
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
    new Error(`Перед продолжением заполни недостающие поля в ЛК: ${issues.map(displayMissingField).join(', ')}.`),
    { code: 'resume_required_data_missing', missingFields: issues }
  )
}

function normalizeOptionalUrl(value: unknown): string {
  const url = normalizeText(value)
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error('Отправь корректную ссылку на Google-папку после /resume.'), {
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
    case 'Draft in approve by Kira':
    case 'Draft in approve by student':
      return normalizeText(record.cvDraftUrl) ? [] : ['cv_draft_url']
    case 'English version in progress':
      if (fakeDataMode) return []
      return normalizeText(record.enVersionUrl) ? [] : ['en_version_url']
    case 'English version in approve by Kira':
    case 'English version in approve by student':
      return normalizeText(record.enVersionUrl) ? [] : ['en_version_url']
    case 'Russian version in process':
      if (fakeDataMode) return []
      return normalizeText(record.ruVersionUrl) ? [] : ['ru_version_url']
    case 'Russian version in approve by Kira':
    case 'Russian version in approve by student':
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

  if (status === 'filled' || status === 'stopped' || status === 'moved to filling') return null

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
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return { status: 'Draft in approve by student', lastResponsible: 'student' }
    case 'Draft in approve by student':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return { status: 'English version in progress', lastResponsible: 'provider' }
    case 'English version in progress':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return {
        status: 'English version in approve by Kira',
        enVersionUrl: valueOrFake(record.enVersionUrl, fake.englishUrl, fakeDataMode),
        lastResponsible: 'Kira'
      }
    case 'English version in approve by Kira':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return { status: 'English version in approve by student', lastResponsible: 'student' }
    case 'English version in approve by student':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return { status: 'Russian version in process', lastResponsible: 'provider' }
    case 'Russian version in process':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return {
        status: 'Russian version in approve by Kira',
        ruVersionUrl: valueOrFake(record.ruVersionUrl, fake.russianUrl, fakeDataMode),
        lastResponsible: 'Kira'
      }
    case 'Russian version in approve by Kira':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return { status: 'Russian version in approve by student', lastResponsible: 'student' }
    case 'Russian version in approve by student':
      if (missingAdvanceFields(record, fakeDataMode).length) return null
      return { status: 'moved to filling', lastResponsible: 'done' }
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

const RESUME_STATUS_CALLBACK_CODES: Record<string, string> = {
  "collection student's data": 'csd',
  "collection Kira's comments": 'ckc',
  'Draft in process': 'dip',
  'Draft in approve by Kira': 'dak',
  'Draft in approve by student': 'das',
  'English version in progress': 'evp',
  'English version in approve by Kira': 'eak',
  'English version in approve by student': 'eas',
  'Russian version in process': 'rvp',
  'Russian version in approve by Kira': 'rak',
  'Russian version in approve by student': 'ras',
  'moved to filling': 'mtf',
  stopped: 'stp',
  filled: 'fld'
}

const RESUME_STATUS_CALLBACK_STATUSES = Object.fromEntries(
  Object.entries(RESUME_STATUS_CALLBACK_CODES).map(([status, code]) => [code, status])
) as Record<string, string>

function clientLinkedInReadyLabel(record: ResumeWorkflowRecord): string {
  const stack = normalizeText(record.clientStack) || 'стек не указан'
  const market = normalizeText(record.clientMarket) || 'рынок не указан'
  return [record.clientName, stack, market].filter(Boolean).join(', ')
}

function responsibleMention(record: ResumeWorkflowRecord, responsible: ResumeActorRole | 'done' | 'admin'): string {
  if (responsible === 'kira') return 'Кира'
  if (responsible === 'provider') return 'Юля'
  return clientMention(record)
}

function notificationForNextResponsible(record: ResumeWorkflowRecord): ResumeWorkflowNotification | null {
  const status = statusText(record)
  const responsible = statusResponsibility(status)
  const mention = responsibleMention(record, responsible)
  const intro = `${mention}, резюме для ${clientMarketLabel(record)} перешло в статус «${displayStatus(status)}».`
  const action = nextActionForStatus(status)

  if (status === 'moved to filling') {
    const chatId = defaultKiraNotifyChatId()
    if (!chatId) return null
    const text = [
      `Резюме для ${clientMarketLabel(record)} передано на заполнение.`,
      record.enVersionUrl ? `Английская версия: ${record.enVersionUrl}` : undefined,
      record.ruVersionUrl ? `Русская версия: ${record.ruVersionUrl}` : undefined
    ].filter(Boolean).join('\n')
    return { kind: 'private_kira', chatId, text }
  }

  if (status === 'filled') {
    const chatId = defaultKiraNotifyChatId()
    if (!chatId) return null
    const text = [
      `Резюме для ${clientMarketLabel(record)} заполнено.`,
      record.enVersionUrl ? `Английская версия: ${record.enVersionUrl}` : undefined,
      record.ruVersionUrl ? `Русская версия: ${record.ruVersionUrl}` : undefined
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
      'Открой /open_my_tasks, чтобы обработать эту задачу.',
      '',
      providerTaskMessage(record)
    ].filter(Boolean).join('\n')
    return { kind: 'private_kira', chatId, text }
  }
  if (responsible === 'provider') {
    const chatIds = defaultProviderNotifyChatIds()
    if (!chatIds.length) return null
    const text = [
      intro,
      action,
      '',
      'Открой /open_my_tasks, чтобы обработать эту задачу.',
      '',
      providerTaskMessage(record)
    ].filter(Boolean).join('\n')
    return { kind: 'private_provider', chatId: chatIds[0], chatIds, text }
  }

  return null
}

function movedToFillingSummary(record: ResumeWorkflowRecord, testMode: boolean): ResumeWorkflowNotification | null {
  if (!testMode || statusText(record) !== 'moved to filling') return null
  return {
    kind: 'hh_summary',
    text: `Тестовый режим, ничего делать не нужно. Аккаунт ${clientMarketLabel(record)} готов к заполнению, ссылки RU: ${record.ruVersionUrl || 'n/a'}, EN: ${record.enVersionUrl || 'n/a'}. @kirasamsonova fyi`
  }
}

function linkedInReadyNotification(record: ResumeWorkflowRecord): ResumeWorkflowNotification | null {
  if (statusText(record) !== 'moved to filling') return null
  const chatId = linkedinReadyNotifyChatId()
  if (!chatId) return null
  const messageThreadId = linkedinReadyNotifyThreadId()
  const text = [
    `@CheMpoKaRokee, резюме ${clientLinkedInReadyLabel(record)}, готово к заполнению на LinkedIn.`,
    `Ссылка на резюме: ${record.enVersionUrl || 'n/a'}`
  ].join('\n')
  return { kind: 'linkedin_ready', chatId, messageThreadId, text }
}

function buildTransitionNotifications(record: ResumeWorkflowRecord, testMode: boolean): ResumeWorkflowNotification[] {
  return [
    notificationForNextResponsible(record),
    linkedInReadyNotification(record),
    movedToFillingSummary(record, testMode)
  ].filter((item): item is ResumeWorkflowNotification => Boolean(item))
}

function callbackData(action: 'open' | 'advance', workflowId: number, expectedStatus?: string): string {
  const encodedStatus = expectedStatus
    ? RESUME_STATUS_CALLBACK_CODES[normalizeText(expectedStatus)] || Buffer.from(expectedStatus, 'utf8').toString('base64url')
    : ''
  return ['resume', action, String(workflowId), encodedStatus].filter(Boolean).join(':')
}

function decodeCallbackStatus(value: string | undefined): string {
  if (!value) return ''
  const normalized = normalizeText(value)
  return RESUME_STATUS_CALLBACK_STATUSES[normalized] || Buffer.from(normalized, 'base64url').toString('utf8')
}

function providerTaskFromWorkflow(workflow: ResumeWorkflowRecord): ResumeProviderTask {
  const status = statusText(workflow)
  return {
    id: workflow.id,
    clientId: workflow.clientId,
    clientName: workflow.clientName,
    status,
    expectedStatus: status,
    message: `${workflow.clientName}: ${displayStatus(status)}`,
    callbackData: callbackData('open', workflow.id)
  }
}

function providerTaskMessage(workflow: ResumeWorkflowRecord): string {
  const missing = missingAdvanceFields(workflow)
  const explicitSourceFolder = normalizeText(workflow.studentDataFolderUrl)
  const rootGoogleFolder = normalizeText(workflow.clientGoogleFolder)
  const status = statusText(workflow)
  const inputHint = status === "collection Kira's comments"
    ? 'Следующее сообщение с комментарием сохраню именно в эту задачу.'
    : providerLinkRequirement(workflow)
      ? 'Следующее сообщение со ссылкой сохраню именно в эту задачу.'
      : undefined
  const rows = [
    `Ученик: ${workflow.clientName}`,
    workflow.clientMarket ? `Маркет: ${workflow.clientMarket}` : undefined,
    `Статус: ${displayStatus(statusText(workflow))}`,
    rootGoogleFolder ? `Корневая Google-папка: ${rootGoogleFolder}` : undefined,
    explicitSourceFolder && explicitSourceFolder !== rootGoogleFolder ? `Папка с исходными данными: ${explicitSourceFolder}` : undefined,
    workflow.kirasComments ? `Комментарии Киры: ${workflow.kirasComments}` : undefined,
    workflow.cvDraftUrl ? `Черновик: ${workflow.cvDraftUrl}` : undefined,
    workflow.enVersionUrl ? `EN: ${workflow.enVersionUrl}` : undefined,
    workflow.ruVersionUrl ? `RU: ${workflow.ruVersionUrl}` : undefined,
    missing.length ? missingActionInstruction(missing) : undefined,
    inputHint
  ].filter(Boolean)

  return rows.join('\n')
}

function missingDataInstruction(workflow: ResumeWorkflowRecord): string {
  const missing = missingAdvanceFields(workflow)
  if (statusText(workflow) === "collection student's data" && missing.includes('root_google_folder')) {
    return `@veu_support пожалуйста, добавьте корневую Google-папку ученика ${workflow.clientName} в Noco: clients.google_folder`
  }
  if (statusText(workflow) === "collection student's data" && missing.includes('student_data_folder_url')) {
    const rootFolder = normalizeText(workflow.clientGoogleFolder)
    return [
      'Добавь самопрезентацию и файлы резюме/исходные материалы в правильную Google-папку.',
      rootFolder ? `Основная/корневая Google-папка: ${rootFolder}` : undefined,
      'Затем отправь /resume <ссылка на папку с самопрезентацией/исходными данными>.'
    ].filter(Boolean).join('\n')
  }
  if (missing.length) {
    return missingActionInstruction(missing)
  }
  return 'Статус пока не изменился. Добавь нужные данные в админке Noco, затем запусти команду снова.'
}

function taskReplyMarkup(workflow: ResumeWorkflowRecord) {
  const status = statusText(workflow)
  const buttons: Array<Array<{ text: string; callback_data: string }>> = []
  if (!missingAdvanceFields(workflow).length) {
    buttons.push([
      {
        text: 'Перейти к следующему шагу',
        callback_data: callbackData('advance', workflow.id, status)
      }
    ])
  }
  buttons.push([
    {
      text: 'Назад к задачам',
      callback_data: 'resume:tasks'
    }
  ])
  return {
    inline_keyboard: buttons
  }
}

function compactTaskAction(workflow: ResumeWorkflowRecord): string {
  const missing = missingAdvanceFields(workflow)
  if (missing.includes('cv_draft_url')) return 'отправь ссылку на черновик'
  if (missing.includes('en_version_url')) return 'отправь ссылку на EN'
  if (missing.includes('ru_version_url')) return 'отправь ссылку на RU'
  if (missing.includes('kiras_comments')) return 'добавь комментарий Киры'
  if (missing.length) return 'открой задачу'
  return 'готово к следующему шагу'
}

function compactTaskLine(workflow: ResumeWorkflowRecord, index: number): string {
  const market = normalizeText(workflow.clientMarket)
  const marketLabel = market ? ` [${market}]` : ''
  return `${index}. ${workflow.clientName}${marketLabel} - ${displayStatus(statusText(workflow))}; ${compactTaskAction(workflow)}`
}

function taskListOffset(value: unknown, total: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  if (parsed >= total) return Math.max(0, total - TASK_LIST_PAGE_SIZE)
  return Math.floor(parsed / TASK_LIST_PAGE_SIZE) * TASK_LIST_PAGE_SIZE
}

function compactTaskListPage(workflows: ResumeWorkflowRecord[], requestedOffset = 0): {
  offset: number
  visibleWorkflows: ResumeWorkflowRecord[]
  message: string
} {
  const offset = taskListOffset(requestedOffset, workflows.length)
  let visibleCount = Math.min(TASK_LIST_PAGE_SIZE, workflows.length - offset)
  let visibleWorkflows = workflows.slice(offset, offset + visibleCount)
  let rows = visibleWorkflows.map((workflow, index) => compactTaskLine(workflow, offset + index + 1))
  let message = rows.join('\n')

  while (message.length > TASK_LIST_MAX_MESSAGE_LENGTH && visibleCount > 1) {
    visibleCount -= 1
    visibleWorkflows = workflows.slice(offset, offset + visibleCount)
    rows = visibleWorkflows.map((workflow, index) => compactTaskLine(workflow, offset + index + 1))
    message = rows.join('\n')
  }

  return { offset, visibleWorkflows, message }
}

function taskListMessage(title: string, workflows: ResumeWorkflowRecord[], requestedOffset = 0): {
  offset: number
  visibleWorkflows: ResumeWorkflowRecord[]
  message: string
} {
  const page = compactTaskListPage(workflows, requestedOffset)
  const from = workflows.length ? page.offset + 1 : 0
  const to = page.offset + page.visibleWorkflows.length
  return {
    ...page,
    message: [
      `Задачи ${title} по резюме: ${from}-${to} из ${workflows.length}`,
      '',
      page.message
    ].filter(Boolean).join('\n')
  }
}

function taskListReplyMarkup(tasks: ResumeProviderTask[], offset = 0, total = tasks.length) {
  const inline_keyboard = tasks.map(task => ([
    {
      text: task.message.slice(0, 60),
      callback_data: task.callbackData
    }
  ]))
  const navigation: Array<{ text: string; callback_data: string }> = []
  if (offset > 0) {
    navigation.push({
      text: '← Назад',
      callback_data: `resume:tasks:${Math.max(0, offset - TASK_LIST_PAGE_SIZE)}`
    })
  }
  if (offset + tasks.length < total) {
    navigation.push({
      text: 'Вперед →',
      callback_data: `resume:tasks:${offset + tasks.length}`
    })
  }
  if (navigation.length) inline_keyboard.push(navigation)
  return { inline_keyboard }
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
        'Для этого Telegram-чата ученик не найден.',
        '',
        `ID чата: ${chatId}`,
        'Привяжи этот ID чата к ученику в админке NocoDB.'
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
        'Для этого Telegram-чата ученик не найден.',
        '',
        `ID чата: ${chatId}`,
        'Привяжи этот ID чата к ученику в админке NocoDB.'
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
      message: 'Workflow резюме не найден.'
    }
  }
  return await advanceWorkflow(workflow, repository, options)
}

async function resetResumeWorkflowForTest(chatId: string, repository: ResumeWorkflowRepository): Promise<ResumeWorkflowResult> {
  const testMode = resumeWorkflowTestMode()
  if (!testMode) {
    throw Object.assign(new Error('/resume_reset_test доступна только при RESUME_WORKFLOW_TEST_MODE=true.'), {
      code: 'resume_reset_test_disabled'
    })
  }
  const workflow = await repository.getResumeWorkflowByTelegramChatId(chatId, { ensure: true })
  if (!workflow) {
    return {
      found: false,
      chatId,
      testMode,
      message: 'Для этого Telegram-чата ученик не найден.'
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
    message: `Тестовый workflow резюме для ${reset.clientName} сброшен.`
  }
}

async function getProviderTasks(
  repository: ResumeWorkflowRepository,
  actorInput?: ResumeActorInput,
  options: { offset?: number } = {}
): Promise<ProviderTaskListResult> {
  const actor = resolveGlobalActor(actorInput)
  ensureTaskActor(actor)
  if (!repository.getProviderResumeTasks) {
    throw new Error('Repository does not support provider resume tasks.')
  }

  const workflows = (await repository.getProviderResumeTasks())
    .filter(workflow => actorCanAccessTaskWorkflow(workflow, actor))
  const title = taskActorTitle(actor)
  const page = taskListMessage(title, workflows, options.offset)
  const tasks = page.visibleWorkflows.map(providerTaskFromWorkflow)

  return {
    actor,
    tasks,
    offset: page.offset,
    total: workflows.length,
    message: tasks.length
      ? page.message
      : `Сейчас нет ожидающих задач ${title} по резюме.`,
    replyMarkup: tasks.length ? taskListReplyMarkup(tasks, page.offset, workflows.length) : undefined
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
      message: 'Эта задача по резюме больше недоступна. Обнови список задач.'
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

async function saveKiraCommentsFromChat(
  repository: ResumeWorkflowRepository,
  actorInput: ResumeActorInput | undefined,
  comments: string,
  options: ResumeTaskInputOptions = {}
): Promise<ResumeTaskInputResult> {
  const actor = resolveGlobalActor(actorInput)
  ensureTaskActor(actor)
  if (actor.role !== 'kira') {
    throw Object.assign(new Error('Добавлять комментарии Киры из чата может только Кира.'), { code: 'forbidden' })
  }
  if (!repository.getProviderResumeTasks) {
    throw new Error('Repository does not support provider resume tasks.')
  }

  const text = normalizeText(comments)
  if (!text) {
    throw Object.assign(new Error('Нужно отправить текст комментария Киры.'), { code: 'missing_kira_comments' })
  }

  if (options.workflowId) {
    if (!repository.getResumeWorkflowById) {
      throw new Error('Repository does not support resume workflow lookup by id.')
    }
    const workflow = await repository.getResumeWorkflowById(options.workflowId)
    if (!workflow || !actorCanAccessTaskWorkflow(workflow, actor)) {
      return {
        actor,
        tasks: [],
        clearActiveTask: true,
        message: 'Эта задача по резюме больше недоступна. Обнови список задач и открой нужную задачу снова.'
      }
    }
    const currentStatus = statusText(workflow)
    const expectedStatus = normalizeText(options.expectedStatus)
    if (expectedStatus && currentStatus !== expectedStatus) {
      return {
        actor,
        workflow,
        tasks: [providerTaskFromWorkflow(workflow)],
        clearActiveTask: true,
        message: `Статус резюме изменился с «${displayStatus(expectedStatus)}» на «${displayStatus(currentStatus)}». Обнови задачи и открой нужную задачу снова.`
      }
    }
    if (currentStatus !== "collection Kira's comments") {
      return {
        actor,
        workflow,
        tasks: [providerTaskFromWorkflow(workflow)],
        clearActiveTask: true,
        message: 'Эта задача больше не ожидает комментарий Киры. Обнови задачи и открой нужную задачу снова.'
      }
    }
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
        `Комментарии Киры для ${updated.clientName} сохранены.`,
        'Комментарий сохранен в задаче. Чтобы передать её дальше, нажми кнопку «Перейти к следующему шагу».',
        '',
        providerTaskMessage(updated)
      ].join('\n'),
      replyMarkup: taskReplyMarkup(updated)
    }
  }

  const commentTasks = (await repository.getProviderResumeTasks())
    .filter(workflow => actorCanAccessTaskWorkflow(workflow, actor))
    .filter(workflow => statusText(workflow) === "collection Kira's comments")

  if (!commentTasks.length) {
    return {
      actor,
      tasks: [],
      message: 'Сейчас нет задачи Киры, которая ожидает комментарий.'
    }
  }

  if (commentTasks.length > 1) {
    return {
      actor,
      tasks: commentTasks.map(providerTaskFromWorkflow),
      message: 'Сейчас несколько задач Киры ожидают комментарий. Сначала открой конкретную задачу.',
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
      `Комментарии Киры для ${updated.clientName} сохранены.`,
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
      return { field: 'cvDraftUrl', label: 'Ссылка на черновик', trace: 'CV draft link saved from Telegram chat' }
    case 'English version in progress':
      return { field: 'enVersionUrl', label: 'Ссылка на английскую версию', trace: 'English version link saved from Telegram chat' }
    case 'Russian version in process':
      return { field: 'ruVersionUrl', label: 'Ссылка на русскую версию', trace: 'Russian version link saved from Telegram chat' }
    default:
      return null
  }
}

async function saveProviderLinkToWorkflow(
  repository: ResumeWorkflowRepository,
  actor: ResumeActor,
  workflow: ResumeWorkflowRecord,
  url: string,
  expectedStatus = ''
): Promise<ResumeTaskInputResult> {
  const currentStatus = statusText(workflow)
  if (expectedStatus && currentStatus !== expectedStatus) {
    return {
      actor,
      workflow,
      tasks: [providerTaskFromWorkflow(workflow)],
      clearActiveTask: true,
      message: `Статус резюме изменился с «${displayStatus(expectedStatus)}» на «${displayStatus(currentStatus)}». Обнови задачи и открой нужную задачу снова.`
    }
  }

  const requirement = providerLinkRequirement(workflow)
  if (!requirement) {
    return {
      actor,
      workflow,
      tasks: [providerTaskFromWorkflow(workflow)],
      clearActiveTask: true,
      message: 'Эта задача больше не ожидает ссылку от подрядчика. Обнови задачи и открой нужную задачу снова.'
    }
  }

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
      `${requirement.label} для ${updated.clientName} сохранена.`,
      'Ссылка сохранена в задаче. Чтобы передать её дальше, нажми кнопку «Перейти к следующему шагу».',
      '',
      providerTaskMessage(updated)
    ].join('\n'),
    replyMarkup: taskReplyMarkup(updated)
  }
}

async function saveProviderLinkFromChat(
  repository: ResumeWorkflowRepository,
  actorInput: ResumeActorInput | undefined,
  link: string,
  options: { workflowId?: number; expectedStatus?: string } = {}
): Promise<ResumeTaskInputResult> {
  const actor = resolveGlobalActor(actorInput)
  ensureTaskActor(actor)
  if (actor.role !== 'provider') {
    throw Object.assign(new Error('Добавлять ссылки на резюме из чата может только подрядчик.'), { code: 'forbidden' })
  }
  if (!repository.getProviderResumeTasks) {
    throw new Error('Repository does not support provider resume tasks.')
  }

  const url = normalizeOptionalUrl(link)
  if (!url) {
    throw Object.assign(new Error('Нужно отправить ссылку на резюме.'), { code: 'missing_provider_resume_link' })
  }

  if (options.workflowId) {
    if (!repository.getResumeWorkflowById) {
      throw new Error('Repository does not support resume workflow lookup by id.')
    }
    const workflow = await repository.getResumeWorkflowById(options.workflowId)
    if (!workflow || !actorCanAccessTaskWorkflow(workflow, actor)) {
      return {
        actor,
        tasks: [],
        clearActiveTask: true,
        message: 'Эта задача по резюме больше недоступна. Обнови список задач и открой нужную задачу снова.'
      }
    }
    return await saveProviderLinkToWorkflow(repository, actor, workflow, url, normalizeText(options.expectedStatus))
  }

  const linkTasks = (await repository.getProviderResumeTasks())
    .filter(workflow => actorCanAccessTaskWorkflow(workflow, actor))
    .filter(workflow => providerLinkRequirement(workflow))

  if (!linkTasks.length) {
    return {
      actor,
      tasks: [],
      message: 'Сейчас нет задачи подрядчика, которая ожидает ссылку.'
    }
  }

  if (linkTasks.length > 1) {
    return {
      actor,
      tasks: linkTasks.map(providerTaskFromWorkflow),
      message: 'Сейчас несколько задач подрядчика ожидают ссылку. Сначала открой конкретную задачу.',
      replyMarkup: taskListReplyMarkup(linkTasks.map(providerTaskFromWorkflow))
    }
  }

  return await saveProviderLinkToWorkflow(repository, actor, linkTasks[0], url)
}

async function saveResumeTaskInputFromChat(
  repository: ResumeWorkflowRepository,
  actorInput: ResumeActorInput | undefined,
  text: string,
  options: ResumeTaskInputOptions = {}
): Promise<ResumeTaskInputResult> {
  const actor = resolveGlobalActor(actorInput)
  if (actor.role === 'kira') return await saveKiraCommentsFromChat(repository, actorInput, text, options)
  if (actor.role === 'provider') return await saveProviderLinkFromChat(repository, actorInput, text, options)
  throw Object.assign(new Error('Добавлять данные по задачам резюме из личного чата могут только Кира или подрядчик.'), { code: 'forbidden' })
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
