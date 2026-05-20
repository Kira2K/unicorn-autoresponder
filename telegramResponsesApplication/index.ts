const fs = require('node:fs')
const path = require('node:path')
const { TelegramClient } = require('telegram')
const { Logger, LogLevel } = require('telegram/extensions/Logger')
const { StringSession } = require('telegram/sessions')
require('dotenv').config({ quiet: true })

const input = require('input') as {
  text(prompt: string): Promise<string>
}

type CliOptions = {
  apiId?: string
  apiHash?: string
  session?: string
  sessionFile?: string
  phone?: string
  to?: string
  message?: string
  noSaveSession?: boolean
  help?: boolean
}

type TelegramResponsesConfig = {
  apiId: number
  apiHash: string
  session: string
  sessionFile: string
  phone?: string
  saveSession: boolean
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (!arg.startsWith('--')) {
      continue
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const value = inlineValue ?? argv[index + 1]

    if (inlineValue === undefined && value && !value.startsWith('--')) {
      index += 1
    }

    switch (rawKey) {
      case 'api-id':
        options.apiId = value
        break
      case 'api-hash':
        options.apiHash = value
        break
      case 'session':
        options.session = value
        break
      case 'session-file':
        options.sessionFile = value
        break
      case 'phone':
        options.phone = value
        break
      case 'to':
        options.to = value
        break
      case 'message':
        options.message = value
        break
      case 'no-save-session':
        options.noSaveSession = true
        break
      case 'help':
        options.help = true
        break
      default:
        throw new Error(`Unsupported argument --${rawKey}`)
    }
  }

  return options
}

function readSessionFile(sessionFile: string): string {
  if (!fs.existsSync(sessionFile)) {
    return ''
  }

  return fs.readFileSync(sessionFile, 'utf8').trim()
}

function saveSessionFile(sessionFile: string, session: string): void {
  if (!session) {
    return
  }

  fs.mkdirSync(path.dirname(sessionFile), { recursive: true })
  fs.writeFileSync(sessionFile, session, {
    encoding: 'utf8',
    mode: 0o600
  })
}

function getConfig(options: CliOptions = {}): TelegramResponsesConfig {
  const sessionFile = path.resolve(
    options.sessionFile ??
      process.env.telegram_responses_session_file ??
      path.join(__dirname, '.telegram-session')
  )
  const apiIdValue =
    options.apiId ?? process.env.telegram_responses_api_id
  const apiHash =
    options.apiHash ?? process.env.telegram_responses_api_hash

  if (!apiIdValue || !Number.isFinite(Number(apiIdValue))) {
    throw new Error(
      'Missing telegram_responses_api_id or --api-id'
    )
  }

  if (!apiHash) {
    throw new Error(
      'Missing telegram_responses_api_hash or --api-hash'
    )
  }

  return {
    apiId: Number(apiIdValue),
    apiHash,
    session:
      options.session ??
      process.env.telegram_responses_session ??
      readSessionFile(sessionFile),
    sessionFile,
    phone: options.phone ?? process.env.telegram_responses_phone,
    saveSession: !options.noSaveSession
  }
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
  const dialogs = await client.getDialogs({ limit: 500 })
  const dialog = dialogs.find((item: any) =>
    getTelegramEntityIdCandidates(item).some(candidate =>
      targetCandidates.includes(candidate)
    )
  )

  if (!dialog) {
    throw new Error(
      `Telegram dialog with id "${normalizedTo}" was not found in this session`
    )
  }

  return dialog.inputEntity ?? dialog.entity
}

async function createTelegramResponsesClient(
  options: CliOptions = {}
): Promise<any> {
  const config = getConfig(options)
  const stringSession = new StringSession(config.session)
  const client = new TelegramClient(stringSession, config.apiId, config.apiHash, {
    connectionRetries: 5,
    baseLogger: new Logger(LogLevel.NONE)
  })

  client.setLogLevel?.(LogLevel.NONE)

  await client.start({
    phoneNumber: async () =>
      config.phone ?? await input.text('Phone: '),
    password: async () => await input.text('2FA Password (if any): '),
    phoneCode: async () => await input.text('Code: '),
    onError: console.log
  })

  if (config.saveSession) {
    saveSessionFile(config.sessionFile, client.session.save())
  }

  return client
}

async function sendTelegramResponsesMessage(
  to: string,
  message: string,
  options: CliOptions = {}
): Promise<void> {
  const client = await createTelegramResponsesClient(options)

  try {
    const target = await resolveTelegramTarget(client, to)

    await client.sendMessage(target, {
      message,
      parseMode: false
    })
  } finally {
    await client.disconnect()
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))

  if (options.help) {
    console.log([
      'Usage: npm run tg:responses -- --to <target> [--message <text>]',
      '',
      'Required via env or CLI:',
      '  telegram_responses_api_id / --api-id',
      '  telegram_responses_api_hash / --api-hash',
      '  telegram_responses_test_to / --to',
      '',
      'Optional:',
      '  telegram_responses_session / --session',
      '  telegram_responses_session_file / --session-file',
      '  telegram_responses_phone / --phone',
      '  --no-save-session'
    ].join('\n'))
    return
  }

  const to =
    options.to ?? process.env.telegram_responses_test_to
  const message =
    options.message ??
    process.env.telegram_responses_test_message ??
    `telegramResponses check ${new Date().toISOString()}`

  if (!to) {
    throw new Error(
      'Missing telegram_responses_test_to or --to'
    )
  }

  await sendTelegramResponsesMessage(to, message, options)
  console.log('Telegram responses check message sent')
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

module.exports = {
  createTelegramResponsesClient,
  getConfig,
  parseCliOptions,
  resolveTelegramTarget,
  sendTelegramResponsesMessage
}
