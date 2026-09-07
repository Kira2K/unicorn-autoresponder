import type { ProfileFillerResult } from './types.ts'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { sendTelegramMessage } = require('../../integrations/telegram/messenger.ts') as {
  sendTelegramMessage(to: string, message: string): Promise<void>
}
const { SUMMARY_LOGS_CHANNEL_ID } = require('../hh-responses/orchestrator/config.ts') as {
  SUMMARY_LOGS_CHANNEL_ID?: string
}

export function formatProfileFillerReport(result: ProfileFillerResult): string {
  return result.ok
    ? '✅ HH Profile Filler\nПолучилось заполнить.'
    : '🐈‍⬛⚠️ HH Profile Filler\nНе получилось заполнить.'
}

export async function reportProfileFillerResult(result: ProfileFillerResult): Promise<void> {
  if (!SUMMARY_LOGS_CHANNEL_ID) {
    console.warn(formatProfileFillerReport(result))
    console.warn('summary_logs_channel_id is missing; Telegram report was not sent.')
    return
  }
  await sendTelegramMessage(SUMMARY_LOGS_CHANNEL_ID, formatProfileFillerReport(result))
}

export async function reportProfileFillerFatal(_message: string): Promise<void> {
  const text = '🐈‍⬛⚠️ HH Profile Filler\nНе получилось заполнить.'
  if (!SUMMARY_LOGS_CHANNEL_ID) {
    console.warn(text)
    console.warn('summary_logs_channel_id is missing; Telegram report was not sent.')
    return
  }
  await sendTelegramMessage(SUMMARY_LOGS_CHANNEL_ID, text)
}
