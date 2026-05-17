const {
  mapAllClientsAutomationData,
  mapClientHHAuthCredentials,
  mapClientHHAuthCredentialsByCommonChatId
} = require('../../google-sheets-check.ts') as {
  mapAllClientsAutomationData(
    personalDataValues: string[][],
    dolphinMainValues: string[][],
    stacksValues: string[][],
    options?: AutomationTargetOptions
  ): ClientAutomationData[]
  mapClientHHAuthCredentials(
    personalDataValues: string[][],
    clientName: string,
    market?: Market
  ): ClientHHAuthCredentials
  mapClientHHAuthCredentialsByCommonChatId(
    personalDataValues: string[][],
    commonChatId: string,
    market?: Market
  ): ClientHHAuthCredentials
}
const {
  parsePersonalDataClients
} = require('../../dolphin/proxyProvider/checkRequiredProxy/logic.ts') as {
  parsePersonalDataClients(values: string[][], market: Market): ProxyRequiredClient[]
}
const {
  createGoogleSheetsLoader
} = require('./sheet-state.ts') as {
  createGoogleSheetsLoader(options?: GoogleSheetsDbOptions): {
    loadAutomationValues(): Promise<{
      personalDataValues: string[][]
      dolphinMainValues: string[][]
      stacksValues: string[][]
    }>
    loadPersonalDataValues(): Promise<string[][]>
  }
}
const {
  parseStudentTelegramRecords
} = require('./student-telegram-mapper.ts') as {
  parseStudentTelegramRecords(personalDataValues: string[][]): StudentTelegramRecord[]
}

type Market = import('../types.ts').Market
type AppDb = import('../types.ts').AppDb
type AutomationTargetOptions = import('../types.ts').AutomationTargetOptions
type ClientAutomationData = import('../types.ts').ClientAutomationData
type ClientHHAuthCredentials = import('../types.ts').ClientHHAuthCredentials
type ProxyRequiredClient = import('../types.ts').ProxyRequiredClient
type SheetState = import('../types.ts').SheetState
type StudentTelegramRecord = import('../types.ts').StudentTelegramRecord

type GoogleSheetsDbOptions = {
  sheetState?: SheetState
}

function createGoogleSheetsDb(options: GoogleSheetsDbOptions = {}): AppDb {
  const { loadAutomationValues, loadPersonalDataValues } =
    createGoogleSheetsLoader(options)

  return {
    async getAutomationTargets(
      mappingOptions: AutomationTargetOptions = {}
    ): Promise<ClientAutomationData[]> {
      const { personalDataValues, dolphinMainValues, stacksValues } =
        await loadAutomationValues()

      return mapAllClientsAutomationData(
        personalDataValues,
        dolphinMainValues,
        stacksValues,
        mappingOptions
      )
    },

    async getAutomationTargetByName(
      name: string,
      market: Market = 'Ru'
    ): Promise<ClientAutomationData> {
      const targets = await this.getAutomationTargets({ market })
      const matches = targets.filter(
        target => target.clientName === name && target.market === market
      )

      if (!matches.length) {
        throw new Error(
          `Client "${name}" on market "${market}" was not found or is not enabled`
        )
      }

      if (matches.length > 1) {
        throw new Error(
          `Client name "${name}" on market "${market}" is ambiguous. Matching chat ids: ${matches
            .map(target => target.commonChatId)
            .join(', ')}`
        )
      }

      return matches[0]
    },

    async getHHAuthCredentialsByClientName(
      name: string,
      market?: Market
    ): Promise<ClientHHAuthCredentials> {
      const personalDataValues = await loadPersonalDataValues()

      return mapClientHHAuthCredentials(personalDataValues, name, market)
    },

    async getHHAuthCredentialsByCommonChatId(
      commonChatId: string,
      market?: Market
    ): Promise<ClientHHAuthCredentials> {
      const personalDataValues = await loadPersonalDataValues()

      return mapClientHHAuthCredentialsByCommonChatId(
        personalDataValues,
        commonChatId,
        market
      )
    },

    async getStudentTelegramRecords(): Promise<StudentTelegramRecord[]> {
      return parseStudentTelegramRecords(await loadPersonalDataValues())
    },

    async getProxyRequiredClients(
      market: Market = 'En'
    ): Promise<ProxyRequiredClient[]> {
      return parsePersonalDataClients(await loadPersonalDataValues(), market)
    }
  }
}

module.exports = {
  createGoogleSheetsDb
}
