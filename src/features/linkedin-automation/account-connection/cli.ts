const { createLinkedInAuthNocoRepository } = require('./noco-repository.ts') as {
  createLinkedInAuthNocoRepository(): any
}
const { collectLinkedInSession } = require('./session-collector.ts') as {
  collectLinkedInSession(
    profileId: number, expectedUrl: string, dependencies?: any, logger?: any
  ): Promise<any>
}
const { inspectLinkedInDolphinProfile } = require('./dolphin-inspector.ts') as {
  inspectLinkedInDolphinProfile(profileId: number): Promise<any>
}
const {
  createUnipileAccountAdapter,
  unipileProxyProtocol
} = require('../../../integrations/unipile/account-adapter.ts') as {
  createUnipileAccountAdapter(): any
  unipileProxyProtocol(proxy: any): 'http' | 'https' | 'socks4' | 'socks5'
}
const { createLinkedInAuthLogger } = require('./auth-logger.ts') as {
  createLinkedInAuthLogger(): import('./auth-logger.ts').AuthLogger
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

  const logger = createLinkedInAuthLogger()
  const result = await runLinkedInAuth(options, {
    repository: createLinkedInAuthNocoRepository(),
    adapter: options.apply ? createUnipileAccountAdapter() : undefined,
    collectSession(profileId: number, expectedUrl: string, sessionLogger: any) {
      return collectLinkedInSession(profileId, expectedUrl, undefined, sessionLogger)
    },
    inspectProfile: inspectLinkedInDolphinProfile,
    logger,
    unipileProxyProtocol
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
