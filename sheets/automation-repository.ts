const {
  DOLPHIN_MAIN_SHEET_NAME,
  PERSONAL_DATA_SHEET_NAME,
  STACKS_SHEET_NAME,
  fetchNamedSheetValues,
  getRequiredSheet,
  mapAllClientsAutomationData,
  mapClientAutomationData,
  mapClientHHAuthCredentials,
  mapClientHHAuthCredentialsByCommonChatId
} = require('../google-sheets-check.ts')

type AutomationMappingOptions = {
  workWithRuOnly?: boolean
  market?: 'Ru' | 'En'
}

type ClientAutomationRepository = {
  getAllAutomationTargets(options?: AutomationMappingOptions): any[]
  getAutomationTarget(clientName: string, market?: 'Ru' | 'En'): any
  getHHAuthCredentials(clientName: string, market?: 'Ru' | 'En'): any
  getHHAuthCredentialsByCommonChatId(
    commonChatId: string,
    market?: 'Ru' | 'En'
  ): any
}

async function createClientAutomationRepository(): Promise<ClientAutomationRepository> {
  const result = await fetchNamedSheetValues([
    PERSONAL_DATA_SHEET_NAME,
    DOLPHIN_MAIN_SHEET_NAME,
    STACKS_SHEET_NAME
  ])
  const personalDataValues = getRequiredSheet(
    result.sheets,
    PERSONAL_DATA_SHEET_NAME
  )
  const dolphinMainValues = getRequiredSheet(
    result.sheets,
    DOLPHIN_MAIN_SHEET_NAME
  )
  const stacksValues = getRequiredSheet(result.sheets, STACKS_SHEET_NAME)

  return {
    getAllAutomationTargets(options: AutomationMappingOptions = {}) {
      return mapAllClientsAutomationData(
        personalDataValues,
        dolphinMainValues,
        stacksValues,
        options
      )
    },
    getAutomationTarget(clientName: string, market: 'Ru' | 'En' = 'Ru') {
      const matches = mapAllClientsAutomationData(
        personalDataValues,
        dolphinMainValues,
        stacksValues,
        {
          market
        }
      ).filter((client: any) => {
        return client.clientName === clientName && client.market === market
      })

      if (!matches.length) {
        throw new Error(
          `Client "${clientName}" on market "${market}" was not found or is not enabled`
        )
      }

      if (matches.length > 1) {
        throw new Error(
          `Client name "${clientName}" on market "${market}" is ambiguous. Matching chat ids: ${matches
            .map((client: any) => client.commonChatId)
            .join(', ')}`
        )
      }

      return matches[0]
    },
    getHHAuthCredentials(clientName: string, market: 'Ru' | 'En' = 'Ru') {
      const matches = mapAllClientsAutomationData(
        personalDataValues,
        dolphinMainValues,
        stacksValues,
        { market }
      ).filter((client: any) => client.clientName === clientName)

      if (!matches.length) {
        return mapClientHHAuthCredentials(personalDataValues, clientName, market)
      }

      if (matches.length > 1) {
        throw new Error(
          `Client name "${clientName}" is ambiguous. Matching chat ids: ${matches
            .map((client: any) => client.commonChatId)
            .join(', ')}`
        )
      }

      return mapClientHHAuthCredentialsByCommonChatId(
        personalDataValues,
        matches[0].commonChatId,
        market
      )
    },
    getHHAuthCredentialsByCommonChatId(
      commonChatId: string,
      market: 'Ru' | 'En' = 'Ru'
    ) {
      return mapClientHHAuthCredentialsByCommonChatId(
        personalDataValues,
        commonChatId,
        market
      )
    }
  }
}

module.exports = {
  createClientAutomationRepository
}
