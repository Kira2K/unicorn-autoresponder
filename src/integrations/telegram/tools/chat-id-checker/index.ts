const fs = require('node:fs/promises')
const path = require('node:path')

type TelegramDialog = {
  id?: unknown
  title?: string
  name?: string
  isGroup?: boolean
  isChannel?: boolean
  isUser?: boolean
  entity?: {
    id?: unknown
    className?: string
    title?: string
    username?: string
    participantsCount?: number
    megagroup?: boolean
    broadcast?: boolean
  }
  inputEntity?: unknown
}

type FreshStudentChat = {
  title: string
  chatId: string
  rawDialogId: string
  entityClassName: string
  username?: string
  participantsCount?: number
}

type FreshStudentChatsResult = {
  scannedDialogs: number
  scannedGroupChats: number
  matchedChats: FreshStudentChat[]
}

type GetFreshStudentChatsOptions = {
  titlePrefix?: string
  titleContains?: string
}

type StudentTelegramRecord = {
  commonChatId: string
  market: string
  name: string
  telegram: string
  normalizedTelegram: string
}

type FreshStudentChatBelongingStatus = 'verified' | 'not_found' | 'ambiguous'

type FreshStudentChatBelonging = {
  chatName: string
  studentTelegram: string
  studentName: string
  market: string
  chatId: string
  status: FreshStudentChatBelongingStatus
}

type FreshStudentChatBelongingsResult = {
  outputFile?: string
  scannedDialogs: number
  scannedGroupChats: number
  matchedChats: number
  studentRecords: number
  rows: FreshStudentChatBelonging[]
}

type FreshStudentChatBelongingsOptions = GetFreshStudentChatsOptions & {
  outputFile?: string
}

type FreshStudentChatDialog = {
  chat: FreshStudentChat
  dialog: TelegramDialog
}

const { createTelegramClient } = require('../../messenger.ts') as {
  createTelegramClient(options?: { saveSession?: boolean }): Promise<any>
}
const { createAppDb } = require('../../../../platform/db/index.ts') as {
  createAppDb(): {
    getStudentTelegramRecords(): Promise<StudentTelegramRecord[]>
  }
}

const DEFAULT_BELONGINGS_OUTPUT_FILE = path.resolve(
  __dirname,
  'fresh-student-chats.txt'
)

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function normalizeTelegramId(value: unknown): string {
  return String(value ?? '').replace(/n$/, '').trim()
}

function normalizeTelegramUsername(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
}

function getDialogTitle(dialog: TelegramDialog): string {
  return String(dialog.title ?? dialog.name ?? dialog.entity?.title ?? '').trim()
}

function getBotApiChatId(dialog: TelegramDialog): string {
  const entity = dialog.entity
  const entityId = normalizeTelegramId(entity?.id)

  if (entity?.className === 'Channel' && entityId) {
    return `-100${entityId}`
  }

  if (entity?.className === 'Chat' && entityId) {
    return `-${entityId}`
  }

  return normalizeTelegramId(dialog.id)
}

function isReadableGroupDialog(dialog: TelegramDialog): boolean {
  const entity = dialog.entity

  if (!dialog.isGroup) {
    return false
  }

  if (dialog.isUser || entity?.broadcast) {
    return false
  }

  return true
}

function isFreshStudentChatTitle(
  title: string,
  options: Required<GetFreshStudentChatsOptions>
): boolean {
  const normalizedTitle = normalizeText(title)

  return (
    normalizedTitle.startsWith(normalizeText(options.titlePrefix)) &&
    normalizedTitle.includes(normalizeText(options.titleContains))
  )
}

function mapDialogToFreshStudentChat(dialog: TelegramDialog): FreshStudentChat {
  return {
    title: getDialogTitle(dialog),
    chatId: getBotApiChatId(dialog),
    rawDialogId: normalizeTelegramId(dialog.id),
    entityClassName: String(dialog.entity?.className ?? 'unknown'),
    username: dialog.entity?.username,
    participantsCount: dialog.entity?.participantsCount
  }
}

function getResolvedFreshStudentChatOptions(
  options: GetFreshStudentChatsOptions = {}
): Required<GetFreshStudentChatsOptions> {
  return {
    titlePrefix: options.titlePrefix ?? 'VEU',
    titleContains: options.titleContains ?? 'ментор'
  }
}

async function getFreshStudentChatDialogs(
  client: any,
  options: GetFreshStudentChatsOptions = {}
): Promise<
  FreshStudentChatsResult & {
    dialogs: FreshStudentChatDialog[]
  }
> {
  const resolvedOptions: Required<GetFreshStudentChatsOptions> = {
    titlePrefix: options.titlePrefix ?? 'VEU',
    titleContains: options.titleContains ?? 'ментор'
  }
  let scannedDialogs = 0
  let scannedGroupChats = 0
  const dialogs: FreshStudentChatDialog[] = []

  for await (const dialog of client.iterDialogs({})) {
    scannedDialogs += 1

    if (!isReadableGroupDialog(dialog)) {
      continue
    }

    scannedGroupChats += 1

    const title = getDialogTitle(dialog)

    if (!isFreshStudentChatTitle(title, resolvedOptions)) {
      continue
    }

    dialogs.push({
      chat: mapDialogToFreshStudentChat(dialog),
      dialog
    })
  }

  return {
    scannedDialogs,
    scannedGroupChats,
    matchedChats: dialogs.map(item => item.chat),
    dialogs
  }
}

async function getFreshStudentChats(
  options: GetFreshStudentChatsOptions = {}
): Promise<FreshStudentChatsResult> {
  const client = await createTelegramClient({ saveSession: false })

  try {
    const result = await getFreshStudentChatDialogs(client, options)

    return {
      scannedDialogs: result.scannedDialogs,
      scannedGroupChats: result.scannedGroupChats,
      matchedChats: result.matchedChats
    }
  } finally {
    await client.disconnect()
  }
}

function formatFreshStudentChat(chat: FreshStudentChat, index: number): string {
  return [
    `${index + 1}. ${chat.title}`,
    `chatId=${chat.chatId || 'unknown'}`,
    `rawDialogId=${chat.rawDialogId || 'unknown'}`,
    `entity=${chat.entityClassName}`,
    chat.username ? `username=@${chat.username}` : undefined,
    chat.participantsCount !== undefined
      ? `participants=${chat.participantsCount}`
      : undefined
  ]
    .filter((item): item is string => item !== undefined)
    .join(' | ')
}

async function printFreshStudentChats(
  options: GetFreshStudentChatsOptions = {}
): Promise<FreshStudentChatsResult> {
  const result = await getFreshStudentChats(options)

  console.log(
    `Scanned Telegram dialogs: ${result.scannedDialogs}; group chats: ${result.scannedGroupChats}; matches: ${result.matchedChats.length}`
  )

  if (!result.matchedChats.length) {
    console.log('No matching chats found.')
    return result
  }

  for (let index = 0; index < result.matchedChats.length; index += 1) {
    console.log(formatFreshStudentChat(result.matchedChats[index], index))
  }

  return result
}

function normalizeSheetValue(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeMarketValue(value: unknown): string {
  return normalizeSheetValue(value)
    .replace(/\s+/g, '')
    .toLowerCase()
}

function shouldShowMarket(value: unknown): boolean {
  const normalizedMarket = normalizeMarketValue(value)

  return normalizedMarket === 'en' || normalizedMarket === 'ru/en'
}

async function getStudentTelegramRecords(): Promise<StudentTelegramRecord[]> {
  return await createAppDb().getStudentTelegramRecords()
}

async function getParticipantTelegramUsernames(
  client: any,
  dialog: TelegramDialog
): Promise<Set<string>> {
  const usernames = new Set<string>()
  const entity = dialog.inputEntity ?? dialog.entity

  for await (const user of client.iterParticipants(entity, {
    showTotal: false
  })) {
    const normalizedUsername = normalizeTelegramUsername(user?.username)

    if (normalizedUsername) {
      usernames.add(normalizedUsername)
    }
  }

  return usernames
}

function getBelongingForChat(
  chat: FreshStudentChat,
  matchingRecords: StudentTelegramRecord[]
): FreshStudentChatBelonging {
  if (matchingRecords.length === 1) {
    return {
      chatName: chat.title,
      studentTelegram: matchingRecords[0].telegram,
      studentName: matchingRecords[0].name,
      market: matchingRecords[0].market,
      chatId: chat.chatId,
      status: 'verified'
    }
  }

  if (matchingRecords.length > 1) {
    return {
      chatName: chat.title,
      studentTelegram: matchingRecords.map(record => record.telegram).join(', '),
      studentName: matchingRecords.map(record => record.name).join(', '),
      market: matchingRecords.map(record => record.market).join(', '),
      chatId: chat.chatId,
      status: 'ambiguous'
    }
  }

  return {
    chatName: chat.title,
    studentTelegram: 'n/a',
    studentName: 'n/a',
    market: 'n/a',
    chatId: chat.chatId,
    status: 'not_found'
  }
}

async function getFreshStudentChatBelongings(
  options: FreshStudentChatBelongingsOptions = {}
): Promise<FreshStudentChatBelongingsResult> {
  const studentRecords = await getStudentTelegramRecords()
  const client = await createTelegramClient({ saveSession: false })

  try {
    const chatResult = await getFreshStudentChatDialogs(
      client,
      getResolvedFreshStudentChatOptions(options)
    )
    const rows: FreshStudentChatBelonging[] = []

    for (const item of chatResult.dialogs) {
      const participantUsernames = await getParticipantTelegramUsernames(
        client,
        item.dialog
      )
      const matchingRecords = studentRecords.filter(record =>
        participantUsernames.has(record.normalizedTelegram)
      )
      const missingCommonChatIdRecords = matchingRecords.filter(
        record => !record.commonChatId && shouldShowMarket(record.market)
      )

      if (missingCommonChatIdRecords.length) {
        rows.push(getBelongingForChat(item.chat, missingCommonChatIdRecords))
      }
    }

    return {
      scannedDialogs: chatResult.scannedDialogs,
      scannedGroupChats: chatResult.scannedGroupChats,
      matchedChats: chatResult.matchedChats.length,
      studentRecords: studentRecords.length,
      rows
    }
  } finally {
    await client.disconnect()
  }
}

function formatTxtCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '/')
    .trim()
}

function formatFreshStudentChatBelongingsTxt(
  rows: FreshStudentChatBelonging[]
): string {
  return [
    "Chatname | student's tg according to table | student's name according to table | рынок according to table | chatId | status",
    ...rows.map(row =>
      [
        row.chatName,
        row.studentTelegram,
        row.studentName,
        row.market,
        row.chatId,
        row.status
      ]
        .map(formatTxtCell)
        .join(' | ')
    )
  ].join('\n')
}

async function writeFreshStudentChatBelongingsTxt(
  options: FreshStudentChatBelongingsOptions = {}
): Promise<FreshStudentChatBelongingsResult> {
  const outputFile = path.resolve(
    options.outputFile ?? DEFAULT_BELONGINGS_OUTPUT_FILE
  )
  const result = await getFreshStudentChatBelongings(options)

  await fs.writeFile(
    outputFile,
    `${formatFreshStudentChatBelongingsTxt(result.rows)}\n`,
    'utf8'
  )

  console.log(
    `Scanned Telegram dialogs: ${result.scannedDialogs}; group chats: ${result.scannedGroupChats}; matches: ${result.matchedChats}; student records: ${result.studentRecords}`
  )
  console.log(`Fresh student chat belongings saved to ${outputFile}`)

  return {
    ...result,
    outputFile
  }
}

module.exports = {
  getFreshStudentChats,
  getFreshStudentChatBelongings,
  printFreshStudentChats,
  writeFreshStudentChatBelongingsTxt
}
