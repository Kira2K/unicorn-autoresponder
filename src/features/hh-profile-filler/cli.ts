import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createProfileFillerService } from './service.ts'
import { reportProfileFillerFatal, reportProfileFillerResult } from './reporter.ts'
import { safeErrorMessage } from './errors.ts'
import { runPending } from './pending-runner.ts'
import type { ProfileFillerMarket, ProfileFillerResult } from './types.ts'

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

let fatalClientName: string | undefined
let suppressFatalReport = false

export async function main(args = process.argv.slice(2)) {
  fatalClientName = undefined
  if (args.includes('--pending') || args.includes('--scan-only')) {
    suppressFatalReport = true
    await runPending()
    return
  }
  const deferredTelegram = args.includes('--defer-telegram')
  const reportResultPath = value(args, '--report-result')
  suppressFatalReport = args.includes('--live-smoke') || args.includes('--dry-run') || deferredTelegram || Boolean(reportResultPath)
  if (reportResultPath) {
    const resultFile = path.resolve(reportResultPath)
    const markerFile = `${resultFile}.telegram-sent`
    if (fs.existsSync(markerFile)) {
      console.log(JSON.stringify({ reported: false, reason: 'already_reported', resultFile }, null, 2))
      return
    }
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as ProfileFillerResult
    await reportProfileFillerResult(result)
    fs.writeFileSync(markerFile, `${new Date().toISOString()}\n`, { mode: 0o600 })
    console.log(JSON.stringify({ reported: true, resultFile }, null, 2))
    return
  }
  const clientId = Number(value(args, '--client-id'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new Error('Expected a positive --client-id.')
  }
  const service = createProfileFillerService()
  const selectedMarket = market(value(args, '--market'))
  const resumeId = value(args, '--resume-id')
  const resumeFromValue = value(args, '--resume-from')
  const orderedResumeIds = String(value(args, '--resume-ids') ?? '')
    .split(',').map(item => item.trim()).filter(Boolean)
  if (resumeFromValue &&
      !['experience', 'skills', 'work-permits', 'privacy', 'delete-old', 'verify-final', 'title-variants', 'activate'].includes(resumeFromValue)) {
    throw new Error('Expected --resume-from work-permits, privacy, delete-old, verify-final, title-variants or activate.')
  }
  if (resumeFromValue === 'work-permits' && !resumeId) {
    throw new Error('--resume-from work-permits requires --resume-id.')
  }
  if (resumeFromValue === 'verify-final' && !orderedResumeIds.length) {
    throw new Error('--resume-from verify-final requires ordered --resume-ids.')
  }
  if (['experience', 'skills'].includes(resumeFromValue ?? '') && !orderedResumeIds.length) {
    throw new Error('--resume-from experience/skills requires ordered --resume-ids.')
  }
  if (resumeFromValue === 'title-variants' && !resumeId && !orderedResumeIds.length) {
    throw new Error('--resume-from title-variants requires a known baseline --resume-id or ordered --resume-ids.')
  }
  const result = args.includes('--live-smoke')
    ? await service.runLiveSmoke(clientId, selectedMarket)
    : await service.run(clientId, selectedMarket, args.includes('--dry-run'), undefined,
        args.includes('--use-noco-identity'), resumeId,
        resumeFromValue as 'experience' | 'skills' | 'work-permits' | 'privacy' | 'delete-old' | 'verify-final' | 'title-variants' | 'activate' | undefined,
        orderedResumeIds)
  fatalClientName = result.clientName
  console.log(JSON.stringify(result, null, 2))
  if (!result.dryRun && !deferredTelegram && (!result.ok || result.operationComplete === true)) {
    await reportProfileFillerResult(result).catch(error => {
      console.error(`Profile filler final report was not confirmed: ${safeErrorMessage(error)}`)
      process.exitCode = 1
    })
  }
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch(async error => {
      const message = safeErrorMessage(error)
      console.error(message)
      if (!suppressFatalReport) {
        await reportProfileFillerFatal(message, fatalClientName).catch(reportError =>
          console.error(`Profile filler fatal Telegram report failed: ${safeErrorMessage(reportError)}`))
      }
      process.exit(1)
    })
}
