const { TelegramClient } = require("telegram");
const { Logger, LogLevel } = require("telegram/extensions/Logger");
const { StringSession } = require("telegram/sessions");
const fs = require('node:fs')
const path = require('node:path')
require('dotenv').config({ quiet: true })

const input = require("input") as {
  text(prompt: string): Promise<string>;
};

const apiId: number = 37642224;
const apiHash = "c44116585f70919fa02eb5b8fd121ebc";
const TELEGRAM_SESSION_FILE = path.resolve(__dirname, '.telegram-session')

function readStoredTelegramSession(): string {
  if (process.env.telegram_session) {
    return process.env.telegram_session
  }

  if (!fs.existsSync(TELEGRAM_SESSION_FILE)) {
    return ''
  }

  return fs.readFileSync(TELEGRAM_SESSION_FILE, 'utf8').trim()
}

function saveTelegramSession(session: string): void {
  if (!session) {
    return
  }

  fs.writeFileSync(TELEGRAM_SESSION_FILE, session, {
    encoding: 'utf8',
    mode: 0o600
  })
}

function normalizeTelegramEntityId(value: unknown): string {
  return String(value ?? '').replace(/n$/, '').trim()
}

function getTelegramEntityIdCandidates(dialog: any): string[] {
  const entity = dialog?.entity
  const inputEntity = dialog?.inputEntity
  const candidates = [
    dialog?.id,
    entity?.id,
    inputEntity?.userId,
    inputEntity?.chatId,
    inputEntity?.channelId
  ].map(normalizeTelegramEntityId).filter(Boolean)

  if (entity?.className === 'Channel' && entity?.id) {
    candidates.push(`-100${normalizeTelegramEntityId(entity.id)}`)
  }

  if (entity?.className === 'Chat' && entity?.id) {
    candidates.push(`-${normalizeTelegramEntityId(entity.id)}`)
  }

  return [...new Set(candidates)]
}

function getRequestedTelegramEntityIdCandidates(to: string): string[] {
  const normalizedTo = normalizeTelegramEntityId(to)
  const candidates = [normalizedTo]

  if (normalizedTo.startsWith('100')) {
    candidates.push(`-${normalizedTo}`)
    candidates.push(normalizedTo.slice(3))
  }

  if (normalizedTo.startsWith('-100')) {
    candidates.push(normalizedTo.slice(1))
    candidates.push(normalizedTo.slice(4))
  }

  return [...new Set(candidates.filter(Boolean))]
}

async function resolveTelegramTarget(client: any, to: string): Promise<any> {
  const normalizedTo = to.trim()

  if (!/^-?\d+$/.test(normalizedTo)) {
    return normalizedTo
  }

  const targetCandidates = getRequestedTelegramEntityIdCandidates(normalizedTo)
  const dialogs = await client.getDialogs({
    limit: 500
  })
  const dialog = dialogs.find((item: any) =>
    getTelegramEntityIdCandidates(item).some((candidate) => targetCandidates.includes(candidate))
  )

  if (!dialog) {
    throw new Error(`Telegram dialog with id "${normalizedTo}" was not found in the saved session`)
  }

  return dialog.inputEntity ?? dialog.entity
}

async function createTelegramClient() {
  const telegramSession = readStoredTelegramSession()
  const stringSession = new StringSession(telegramSession);
  const client = new TelegramClient(
    stringSession,
    apiId,
    apiHash,
    {
      connectionRetries: 5,
      baseLogger: new Logger(LogLevel.NONE)
    }
  );
  client.setLogLevel?.(LogLevel.NONE)

  await client.start({
    phoneNumber: async () => await input.text("Phone: +995595830004"),
    password: async () => await input.text("2FA Password (if any): "),
    phoneCode: async () => await input.text("Code: "),
    onError: console.log,
  });

  const savedSession = client.session.save()
  saveTelegramSession(savedSession)

  if (!telegramSession) {
    console.log(`Telegram session saved to ${TELEGRAM_SESSION_FILE}`)
  }

  return client
}

type TelegramParseMode = false | 'html' | 'md' | 'markdown'

async function sendTelegramMessage(
  to: string,
  message: string,
  options: { parseMode?: TelegramParseMode } = {}
): Promise<void> {
  const client = await createTelegramClient()

  try {
    const target = await resolveTelegramTarget(client, to)

    await client.sendMessage(target, {
      message,
      parseMode: options.parseMode ?? false
    })
  } finally {
    await client.disconnect()
  }
}

module.exports = {
  createTelegramClient,
  readStoredTelegramSession,
  resolveTelegramTarget,
  saveTelegramSession,
  sendTelegramMessage
}
