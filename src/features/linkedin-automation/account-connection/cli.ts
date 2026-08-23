const { createLinkedInAuthLogger } = require('./auth-logger.ts') as {
  createLinkedInAuthLogger(): import('./auth-logger.ts').AuthLogger
}
const { createLinkedInAuthDependencies } = require('./runtime.ts') as {
  createLinkedInAuthDependencies(options: any): any
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
  const result = await runLinkedInAuth(
    options, createLinkedInAuthDependencies({ apply: options.apply, logger })
  )
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(formatSafeAuthError(error))
    process.exitCode = 1
  })
}

module.exports = { main }
