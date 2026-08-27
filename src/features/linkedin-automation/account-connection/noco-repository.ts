const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<'clients' | 'dolphinProfiles' | 'platformAccounts', { id: string }>
}
const { LINKEDIN_AUTH_COLUMNS, inspectLinkedInAuthSchema } = require('../../../integrations/noco/linkedin-auth-schema/logic.ts') as {
  LINKEDIN_AUTH_COLUMNS: ReadonlyArray<{ title: string }>
  inspectLinkedInAuthSchema(meta: any): { ok: boolean; missing: string[] }
}
const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
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
function createLinkedInAuthNocoRepository(client = createNocoClient({ pageDelayMs: 300, retryDelaysMs: [0, 30_000, 30_000] })) {
  let rowsCache: { expiresAt: number; value: any } | undefined
  let rowsRequest: Promise<any> | undefined
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
  async function assertSchema(): Promise<void> {
    let meta
    try { meta = await client.fetchTableMeta(TABLES.platformAccounts.id) }
    catch (error) { throw linkedInNocoError(error) }
    const result = inspectLinkedInAuthSchema(meta)
    if (!result.ok) {
      throw new LinkedInAuthError(
        'noco_linkedin_auth_schema_missing',
        `Run the LinkedIn auth schema migration. Missing: ${result.missing.join(', ')}.`
      )
    }
  }
  async function resolveTarget(clientName: string, platformAccountId?: number) {
    return resolveLinkedInAuthTarget({ ...(await loadRows()), clientName, platformAccountId })
  }
  async function updateAccountUrl(platformAccountId: number, value: unknown) {
    const linkedinUrl = await updateLinkedInUrl(client, platformAccountId, value)
    const account = rowsCache?.value.accounts.find((row: any) => Number(row.Id) === platformAccountId)
    if (account) account.url = linkedinUrl
    else rowsCache = undefined
    return linkedinUrl
  }
  return {
    assertSchema,
    async listAccounts() { return listLinkedInAuthAccounts(await loadRows()) },
    resolveTarget,
    updateLinkedInUrl: updateAccountUrl,
    async recordFailure(platformAccountId: number, input: any) {
      await client.patchRecord(TABLES.platformAccounts.id, platformAccountId, failurePatch(input))
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
