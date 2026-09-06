const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<'clients' | 'dolphinProfiles' | 'platformAccounts' | 'stacks', { id: string }>
}
const { LINKEDIN_AUTH_COLUMNS } = require('../../../integrations/noco/linkedin-auth-schema/logic.ts') as {
  LINKEDIN_AUTH_COLUMNS: ReadonlyArray<{ title: string }>
}
const { resolveLinkedInAuthTarget } = require('./noco-target.ts') as {
  resolveLinkedInAuthTarget(input: any): any
}
const { listLinkedInAuthAccounts } = require('./noco-account-list.ts') as {
  listLinkedInAuthAccounts(input: any): import('./types.ts').LinkedInAuthAccountRow[]
}
const { failurePatch, successPatch } = require('./noco-updates.ts') as {
  failurePatch(input: any): Record<string, unknown>
  successPatch(input: any): Record<string, unknown>
}
const { updateLinkedInUrl } = require('./noco-account-update.ts') as {
  updateLinkedInUrl(client: any, platformAccountId: number, value: unknown): Promise<string>
}
const { linkedInNocoError } = require('./noco-error.ts') as {
  linkedInNocoError(error: unknown): unknown
}
const { listPrimaryStacks, updatePrimaryStack } = require('./noco-stacks.ts') as {
  listPrimaryStacks(rows: any[]): Array<{ id: number; name: string }>
  updatePrimaryStack(client: any, rows: any, clientId: number, stackId: number): Promise<{ id: number; name: string }>
}
const { assertLinkedInAuthNocoSchema } = require('./noco-schema-check.ts') as {
  assertLinkedInAuthNocoSchema(client: any): Promise<void>
}
function createLinkedInAuthNocoRepository(
  client?: any,
  failureClient?: any
) {
  const injectedClient = client
  client ??= createNocoClient({ pageDelayMs: 300, retryDelaysMs: [0, 30_000, 30_000] })
  const getFailureClient = () => failureClient ??= injectedClient ?? createNocoClient({
    retryDelaysMs: [0], requestTimeoutMs: 10_000
  })
  let rowsCache: { expiresAt: number; value: any } | undefined
  let rowsRequest: Promise<any> | undefined
  let stacksCache: { expiresAt: number; value: any[] } | undefined
  let stacksRequest: Promise<any[]> | undefined
  async function fetchRows() {
    try {
      const accounts = await client.fetchRecords(TABLES.platformAccounts.id, 1000, {
        where: '(platforms_id,eq,16)'
      })
      await client.wait(300)
      const profiles = await client.fetchRecords(TABLES.dolphinProfiles.id, 1000, {
        where: '(locale,eq,En)~or(locale,eq,en)'
      })
      await client.wait(300)
      const clients = await client.fetchRecords(TABLES.clients.id, 1000)
      return { clients, accounts, profiles }
    } catch (error) {
      throw linkedInNocoError(error)
    }
  }
  async function loadStacks() {
    if (stacksCache && stacksCache.expiresAt > Date.now()) return stacksCache.value
    if (stacksRequest) return stacksRequest
    const request: Promise<any[]> = client.fetchRecords(TABLES.stacks.id, 1000)
      .catch((error: unknown) => {
      throw linkedInNocoError(error)
    })
    stacksRequest = request
    try {
      const value = await request
      stacksCache = { value, expiresAt: Date.now() + 120_000 }
      return value
    } finally {
      stacksRequest = undefined
    }
  }
  async function loadRows() {
    if (rowsCache && rowsCache.expiresAt > Date.now()) return rowsCache.value
    if (rowsRequest) return rowsRequest
    rowsRequest = fetchRows()
    try {
      const value = await rowsRequest
      rowsCache = { value, expiresAt: Date.now() + 120_000 }
      return value
    } finally {
      rowsRequest = undefined
    }
  }
  async function resolveTarget(clientName: string, platformAccountId?: number) {
    return resolveLinkedInAuthTarget({ ...(await loadRows()), clientName, platformAccountId })
  }
  async function updateAccountUrl(platformAccountId: number, value: unknown) {
    const linkedinUrl = await updateLinkedInUrl(client, platformAccountId, value)
    const account = rowsCache?.value.accounts.find((row: any) => Number(row.Id) === platformAccountId)
    if (account) {
      account.url = linkedinUrl
      account.linkedin_auth_error_code = ''
      account.linkedin_auth_updated_at = new Date().toISOString()
    }
    else rowsCache = undefined
    return linkedinUrl
  }
  return {
    assertSchema: () => assertLinkedInAuthNocoSchema(client),
    async listAccounts() { return listLinkedInAuthAccounts(await loadRows()) },
    async listStacks() { return listPrimaryStacks(await loadStacks()) },
    async updatePrimaryStack(clientId: number, stackId: number) {
      const [rows, stacks] = await Promise.all([loadRows(), loadStacks()])
      const result = await updatePrimaryStack(client, { ...rows, stacks }, clientId, stackId)
      rowsCache = undefined
      return result
    },
    resolveTarget,
    updateLinkedInUrl: updateAccountUrl,
    async recordFailure(platformAccountId: number, input: any) {
      await getFailureClient().patchRecord(
        TABLES.platformAccounts.id, platformAccountId, failurePatch(input)
      )
      rowsCache = undefined
    },
    async recordSuccess(platformAccountId: number, input: any) {
      await client.patchRecord(TABLES.platformAccounts.id, platformAccountId, successPatch(input))
      rowsCache = undefined
    },
    requiredColumns: LINKEDIN_AUTH_COLUMNS.map(column => column.title)
  }
}
module.exports = { createLinkedInAuthNocoRepository }
