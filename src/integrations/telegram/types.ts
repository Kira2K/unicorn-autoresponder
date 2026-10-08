import type {
  ApiResponse,
  ForceReply,
  InlineKeyboardMarkup,
  LinkPreviewOptions,
  Message,
  ParseMode,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from '@grammyjs/types'

export type TelegramReplyMarkup =
  | InlineKeyboardMarkup
  | ReplyKeyboardMarkup
  | ReplyKeyboardRemove
  | ForceReply

export type SendOneInput = {
  /**
   * Telegram destination chat ID.
   *
   * This can be a private chat, group, supergroup, or channel ID.
   * It must never be a database student ID, client ID, user ID,
   * mentor ID, workflow ID, or another application identifier.
   */
  chatId: string

  text: string
  messageThreadId?: number
  parseMode?: ParseMode
  replyMarkup?: TelegramReplyMarkup
  linkPreviewOptions?: LinkPreviewOptions
}

export type SendManyInput = Record<
  string,
  Omit<SendOneInput, 'chatId'>
>

export type ClientFailureStage =
  | 'validation'
  | 'configuration'
  | 'transport'
  | 'response'
  | 'internal'

export type SerializableError = {
  name: string
  message: string
  code?: string
  status?: number
  details?: Record<string, unknown>
}

export type ClientFailure = {
  stage: ClientFailureStage
  error: SerializableError
}

export type TelegramCallResult<T> =
  | {
      kind: 'telegram-response'
      response: ApiResponse<T>
    }
  | {
      kind: 'client-failure'
      failure: ClientFailure
    }

export type TelegramSentMessage = Message.TextMessage | Message.RichMessageMessage

export type SendOneResult =
  TelegramCallResult<TelegramSentMessage>

export type SendManyResult =
  Record<string, SendOneResult>

export type TelegramCommandName = `/${string}`

export type TelegramCommandContext = {
  /**
   * Complete original Telegram message.
   * Do not reduce, replace, or remap it.
   */
  readonly message: Readonly<Message.TextMessage>

  /**
   * Normalized lowercase command without the bot suffix.
   *
   * `/mentor@veu_support_bot` becomes `/mentor`.
   */
  readonly command: TelegramCommandName

  /**
   * Original first command token exactly as received.
   */
  readonly rawCommand: string

  /**
   * Trimmed text after the command token.
   */
  readonly argumentText: string

  /**
   * Immediately sends to `message.chat.id` via `sendOne`.
   * There is no hidden later send.
   */
  reply(
    input: Omit<SendOneInput, 'chatId'>
  ): Promise<SendOneResult>
}

export type TelegramCommandHandler = (
  context: TelegramCommandContext
) => Promise<void>

export type TelegramCommandDispatchResult =
  | {
      kind: 'unhandled'
      reason: 'not-a-command' | 'unknown-command'
    }
  | {
      kind: 'client-failure'
      failure: ClientFailure
    }
  | {
      kind: 'handled'
      command: TelegramCommandName
      replies: readonly SendOneResult[]
    }
