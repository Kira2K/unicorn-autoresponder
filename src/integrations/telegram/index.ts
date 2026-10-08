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
