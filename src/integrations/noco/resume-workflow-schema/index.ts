const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(): any
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; test: boolean }
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: { clients: { id: string }; cvProcessing: { id: string }; platforms: { id: string } }
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: unknown): string
}
const { ensureResumeWorkflowSchema } = require('./logic.ts') as {
  ensureResumeWorkflowSchema(client: any, tableIds: { clients: string; cvProcessing: string; platforms: string }, apply: boolean): Promise<unknown>
}

async function main(): Promise<void> {
  const args = parseJobArgs()
  if (args.test) {
    throw new Error('Use npm run noco:resume-workflow-schema:test for tests.')
  }

  const result = await ensureResumeWorkflowSchema(
    createNocoClient(),
    {
      clients: TABLES.clients.id,
      cvProcessing: TABLES.cvProcessing.id,
      platforms: TABLES.platforms.id
    },
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
