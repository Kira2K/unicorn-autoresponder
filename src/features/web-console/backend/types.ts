export type UserRole = 'client' | 'provider' | 'admin'

export type WebSession = {
  id: string
  role: UserRole
  email: string
  clientId?: number
}

export type WebClient = {
  id: number
  clientName: string
  firstName: string
  lastName: string
  fio: string
  birthDate: string
  education: string
  realAge?: number
  stopListCompany: string
  calendarEmail: string
  googleFolder: string
  telegramPersonalChatId: string
  commonChatId: string
  primaryStack?: string
  market?: string
  clientStatus?: string
  clientStatusNote?: string
  resumeStatus?: string
  linkedInStatus?: string
  englishLevelId?: number
  englishLevel?: string
  mentors?: string[]
}

export type WebPlatformAccount = {
  id: number
  clientId?: number
  platform: string
  platformId?: number
  isTelegramAccount: boolean
  accountLabel: string
  login: string
  phone: string
  email: string
  nickname?: string
  linkedInUrl?: string
  foreignNumber?: string
  recoveryCodes?: string
  password?: string
  emailPassword?: string
  telegramSessionStatus?: string
  telegramTdlibDbPath?: string
  telegramLastActive?: string
  telegramEventLog?: string
}

export type WebOption = {
  id: number
  label: string
}

export type ClientProfilePatch = {
  firstName?: string
  lastName?: string
  fio?: string
  birthDate?: string
  education?: string
  realAge?: number | string | null
  stopListCompany?: string
  englishLevelId?: number | null
  telegramPersonalChatId?: string
  calendarEmail?: string
}

export type PlatformAccountInput = {
  platformId?: number | null
  platform?: string
  accountLabel?: string
  login?: string
  phone?: string
  email?: string
  nickname?: string
  linkedInUrl?: string
  foreignNumber?: string
  recoveryCodes?: string
  password?: string
  emailPassword?: string
}

export type ClientDashboard = {
  client: WebClient
  platformAccounts: WebPlatformAccount[]
  linkedInEmail: string
}

export type DolphinProfileStatus = {
  targetClientId: number
  targetClientName: string
  actorRole: 'client' | 'admin' | 'provider'
  action: 'blocked' | 'create_new' | 'open_existing'
  existingProfiles: Array<{ id: number; locale: string }>
  requiredLocales: Array<'ru' | 'en'>
  missingLocales: Array<'ru' | 'en'>
  expectedProfileNames: Array<{ locale: 'ru' | 'en'; name: string }>
  expectedProxyName: string
  requiredFields: Array<{ field: string; fieldLabel: string; message: string }>
}

export type ProviderClientRow = {
  id: number
  clientName: string
  primaryStack?: string
  market?: string
  linkedInEmail: string
  dolphinProfileStatus: DolphinProfileStatus
  hhCredentials: Array<{
    market: 'Ru' | 'En'
    required: boolean
    status: 'ready' | 'not_required' | 'missing_account' | 'missing_email' | 'missing_password' | 'incomplete'
    email: string
    password: string
  }>
  providerResponses?: Array<{
    id: number
    comment: string
    respondRu: boolean
    respondEn: boolean
    salaryExpectations?: number
    mainCv: string
    additionalCv: string
    fields: Array<{ label: string; value: string; kind?: 'boolean' | 'url' | 'number' | 'text' }>
  }>
}

export type AdminTelegramSender = {
  clientId: number
  clientName: string
  market?: string
  stack?: string
  accountId: number
  accountLabel: string
  platform: string
  phone: string
  status: string
  dbPath: string
}

export type ResumeWorkflowPatch = Partial<{
  status: string
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

export type ResumeWorkflowRecord = {
  id: number
  clientId: number
  clientName: string
  clientMarket?: string
  clientStack?: string
  clientTelegramUsername?: string
  clientTelegramRu?: string
  clientTelegramEn?: string
  clientPhoneRu?: string
  clientPhoneEn?: string
  clientGoogleFolder?: string
  commonChatId?: string
  education?: string
  realAge?: number
  englishLevel?: string
  englishLevelId?: number
  status: string
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

export type WebConsoleRepository = {
  findClientByCalendarEmail(email: string): Promise<WebClient | null>
  getAllDolphinProfileIds(): Promise<number[]>
  getClientDashboard(clientId: number, options?: { fullAccess?: boolean }): Promise<ClientDashboard>
  getClientById(clientId: number): Promise<WebClient>
  getDolphinProfileIdsForClient(clientId: number): Promise<number[]>
  getDolphinProfilesForClient(clientId: number): Promise<Array<{ id: number; locale: string }>>
  getLatestClientDashboard(options?: { fullAccess?: boolean }): Promise<ClientDashboard>
  findClientByTelegramChatId(chatId: string): Promise<WebClient | null>
  updateGoogleFolderByTelegramChatId(chatId: string, googleFolder: string): Promise<WebClient | null>
  getResumeWorkflowByTelegramChatId(chatId: string, options?: { ensure?: boolean }): Promise<ResumeWorkflowRecord | null>
  getResumeWorkflowById(workflowId: number): Promise<ResumeWorkflowRecord | null>
  getProviderResumeTasks(): Promise<ResumeWorkflowRecord[]>
  patchResumeWorkflow(recordId: number, patch: ResumeWorkflowPatch): Promise<ResumeWorkflowRecord>
  getProviderClientByIdForStatus(clientId: number, statusLabel: string): Promise<ProviderClientRow | null>
  getProviderClientsForStatus(statusLabel: string): Promise<ProviderClientRow[]>
  listEnglishLevels(): Promise<WebOption[]>
  listPlatforms(): Promise<WebOption[]>
  updateClientProfile(clientId: number, patch: ClientProfilePatch): Promise<ClientDashboard>
  createPlatformAccount(clientId: number, input: PlatformAccountInput): Promise<ClientDashboard>
  updatePlatformAccount(clientId: number, accountId: number, input: PlatformAccountInput): Promise<ClientDashboard>
  deletePlatformAccount(clientId: number, accountId: number): Promise<ClientDashboard>
  getTelegramPlatformAccountsForClient(clientId: number): Promise<WebPlatformAccount[]>
  listActiveTelegramSenders(): Promise<AdminTelegramSender[]>
  updateTelegramPlatformAccount(clientId: number, accountId: number, patch: Record<string, unknown>): Promise<WebPlatformAccount>
  createDolphinProfileBinding(input: {
    clientId: number
    clientName: string
    locale: 'ru' | 'en'
    dolphinProfileId: number
  }): Promise<unknown>
}
