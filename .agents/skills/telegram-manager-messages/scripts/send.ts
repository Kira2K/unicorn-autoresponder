import 'dotenv/config'

import type {
  ClientFailureStage,
  SendManyInput,
  SendManyResult,
  SendOneInput,
  SendOneResult
} from '../../../../src/integrations/telegram/types.ts'
import { telegram } from '../../../../src/integrations/telegram/index.ts'

type ManagerSendPayload =
  | {
      previewId: `TG-${string}`
      operation: 'sendOne'
      input: SendOneInput
    }
  | {
      previewId: `TG-${string}`
      operation: 'sendMany'
      input: SendManyInput
    }

type TelegramSender = Pick<typeof telegram, 'sendOne' | 'sendMany'>

type SendOneSummary =
  | {
      kind: 'telegram-response'
      ok: true
      chatId: string
      messageId: number
    }
  | {
      kind: 'telegram-response'
      ok: false
      errorCode: number
      description: string
      retryAfter?: number
      migrateToChatId?: number
    }
  | {
      kind: 'client-failure'
      stage: ClientFailureStage
      error: {
        name: string
        message: string
        code?: string
        status?: number
      }
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeLinkedCommonChatId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('telegram_manager_common_chat_id_invalid')
  }

  const chatId = value.trim()
  if (/^[1-9]\d*$/.test(chatId)) return `-${chatId}`
  if (/^-[1-9]\d*$/.test(chatId)) return chatId
  throw new Error('telegram_manager_common_chat_id_invalid')
}

function hasCanonicalCommonChatIds(
  operation: ManagerSendPayload['operation'],
  input: Record<string, unknown>
): boolean {
  try {
    if (operation === 'sendOne') {
      return (
        typeof input.chatId === 'string' &&
        normalizeLinkedCommonChatId(input.chatId) === input.chatId
      )
    }

    return Object.keys(input).every(
      chatId => normalizeLinkedCommonChatId(chatId) === chatId
    )
  } catch {
    return false
  }
}

export function decodeManagerSendPayload(encoded: string): ManagerSendPayload {
  if (!encoded) throw new Error('telegram_manager_payload_missing')

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  } catch {
    throw new Error('telegram_manager_payload_invalid')
  }

  if (
    !isRecord(raw) ||
    typeof raw.previewId !== 'string' ||
    !/^TG-[0-9A-F]{8}$/.test(raw.previewId) ||
    !isRecord(raw.input) ||
    (raw.operation !== 'sendOne' && raw.operation !== 'sendMany') ||
    !hasCanonicalCommonChatIds(raw.operation, raw.input)
  ) {
    throw new Error('telegram_manager_payload_invalid')
  }

  return raw as ManagerSendPayload
}

export function summarizeSendOne(result: SendOneResult): SendOneSummary {
  if (result.kind === 'client-failure') {
    return {
      kind: 'client-failure',
      stage: result.failure.stage,
      error: {
        name: result.failure.error.name,
        message: result.failure.error.message,
        ...(result.failure.error.code ? { code: result.failure.error.code } : {}),
        ...(result.failure.error.status !== undefined
          ? { status: result.failure.error.status }
          : {})
      }
    }
  }

  if (result.response.ok) {
    return {
      kind: 'telegram-response',
      ok: true,
      chatId: String(result.response.result.chat.id),
      messageId: result.response.result.message_id
    }
  }

  return {
    kind: 'telegram-response',
    ok: false,
    errorCode: result.response.error_code,
    description: result.response.description,
    ...(result.response.parameters?.retry_after !== undefined
      ? { retryAfter: result.response.parameters.retry_after }
      : {}),
    ...(result.response.parameters?.migrate_to_chat_id !== undefined
      ? { migrateToChatId: result.response.parameters.migrate_to_chat_id }
      : {})
  }
}

function summarizeSendMany(result: SendManyResult): Record<string, SendOneSummary> {
  return Object.fromEntries(
    Object.entries(result).map(([chatId, item]) => [chatId, summarizeSendOne(item)])
  )
}

export async function runManagerSend(
  payload: ManagerSendPayload,
  sender: TelegramSender = telegram
): Promise<Record<string, unknown>> {
  if (payload.operation === 'sendOne') {
    return {
      previewId: payload.previewId,
      operation: payload.operation,
      result: summarizeSendOne(await sender.sendOne(payload.input))
    }
  }

  return {
    previewId: payload.previewId,
    operation: payload.operation,
    results: summarizeSendMany(await sender.sendMany(payload.input))
  }
}

async function main(): Promise<void> {
  try {
    const argument = process.argv.find(value => value.startsWith('--payload-base64='))
    const payload = decodeManagerSendPayload(argument?.slice('--payload-base64='.length) ?? '')
    console.log(JSON.stringify(await runManagerSend(payload)))
  } catch (error) {
    console.error(JSON.stringify({
      kind: 'cli-failure',
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error)
      }
    }))
    process.exitCode = 1
  }
}

if ((import.meta as ImportMeta & { main?: boolean }).main) void main()
