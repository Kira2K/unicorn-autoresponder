import path from 'node:path'
import { deliverOnce } from './report-delivery.ts'
import { operationStorageRoot } from './operation-state.ts'
import { formatProfileFillerReport } from './report-format.ts'
export { formatProfileFillerReport } from './report-format.ts'
import type { ProfileFillerResult } from './types.ts'
import { safeErrorMessage } from './errors.ts'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { sendTelegramMessage } = require('../../integrations/telegram/messenger.ts') as {
  sendTelegramMessage(to: string, message: string): Promise<void>
}
const { SUMMARY_LOGS_CHANNEL_ID } = require('../hh-responses/orchestrator/config.ts') as {
  SUMMARY_LOGS_CHANNEL_ID?: string
}

const { getDolphinProfile } = require('../../integrations/dolphin/profiles.ts') as {
  getDolphinProfile(id: number): Promise<{ name?: string }>
}

export async function reportProfileFillerResult(result: ProfileFillerResult): Promise<void> {
  if (result.dryRun || result.scope === 'live-smoke') throw new Error('profile_result_not_terminal')
  if (!result.dolphinProfileName && result.dolphinProfileId) {
    const detail = await getDolphinProfile(result.dolphinProfileId).catch(() => undefined)
    if (detail?.name) result.dolphinProfileName = detail.name
  }
  const text = formatProfileFillerReport(result)
  if (!SUMMARY_LOGS_CHANNEL_ID) throw new Error('profile_report_channel_missing')
  await deliverOnce(result.operationId ?? result.jobId ?? '', text,
    path.join(operationStorageRoot(), 'report-delivery'), message => sendTelegramMessage(SUMMARY_LOGS_CHANNEL_ID, message))
}

export async function reportProfileFillerFatal(message: string, _clientName?: string): Promise<void> {
  // Without an operation identity a process exception cannot safely trigger a client report.
  console.warn(`HH Profile Filler: профиль не определён; ${safeErrorMessage(message)}`)
}
