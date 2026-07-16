const { ORCHESTRATOR_WORK_WITH_MARKET } = require('./config.ts')
const { attachBlockedCompanies } = require('./blocked-companies.ts') as {
  attachBlockedCompanies(clients: ClientAutomationData[]): ClientAutomationData[]
}

type AutomationTargetOptions = import('./types.ts').AutomationTargetOptions
type ClientAutomationData = import('./types.ts').ClientAutomationData
type ClientHHAuthCredentials = import('./types.ts').ClientHHAuthCredentials

type CredentialAttachFailure = {
  client: ClientAutomationData
  error: unknown
}

type BestEffortCredentialAttachResult = {
  clients: ClientAutomationData[]
  skipped: CredentialAttachFailure[]
}

function getConfiguredClientNames(): string[] {
  return parseCommaSeparatedEnv(process.env.ORCHESTRATOR_CLIENT_NAMES)
}

function getConfiguredClientIds(): string[] {
  return parseCommaSeparatedEnv(process.env.ORCHESTRATOR_CLIENT_IDS)
}

function getConfiguredExcludedClientNames(): string[] {
  return parseCommaSeparatedEnv(process.env.ORCHESTRATOR_EXCLUDE_CLIENT_NAMES)
}

function getConfiguredExcludedClientIds(): string[] {
  return parseCommaSeparatedEnv(process.env.ORCHESTRATOR_EXCLUDE_CLIENT_IDS)
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

async function attachHHAuthCredentialsBestEffort(
  clients: ClientAutomationData[],
  repository: {
    getHHAuthCredentialsByCommonChatId(
      commonChatId: string,
      market?: 'Ru' | 'En'
    ): Promise<ClientHHAuthCredentials>
  }
): Promise<BestEffortCredentialAttachResult> {
  const settled = await Promise.allSettled(
    clients.map(async client => ({
      ...client,
      hhAuthCredentials: await repository.getHHAuthCredentialsByCommonChatId(
        client.commonChatId,
        client.market
      )
    }))
  )
  const attachedClients: ClientAutomationData[] = []
  const skipped: CredentialAttachFailure[] = []

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      attachedClients.push(result.value)
      return
    }

    skipped.push({
      client: clients[index],
      error: result.reason
    })
  })

  return {
    clients: attachedClients,
    skipped
  }
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

function excludeClients(
  clients: ClientAutomationData[],
  options: {
    clientNames?: string[]
    clientIds?: string[]
  }
): {
  clients: ClientAutomationData[]
  excluded: ClientAutomationData[]
} {
  const excludedNames = new Set(options.clientNames ?? [])
  const excludedIds = new Set(options.clientIds ?? [])
  const keptClients: ClientAutomationData[] = []
  const excludedClients: ClientAutomationData[] = []

  for (const client of clients) {
    if (
      excludedNames.has(client.clientName) ||
      excludedIds.has(client.commonChatId)
    ) {
      excludedClients.push(client)
      continue
    }

    keptClients.push(client)
  }

  return {
    clients: keptClients,
    excluded: excludedClients
  }
}

function applyConfiguredClientExclusions(
  clients: ClientAutomationData[]
): {
  clients: ClientAutomationData[]
  excluded: ClientAutomationData[]
  excludedNames: string[]
  excludedIds: string[]
} {
  const excludedNames = getConfiguredExcludedClientNames()
  const excludedIds = getConfiguredExcludedClientIds()
  const result = excludeClients(clients, {
    clientNames: excludedNames,
    clientIds: excludedIds
  })

  return {
    ...result,
    excludedNames,
    excludedIds
  }
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
  attachHHAuthCredentialsBestEffort,
  getConfiguredAutomationTargetOptions,
  getConfiguredClientIds,
  getConfiguredClientNames,
  getConfiguredExcludedClientIds,
  getConfiguredExcludedClientNames,
  excludeClients,
  applyConfiguredClientExclusions,
  attachBlockedCompanies,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames
}
