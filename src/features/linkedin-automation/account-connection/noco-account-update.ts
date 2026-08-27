const { canonicalLinkedInProfileUrl, linkedInPublicIdentifier } = require('./profile-url.ts') as {
  canonicalLinkedInProfileUrl(value: string): string
  linkedInPublicIdentifier(value: unknown): string
}
const { linkedInNocoError } = require('./noco-error.ts') as {
  linkedInNocoError(error: unknown): unknown
}
const { TABLES } = require('../../../integrations/noco/core/schema.ts') as {
  TABLES: { platformAccounts: { id: string } }
}

async function updateLinkedInUrl(client: any, platformAccountId: number, value: unknown) {
  const linkedinUrl = canonicalLinkedInProfileUrl(linkedInPublicIdentifier(value))
  try {
    await client.patchRecord(TABLES.platformAccounts.id, platformAccountId, { url: linkedinUrl })
  } catch (error) { throw linkedInNocoError(error) }
  return linkedinUrl
}

module.exports = { updateLinkedInUrl }
