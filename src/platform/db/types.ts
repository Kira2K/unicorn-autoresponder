export type Market = 'Ru' | 'En'

export type SheetValues = {
  title: string
  values: string[][]
}

export type SheetState = {
  spreadsheet?: {
    id: string
    name: string
  }
  spreadsheetTitle?: string
  sheets: SheetValues[]
}

export type AutomationTargetOptions = {
  workWithRuOnly?: boolean
  market?: Market
  clientNames?: string[]
}

export type ClientAutomationData = {
  clientName: string
  stack: string
  market: Market
  stackSheetName: string
  stackScenario?: string
  dolphinProfileId: number
  commonChatId: string
  coverText?: string
  blockedCompanies?: Array<{ id: string; name: string }>
}

export type ClientHHAuthCredentials = {
  clientName: string
  commonChatId?: string
  market?: Market
  phone: string
  rawPhone: string
  password: string
  email: string
  emailPassword?: string
}

export type StudentTelegramRecord = {
  commonChatId: string
  market: string
  name: string
  telegram: string
  normalizedTelegram: string
}

export type ProxyRequiredClient = {
  columnIndex: number
  firstName: string
  secondName: string
  sheetMarket: string
  stack: string
  chatId: string
  profileId: string
  sheetProxyName: string
}

export type AppDb = {
  getAutomationTargets(options?: AutomationTargetOptions): Promise<ClientAutomationData[]>
  getAutomationTargetByName(
    name: string,
    market?: Market
  ): Promise<ClientAutomationData>
  getHHAuthCredentialsByClientName(
    name: string,
    market?: Market
  ): Promise<ClientHHAuthCredentials>
  getHHAuthCredentialsByCommonChatId(
    commonChatId: string,
    market?: Market
  ): Promise<ClientHHAuthCredentials>
  getStudentTelegramRecords(): Promise<StudentTelegramRecord[]>
  getProxyRequiredClients(market?: Market): Promise<ProxyRequiredClient[]>
}
