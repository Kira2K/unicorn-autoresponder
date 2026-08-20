const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(): any
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; test: boolean }
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: { platformAccounts: { id: string } }
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: unknown): string
}
const { ensureLinkedInAuthSchema } = require('./logic.ts') as {
  ensureLinkedInAuthSchema(client: any, tableId: string, apply: boolean): Promise<unknown>
}

async function main(): Promise<void> {
  const args = parseJobArgs()
  if (args.test) {
    throw new Error('Use npm run noco:linkedin-auth-schema:test for tests.')
  }

  const result = await ensureLinkedInAuthSchema(
    createNocoClient(),
    TABLES.platformAccounts.id,
    args.apply
  )
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(describeError(error))
    process.exitCode = 1
  })
}

module.exports = {
  main
}
