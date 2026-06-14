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
  calendarEmail: string
  commonChatId: string
  primaryStack?: string
  market?: string
}

export type WebPlatformAccount = {
  id: number
  platform: string
  accountLabel: string
  login: string
  phone: string
  email: string
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
  getDolphinProfileIdsForClient(clientId: number): Promise<number[]>
  getLatestClientDashboard(options?: { fullAccess?: boolean }): Promise<ClientDashboard>
  getProviderClientByIdForStatus(clientId: number, statusLabel: string): Promise<ProviderClientRow | null>
  getProviderClientsForStatus(statusLabel: string): Promise<ProviderClientRow[]>
}
