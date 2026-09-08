import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { createProfileFillerService } from './service.ts'
import { reportProfileFillerFatal, reportProfileFillerResult } from './reporter.ts'
import { safeErrorMessage } from './errors.ts'
import { runPending } from './pending-runner.ts'
import type { ProfileFillerMarket } from './types.ts'

function value(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function market(value: string | undefined): ProfileFillerMarket {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'ru') return 'Ru'
  if (normalized === 'en') return 'En'
  throw new Error('Expected --market ru or --market en.')
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--pending') || args.includes('--scan-only')) {
    const output = await runPending({ scanOnly: args.includes('--scan-only'),
      statePath: value(args, '--state') })
    console.log(JSON.stringify(output, null, 2))
    if (output.results.some(result => !result.ok)) process.exitCode = 1
    return
  }
  const clientId = Number(value(args, '--client-id'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new Error('Expected a positive --client-id.')
  }
  const result = await createProfileFillerService().run(clientId,
    market(value(args, '--market')), args.includes('--dry-run'), undefined,
    args.includes('--use-noco-identity'))
  console.log(JSON.stringify(result, null, 2))
  if (!result.dryRun) await reportProfileFillerResult(result)
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch(async error => {
      const message = safeErrorMessage(error)
      console.error(message)
      await reportProfileFillerFatal(message).catch(reportError =>
        console.error(`Profile filler fatal Telegram report failed: ${safeErrorMessage(reportError)}`))
      process.exit(1)
    })
}
