const { createLinkedInAuthNocoRepository } = require('./noco-repository.ts') as {
  createLinkedInAuthNocoRepository(): any
}
const { collectLinkedInSession } = require('./session-collector.ts') as {
  collectLinkedInSession(profileId: number, expectedUrl: string): Promise<any>
}
const { inspectLinkedInDolphinProfile } = require('./dolphin-inspector.ts') as {
  inspectLinkedInDolphinProfile(profileId: number): Promise<any>
}
const { createUnipileAccountAdapter } = require('../../../integrations/unipile/account-adapter.ts') as {
  createUnipileAccountAdapter(): any
}
const { formatSafeAuthError } = require('./errors.ts') as {
  formatSafeAuthError(error: unknown): string
}
const { runLinkedInAuth } = require('./auth-service.ts') as {
  runLinkedInAuth(input: any, dependencies: any): Promise<any>
}
const { parseLinkedInAuthArgs, USAGE } = require('./cli-args.ts') as {
  parseLinkedInAuthArgs(args?: string[]): any
  USAGE: string
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseLinkedInAuthArgs(args)
  if (options.help) {
    console.log(USAGE)
    return
  }

  const result = await runLinkedInAuth(options, {
    repository: createLinkedInAuthNocoRepository(),
    adapter: options.apply ? createUnipileAccountAdapter() : undefined,
    collectSession: collectLinkedInSession,
    inspectProfile: inspectLinkedInDolphinProfile
  })
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(formatSafeAuthError(error))
    process.exitCode = 1
  })
}

module.exports = { main }
