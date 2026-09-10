const { createNocoClient } = require('../../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<'cvProcessing', { id: string }>
}
const { linkedInNocoError } = require('../../account-connection/noco-error.ts') as {
  linkedInNocoError(error: unknown): unknown
}
const { buildGenerationContext } = require('./generation-context.ts') as
  typeof import('./generation-context.ts')
const { readProfileAccount } = require('../profile-account.ts') as {
  readProfileAccount: import('../profile-account.ts').ProfileAccountReader
}
type AccountRow = import('../../account-connection/types.ts').LinkedInAuthAccountRow

function createNocoGenerationRepository(authRepository: any,
  client = createNocoClient({ pageDelayMs: 300, retryDelaysMs: [0, 30_000, 30_000] })) {
  return { async getGenerationContext(platformAccountId: number, supplied?: AccountRow) {
    const account = supplied ?? await readProfileAccount(authRepository, platformAccountId)
    if (account.platformAccountId !== platformAccountId || !Number.isSafeInteger(account.clientId) || account.clientId <= 0) {
      throw new Error('Invalid account for CV selection')
    }
    try {
      const cvRows = await client.fetchRecords(TABLES.cvProcessing.id, 100,
        { where: `(clients_id,eq,${account.clientId})` }, { fresh: true })
      return buildGenerationContext({ accounts: [account], cvRows, platformAccountId })
    } catch (error) { throw linkedInNocoError(error) }
  } }
}

module.exports = { createNocoGenerationRepository }
