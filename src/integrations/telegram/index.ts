export type {
  ClientFailure,
  ClientFailureStage,
  SendManyInput,
  SendManyResult,
  SendOneInput,
  SendOneResult,
  SerializableError,
  TelegramCallResult,
  TelegramCommandContext,
  TelegramCommandDispatchResult,
  TelegramCommandHandler,
  TelegramCommandName,
  TelegramReplyMarkup,
  TelegramSentMessage
} from './types.ts'

import { createTelegramIntegration } from './integration.ts'

export const telegram = createTelegramIntegration()

/** Trusted server composition: same bot, a feature-specific error destination. */
export function telegramForReports(chatId: string, env: NodeJS.ProcessEnv = process.env) {
  if (!/^-?\d+$/.test(chatId)) throw new Error('telegram_report_chat_required')
  return createTelegramIntegration({ env, regularErrorChatId: chatId, summaryLogsChatId: chatId })
}
