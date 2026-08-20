const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}

const USAGE = `Usage:
  npm run linkedin:auth -- --client "Client Name" [--platform-account-id ID] [--apply] [--force-reauth]

Without --apply, the command validates configuration and resolves the target without restarting Dolphin or calling Unipile.`

function readValue(args: string[], index: number, name: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new LinkedInAuthError('cli_argument_missing', `${name} requires a value.`)
  }
  return value
}

function parseLinkedInAuthArgs(args = process.argv.slice(2)) {
  const options: {
    clientName?: string
    platformAccountId?: number
    apply: boolean
    forceReauth: boolean
    help: boolean
  } = { apply: false, forceReauth: false, help: false }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--apply') options.apply = true
    else if (arg === '--force-reauth') options.forceReauth = true
    else if (arg === '--client') options.clientName = readValue(args, index++, '--client')
    else if (arg.startsWith('--client=')) options.clientName = arg.slice('--client='.length)
    else if (arg === '--platform-account-id') {
      options.platformAccountId = Number(readValue(args, index++, '--platform-account-id'))
    } else if (arg.startsWith('--platform-account-id=')) {
      options.platformAccountId = Number(arg.slice('--platform-account-id='.length))
    } else {
      throw new LinkedInAuthError('cli_argument_unknown', `Unknown argument: ${arg}.`)
    }
  }

  if (options.help) return options
  if (!options.clientName?.trim()) {
    throw new LinkedInAuthError('cli_client_missing', '--client is required.')
  }
  if (options.platformAccountId !== undefined &&
      (!Number.isInteger(options.platformAccountId) || options.platformAccountId <= 0)) {
    throw new LinkedInAuthError('cli_platform_account_invalid', '--platform-account-id must be positive.')
  }
  if (options.forceReauth && !options.apply) {
    throw new LinkedInAuthError('cli_force_requires_apply', '--force-reauth requires --apply.')
  }
  return { ...options, clientName: options.clientName.trim() }
}

module.exports = { USAGE, parseLinkedInAuthArgs }
