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
  const icon = result.ok ? '✅' : '🐈‍⬛⚠️'
  const lines = [
    `${icon} HH Profile Filler`,
    `Клиент: ${result.clientName} (Noco ${result.clientId})`,
    `Рынок: ${result.market}`,
    result.dolphinProfileId ? `Dolphin: ${result.dolphinProfileId}` : undefined,
    `Этап: ${result.stage}`,
    result.code ? `Код: ${result.code}` : undefined,
    result.attempt ? `Попытка: ${result.attempt}/3` : undefined,
    result.message,
    result.createdResumeTitles?.length
      ? `Созданы черновики: ${result.createdResumeTitles.join('; ')}` : undefined,
    result.stopList?.added.length
      ? `Стоп-лист добавлены: ${result.stopList.added.join('; ')}` : undefined,
    result.stopList?.existing.length
      ? `Стоп-лист уже были: ${result.stopList.existing.join('; ')}` : undefined,
    result.stopList?.skipped.length
      ? `Стоп-лист пропущены: ${result.stopList.skipped.map(item =>
        `${item.name} (${item.reason})`).join('; ')}` : undefined,
    result.stopList && !result.stopList.added.length && !result.stopList.existing.length &&
      !result.stopList.skipped.length ? 'Стоп-лист: кандидатов нет' : undefined,
    result.artifactDir ? `Артефакты: ${result.artifactDir}` : undefined
  ]
  return lines.filter(Boolean).join('\n')
}

export async function reportProfileFillerResult(result: ProfileFillerResult): Promise<void> {
  if (!SUMMARY_LOGS_CHANNEL_ID) {
    console.warn(formatProfileFillerReport(result))
    console.warn('summary_logs_channel_id is missing; Telegram report was not sent.')
    return
  }
  await sendTelegramMessage(SUMMARY_LOGS_CHANNEL_ID, formatProfileFillerReport(result))
}

export async function reportProfileFillerFatal(message: string): Promise<void> {
  const text = `🐈‍⬛⚠️ HH Profile Filler\nОбщий сбой runner\n${message}`
  if (!SUMMARY_LOGS_CHANNEL_ID) {
    console.warn(text)
    console.warn('summary_logs_channel_id is missing; Telegram report was not sent.')
    return
  }
  await sendTelegramMessage(SUMMARY_LOGS_CHANNEL_ID, text)
}
