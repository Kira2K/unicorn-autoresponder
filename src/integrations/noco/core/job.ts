const { describeError } = require('./errors.ts') as {
  describeError(error: any): string
}

type JobMode = 'dry-run' | 'apply' | 'test'

function parseJobArgs(args = process.argv.slice(2)): {
  mode: JobMode
  apply: boolean
  dryRun: boolean
  test: boolean
} {
  const hasApply = args.includes('--apply')
  const hasDryRun = args.includes('--dry-run')
  const hasTest = args.includes('--test')

  if ([hasApply, hasDryRun, hasTest].filter(Boolean).length > 1) {
    throw new Error('Use only one of --dry-run, --apply, or --test.')
  }

  const mode: JobMode = hasTest ? 'test' : hasApply ? 'apply' : 'dry-run'
  return {
    mode,
    apply: mode === 'apply',
    dryRun: mode === 'dry-run',
    test: mode === 'test'
  }
}

async function runCli(handler: (args: ReturnType<typeof parseJobArgs>) => Promise<void> | void): Promise<void> {
  try {
    await handler(parseJobArgs())
  } catch (error: any) {
    console.error(describeError(error))
    process.exitCode = 1
  }
}

module.exports = {
  parseJobArgs,
  runCli
}
