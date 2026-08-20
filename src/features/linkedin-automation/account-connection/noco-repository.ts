const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(): any
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
const { failurePatch, successPatch } = require('./noco-updates.ts') as {
  failurePatch(input: any): Record<string, unknown>
  successPatch(input: any): Record<string, unknown>
}

function createLinkedInAuthNocoRepository(client = createNocoClient()) {
  async function assertSchema(): Promise<void> {
    const result = inspectLinkedInAuthSchema(await client.fetchTableMeta(TABLES.platformAccounts.id))
    if (!result.ok) {
      throw new LinkedInAuthError(
        'noco_linkedin_auth_schema_missing',
        `Run the LinkedIn auth schema migration. Missing: ${result.missing.join(', ')}.`
      )
    }
  }

  async function resolveTarget(clientName: string, platformAccountId?: number) {
    const [clients, accounts, profiles] = await Promise.all([
      client.fetchRecords(TABLES.clients.id, 1000),
      client.fetchRecords(TABLES.platformAccounts.id, 1000),
      client.fetchRecords(TABLES.dolphinProfiles.id, 1000)
    ])
    return resolveLinkedInAuthTarget({ clients, accounts, profiles, clientName, platformAccountId })
  }

  return {
    assertSchema,
    resolveTarget,
    async recordFailure(platformAccountId: number, input: any) {
      await client.patchRecord(TABLES.platformAccounts.id, platformAccountId, failurePatch(input))
    },
    async recordSuccess(platformAccountId: number, input: any) {
      await client.patchRecord(TABLES.platformAccounts.id, platformAccountId, successPatch(input))
    },
    requiredColumns: LINKEDIN_AUTH_COLUMNS.map(column => column.title)
  }
}

module.exports = { createLinkedInAuthNocoRepository }
