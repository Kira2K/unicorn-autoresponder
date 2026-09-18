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

async function main(args = process.argv.slice(2), supplied?: import('./types.ts').LinkedInAuthDependencies,
  output: (text: string) => void = console.log): Promise<void> {
  const options = parseLinkedInAuthArgs(args)
  if (options.help) {
    output(USAGE)
    return
  }

  const logger = supplied ? supplied.logger : createLinkedInAuthLogger()
  const sql = !supplied && process.env.APP_DB === 'postgres'
    ? await (await import('./postgres-runtime.mts')).openSqlAuth({ apply: options.apply, logger }) : undefined
  try {
    const result = await runLinkedInAuth(
      options, supplied ?? sql?.dependencies ?? createLinkedInAuthDependencies({ apply: options.apply, logger })
    )
    output(JSON.stringify(result, null, 2))
  } finally { await sql?.close() }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(formatSafeAuthError(error))
    process.exitCode = 1
  })
}

module.exports = { main }
