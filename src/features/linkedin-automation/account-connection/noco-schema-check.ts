const { TABLES } = require('../../../integrations/noco/core/schema.ts') as {
  TABLES: { platformAccounts: { id: string } }
}
const { inspectLinkedInAuthSchema } = require('../../../integrations/noco/linkedin-auth-schema/logic.ts') as {
  inspectLinkedInAuthSchema(meta: any): { ok: boolean; missing: string[] }
}
const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}
const { linkedInNocoError } = require('./noco-error.ts') as {
  linkedInNocoError(error: unknown): unknown
}

async function assertLinkedInAuthNocoSchema(client: any) {
  let meta
  try { meta = await client.fetchTableMeta(TABLES.platformAccounts.id) }
  catch (error) { throw linkedInNocoError(error) }
  const result = inspectLinkedInAuthSchema(meta)
  if (!result.ok) throw new LinkedInAuthError('noco_linkedin_auth_schema_missing',
    `Run the LinkedIn auth schema migration. Missing: ${result.missing.join(', ')}.`)
}

module.exports = { assertLinkedInAuthNocoSchema }
