const { ORCHESTRATOR_WORK_WITH_MARKET } = require('./config.ts')

type AutomationTargetOptions = import('./types.ts').AutomationTargetOptions
type ClientAutomationData = import('./types.ts').ClientAutomationData
type ClientHHAuthCredentials = import('./types.ts').ClientHHAuthCredentials

function getConfiguredClientNames(): string[] {
  return parseCommaSeparatedEnv(process.env.ORCHESTRATOR_CLIENT_NAMES)
}

function getConfiguredClientIds(): string[] {
  return parseCommaSeparatedEnv(process.env.ORCHESTRATOR_CLIENT_IDS)
}

function getConfiguredAutomationTargetOptions(): AutomationTargetOptions {
  return {
    market: ORCHESTRATOR_WORK_WITH_MARKET
  }
}

function parseCommaSeparatedEnv(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

async function attachHHAuthCredentials(
  clients: ClientAutomationData[],
  repository: {
    getHHAuthCredentialsByCommonChatId(
      commonChatId: string,
      market?: 'Ru' | 'En'
    ): Promise<ClientHHAuthCredentials>
  }
): Promise<ClientAutomationData[]> {
  return await Promise.all(
    clients.map(async client => ({
      ...client,
      hhAuthCredentials: await repository.getHHAuthCredentialsByCommonChatId(
        client.commonChatId,
        client.market
      )
    }))
  )
}

function selectClientsByCommonChatIds(
  allClients: ClientAutomationData[],
  clientIds: string[]
): ClientAutomationData[] {
  const selectedClients = allClients.filter(client =>
    clientIds.includes(client.commonChatId)
  )
  const selectedIds = new Set(
    selectedClients.map(client => client.commonChatId)
  )
  const missingIds = clientIds.filter(id => !selectedIds.has(id))

  if (missingIds.length) {
    throw new Error(
      `Selected client ids were not found or are not enabled: ${missingIds.join(', ')}`
    )
  }

  return selectedClients
}

function selectClientsByUniqueNames(
  allClients: ClientAutomationData[],
  clientNames: string[]
): ClientAutomationData[] {
  const selectedClients: ClientAutomationData[] = []

  for (const clientName of clientNames) {
    const matches = allClients.filter(client => client.clientName === clientName)

    if (!matches.length) {
      throw new Error(
        `Selected clients were not found or are not enabled: ${clientName}`
      )
    }

    if (matches.length > 1) {
      throw new Error(
        `Client name "${clientName}" is ambiguous. Matching chat ids: ${matches
          .map(client => client.commonChatId)
          .join(', ')}`
      )
    }

    selectedClients.push(matches[0])
  }

  return selectedClients
}

module.exports = {
  attachHHAuthCredentials,
  getConfiguredAutomationTargetOptions,
  getConfiguredClientIds,
  getConfiguredClientNames,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames
}
