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

function createNocoGenerationRepository(authRepository: any,
  client = createNocoClient({ pageDelayMs: 300, retryDelaysMs: [0, 30_000, 30_000] })) {
  let cache: { expiresAt: number; value: any[] } | undefined
  async function cvRows() {
    if (cache && cache.expiresAt > Date.now()) return cache.value
    try {
      const value = await client.fetchRecords(TABLES.cvProcessing.id, 1000)
      cache = { value, expiresAt: Date.now() + 120_000 }
      return value
    } catch (error) { throw linkedInNocoError(error) }
  }
  return { async getGenerationContext(platformAccountId: number) {
    return buildGenerationContext({ accounts: await authRepository.listAccounts(),
      cvRows: await cvRows(), platformAccountId })
  } }
}

module.exports = { createNocoGenerationRepository }
