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
  calendarEmail: string
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
  platform: string
  platformId?: number
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

export type ProviderClientRow = {
  id: number
  clientName: string
  primaryStack?: string
  linkedInEmail: string
}

export type WebConsoleRepository = {
  findClientByCalendarEmail(email: string): Promise<WebClient | null>
  getAllDolphinProfileIds(): Promise<number[]>
  getClientDashboard(clientId: number, options?: { fullAccess?: boolean }): Promise<ClientDashboard>
  getClientById(clientId: number): Promise<WebClient>
  getDolphinProfileIdsForClient(clientId: number): Promise<number[]>
  getDolphinProfilesForClient(clientId: number): Promise<Array<{ id: number; locale: string }>>
  getLatestClientDashboard(options?: { fullAccess?: boolean }): Promise<ClientDashboard>
  getProviderClientByIdForStatus(clientId: number, statusLabel: string): Promise<ProviderClientRow | null>
  getProviderClientsForStatus(statusLabel: string): Promise<ProviderClientRow[]>
  listEnglishLevels(): Promise<WebOption[]>
  listPlatforms(): Promise<WebOption[]>
  updateClientProfile(clientId: number, patch: ClientProfilePatch): Promise<ClientDashboard>
  createPlatformAccount(clientId: number, input: PlatformAccountInput): Promise<ClientDashboard>
  updatePlatformAccount(clientId: number, accountId: number, input: PlatformAccountInput): Promise<ClientDashboard>
  deletePlatformAccount(clientId: number, accountId: number): Promise<ClientDashboard>
  createDolphinProfileBinding(input: {
    clientId: number
    clientName: string
    locale: 'ru' | 'en'
    dolphinProfileId: number
  }): Promise<unknown>
}
