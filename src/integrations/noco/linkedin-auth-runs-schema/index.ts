const { createNocoClient } = require('../core/client.ts') as { createNocoClient(): any }
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; test: boolean }
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: unknown): string
}
const { ensureLinkedInAuthRunsTable } = require('./logic.ts') as {
  ensureLinkedInAuthRunsTable(client: any, baseId: string, apply: boolean): Promise<unknown>
}

async function main() {
  const args = parseJobArgs()
  if (args.test) throw new Error('Use the dedicated schema test command.')
  const client = createNocoClient()
  console.log(JSON.stringify(
    await ensureLinkedInAuthRunsTable(client, client.config.baseId, args.apply), null, 2
  ))
}

if (require.main === module) {
  main().catch((error: unknown) => { console.error(describeError(error)); process.exitCode = 1 })
}

module.exports = { main }
