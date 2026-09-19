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

const TELEGRAM_REPORT_MAX_LENGTH = 3900

function oneLine(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function failureReport(clientName: string, reason: string): string {
  const normalizedName = oneLine(clientName).slice(0, 256)
  const normalizedReason = oneLine(safeErrorMessage(reason)) || 'Неизвестная ошибка'
  return `⚠️ HH Profile Filler\nНе получилось заполнить ${normalizedName}\nПричина: ${normalizedReason}`
    .slice(0, TELEGRAM_REPORT_MAX_LENGTH)
}

export function formatProfileFillerReport(result: ProfileFillerResult): string {
  return result.ok
    ? '✅ HH Profile Filler\nПолучилось заполнить.'
    : failureReport(result.clientName, result.message)
}

export async function reportProfileFillerResult(result: ProfileFillerResult): Promise<void> {
  if (!SUMMARY_LOGS_CHANNEL_ID) {
    console.warn(formatProfileFillerReport(result))
    console.warn('summary_logs_channel_id is missing; Telegram report was not sent.')
    return
  }
  await sendTelegramMessage(SUMMARY_LOGS_CHANNEL_ID, formatProfileFillerReport(result))
}

export async function reportProfileFillerFatal(message: string,
  clientName?: string): Promise<void> {
  if (!clientName?.trim()) {
    console.warn('A client-named fatal Profile Filler report could not be sent: client name is unknown.')
    return
  }
  const text = failureReport(clientName, message)
  if (!SUMMARY_LOGS_CHANNEL_ID) {
    console.warn(text)
    console.warn('summary_logs_channel_id is missing; Telegram report was not sent.')
    return
  }
  await sendTelegramMessage(SUMMARY_LOGS_CHANNEL_ID, text)
}
