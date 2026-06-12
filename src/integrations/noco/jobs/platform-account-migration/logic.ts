const assert = require('node:assert/strict')
const { getLinkedRecordId } = require('../../core/relations.ts') as {
  getLinkedRecordId(value: unknown): number | null
}

type Market = 'Ru' | 'En'
type NocoRecord = Record<string, unknown> & { Id: number }

type SourcePlatformAccount = {
  sourceKey: string
  clientId: number
  clientName: string
  sheetClientName: string
  sheetCommonChatId: string
  market: Market
  platform: string
  fields: Record<string, string>
}

type PlatformCreatePlan = {
  platform: string
  record: Record<string, unknown>
}

type AccountCreatePlan = {
  sourceKey: string
  clientId: number
  clientName: string
  market: Market
  platform: string
  platformRecordId?: number
  record: Record<string, unknown>
}

type AccountPatchPlan = {
  sourceKey: string
  accountId: number
  clientId: number
  clientName: string
  market: Market
  platform: string
  patch: Record<string, unknown>
}

type PlatformAccountReport = {
  checkedAt: string
  sourcePlatformAccounts: SourcePlatformAccount[]
  platformCreatePlans: PlatformCreatePlan[]
  createPlans: AccountCreatePlan[]
  patchBlankPlans: AccountPatchPlan[]
  conflicts: Array<Record<string, unknown>>
  duplicates: Array<Record<string, unknown>>
  incompleteSource: Array<Record<string, unknown>>
  unmatchedClients: Array<Record<string, unknown>>
}

const MARKETS: Market[] = ['Ru', 'En']
const HH_SECTION_LABELS: Record<Market, string[]> = {
  Ru: ['ruHH', 'MoscowHH'],
  En: ['enHH', 'InternationalHH']
}
const SECTION_MARKERS = [
  ...HH_SECTION_LABELS.Ru,
  ...HH_SECTION_LABELS.En
]
const TG_LOGIN_LABELS = [
  'tg',
  'telegram',
  'telegram account',
  'tg account',
  'tgLogin',
  'telegramLogin'
]
const TG_PASSWORD_LABELS = [
  'tgPassword',
  'telegramPassword',
  'passwordTG',
  'passwordTelegram'
]
const REQUIRED_PLATFORMS = ['hh_ru', 'hh_en', 'email_ru', 'email_en', 'telegram_ru', 'telegram_en']

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).replace(/[\s_-]+/g, '')
}

function normalizeId(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(raw) || /^[+-]?\d+\.\d+$/.test(raw)) {
    const numberValue = Number(raw)
    if (Number.isFinite(numberValue)) return numberValue.toFixed(0)
  }
  return raw.replace(/\.0$/, '')
}

function rowHasLabel(row: string[] | undefined, label: string): boolean {
  const key = normalizeKey(label)
  return (row ?? []).some(cell => normalizeKey(cell) === key)
}

function findRowIndexOptionalByLabels(values: string[][], labels: string[]): number | undefined {
  const keys = new Set(labels.map(normalizeKey))
  const index = values.findIndex(row => row.some(cell => keys.has(normalizeKey(cell))))
  return index === -1 ? undefined : index
}

function findColumnIndexes(row: string[] | undefined): number[] {
  const result: number[] = []
  for (let index = 0; index < (row ?? []).length; index += 1) {
    result.push(index)
  }
  return result
}

function valueAt(values: string[][], rowIndex: number | undefined, columnIndex: number): string {
  if (rowIndex === undefined) return ''
  return String(values[rowIndex]?.[columnIndex] ?? '').trim()
}

function sectionStart(values: string[][], market: Market): number | undefined {
  for (const label of HH_SECTION_LABELS[market]) {
    const rowIndex = findRowIndexOptionalByLabels(values, [label])
    if (rowIndex !== undefined) return rowIndex
  }
  return undefined
}

function valueInSection(
  values: string[][],
  labels: string[],
  columnIndex: number,
  market: Market
): string {
  const start = sectionStart(values, market)
  if (start === undefined) return ''
  const labelKeys = new Set(labels.map(normalizeKey))

  for (let rowIndex = start; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] ?? []
    if (rowIndex > start && SECTION_MARKERS.some(marker => rowHasLabel(row, marker))) {
      break
    }
    if (row.some(cell => labelKeys.has(normalizeKey(cell)))) {
      return String(row[columnIndex] ?? '').trim()
    }
  }

  return ''
}

function platformFor(kind: 'hh' | 'email' | 'telegram', market: Market): string {
  const suffix = market === 'Ru' ? 'ru' : 'en'
  return `${kind}_${suffix}`
}

function getClientId(client: NocoRecord): number {
  return Number(client.Id)
}

function clientName(client: NocoRecord): string {
  return String(client.client_name ?? '').trim()
}

function clientChatId(client: NocoRecord): string {
  return normalizeId(client.telegram_general_chat_id)
}

function findClientForSheetColumn(
  clients: NocoRecord[],
  sheetClientName: string,
  sheetCommonChatId: string
): { client?: NocoRecord; error?: string; matches?: number[] } {
  const chatId = normalizeId(sheetCommonChatId)
  const chatMatches = chatId
    ? clients.filter(client => clientChatId(client) === chatId)
    : []
  if (chatMatches.length === 1) return { client: chatMatches[0] }
  if (chatMatches.length > 1) {
    return { error: 'ambiguous_chat_id', matches: chatMatches.map(getClientId) }
  }

  const name = normalizeText(sheetClientName)
  if (!name) return { error: 'missing_identity' }
  const nameMatches = clients.filter(client => normalizeText(clientName(client)) === name)
  if (nameMatches.length === 1) return { client: nameMatches[0] }
  if (nameMatches.length > 1) {
    return { error: 'ambiguous_name', matches: nameMatches.map(getClientId) }
  }
  return { error: 'not_found' }
}

function hasAnyField(fields: Record<string, string>): boolean {
  return Object.values(fields).some(value => String(value ?? '').trim())
}

function buildSourcePlatformAccounts(
  personalDataValues: string[][],
  clients: NocoRecord[]
): {
  accounts: SourcePlatformAccount[]
  incompleteSource: Array<Record<string, unknown>>
  unmatchedClients: Array<Record<string, unknown>>
} {
  const nameRowIndex = findRowIndexOptionalByLabels(personalDataValues, ['имя'])
  const chatRowIndex = findRowIndexOptionalByLabels(personalDataValues, ['Id общего чата'])
  const nameRow = personalDataValues[nameRowIndex ?? -1] ?? []
  const chatRow = personalDataValues[chatRowIndex ?? -1] ?? []
  const accounts: SourcePlatformAccount[] = []
  const incompleteSource: Array<Record<string, unknown>> = []
  const unmatchedClients: Array<Record<string, unknown>> = []

  for (const columnIndex of findColumnIndexes(nameRow.length >= chatRow.length ? nameRow : chatRow)) {
    const sheetClientName = valueAt(personalDataValues, nameRowIndex, columnIndex)
    const sheetCommonChatId = normalizeId(valueAt(personalDataValues, chatRowIndex, columnIndex))
    if (!sheetClientName && !sheetCommonChatId) continue
    if (normalizeKey(sheetClientName) === normalizeKey('имя')) continue

    const match = findClientForSheetColumn(clients, sheetClientName, sheetCommonChatId)
    if (!match.client) {
      unmatchedClients.push({
        columnIndex,
        sheetClientName,
        sheetCommonChatId,
        reason: match.error,
        matchingClientIds: match.matches ?? []
      })
      continue
    }

    for (const market of MARKETS) {
      const phone = valueInSection(personalDataValues, ['rusPhoneNumber'], columnIndex, market)
      const hhPassword = valueInSection(personalDataValues, ['passwordHH'], columnIndex, market)
      const email = valueInSection(personalDataValues, ['emailHH'], columnIndex, market)
      const emailPassword = valueInSection(personalDataValues, ['passwordEmailHH'], columnIndex, market)
      const tgLogin = valueInSection(personalDataValues, TG_LOGIN_LABELS, columnIndex, market)
      const tgPassword = valueInSection(personalDataValues, TG_PASSWORD_LABELS, columnIndex, market)
      const base = {
        clientId: getClientId(match.client),
        clientName: clientName(match.client),
        sheetClientName,
        sheetCommonChatId,
        market
      }

      const hhFields = {
        phone,
        login: phone,
        password: hhPassword,
        email,
        email_password: emailPassword
      }
      if (hasAnyField(hhFields)) {
        accounts.push({
          ...base,
          sourceKey: `${base.clientId}:${platformFor('hh', market)}`,
          platform: platformFor('hh', market),
          fields: hhFields
        })
      }

      if (email || emailPassword) {
        if (email && emailPassword) {
          accounts.push({
            ...base,
            sourceKey: `${base.clientId}:${platformFor('email', market)}`,
            platform: platformFor('email', market),
            fields: {
              login: email,
              email,
              password: emailPassword
            }
          })
        } else {
          incompleteSource.push({
            ...base,
            platform: platformFor('email', market),
            reason: email ? 'missing_email_password' : 'missing_email',
            emailPresent: Boolean(email),
            emailPasswordPresent: Boolean(emailPassword)
          })
        }
      }

      if (tgLogin || tgPassword) {
        if (tgLogin && tgPassword) {
          accounts.push({
            ...base,
            sourceKey: `${base.clientId}:${platformFor('telegram', market)}`,
            platform: platformFor('telegram', market),
            fields: {
              login: tgLogin,
              password: tgPassword
            }
          })
        } else {
          incompleteSource.push({
            ...base,
            platform: platformFor('telegram', market),
            reason: tgLogin ? 'missing_tg_password' : 'missing_tg_login',
            tgLoginPresent: Boolean(tgLogin),
            tgPasswordPresent: Boolean(tgPassword)
          })
        }
      }
    }
  }

  return { accounts, incompleteSource, unmatchedClients }
}

function platformRecordIdByPlatform(platforms: NocoRecord[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const platform of platforms) {
    const keys = [
      platform.label,
      platform.platform,
      platform.name
    ].map(normalizeText).filter(Boolean)
    for (const key of keys) {
      if (!result.has(key)) result.set(key, Number(platform.Id))
    }
  }
  return result
}

function platformCreatePlans(platforms: NocoRecord[]): PlatformCreatePlan[] {
  const existing = platformRecordIdByPlatform(platforms)
  return REQUIRED_PLATFORMS
    .filter(platform => !existing.has(platform))
    .map(platform => ({
      platform,
      record: {
        name: platform.replace(/_(ru|en)$/, ''),
        label: platform,
        market: platform.endsWith('_ru') ? 'ru' : platform.endsWith('_en') ? 'en' : 'both',
        note: 'Created by platform account migration.'
      }
    }))
}

function getAccountClientId(account: NocoRecord): number | null {
  const linkedId = getLinkedRecordId(account.rel_platformAccounts_client)
  if (linkedId) return linkedId
  const clientId = Number(account.clients_id)
  return Number.isFinite(clientId) && clientId > 0 ? clientId : null
}

function accountPlatform(account: NocoRecord): string {
  return normalizeText(account.platform)
}

function indexAccounts(accounts: NocoRecord[]): Map<string, NocoRecord[]> {
  const result = new Map<string, NocoRecord[]>()
  for (const account of accounts) {
    const clientId = getAccountClientId(account)
    const platform = accountPlatform(account)
    if (!clientId || !platform) continue
    const key = `${clientId}:${platform}`
    if (!result.has(key)) result.set(key, [])
    result.get(key)!.push(account)
  }
  return result
}

function buildAccountRecord(
  source: SourcePlatformAccount,
  platformRecordId?: number
): Record<string, unknown> {
  return {
    platform: source.platform,
    clients_id: source.clientId,
    ...(platformRecordId ? { platforms_id: platformRecordId } : {}),
    account_label: `${source.clientName} ${source.platform}`,
    ...source.fields
  }
}

function diffBlankPatch(
  existing: NocoRecord,
  source: SourcePlatformAccount
): { patch: Record<string, unknown>; conflicts: Array<Record<string, unknown>> } {
  const patch: Record<string, unknown> = {}
  const conflicts: Array<Record<string, unknown>> = []

  for (const [field, value] of Object.entries(source.fields)) {
    if (!value) continue
    const current = String(existing[field] ?? '').trim()
    if (!current) {
      patch[field] = value
    } else if (current !== value) {
      conflicts.push({
        sourceKey: source.sourceKey,
        accountId: existing.Id,
        clientId: source.clientId,
        clientName: source.clientName,
        platform: source.platform,
        field,
        nocoValue: current,
        sheetValue: value
      })
    }
  }

  if (!String(existing.platform ?? '').trim()) {
    patch.platform = source.platform
  } else if (accountPlatform(existing) !== source.platform) {
    conflicts.push({
      sourceKey: source.sourceKey,
      accountId: existing.Id,
      clientId: source.clientId,
      clientName: source.clientName,
      platform: source.platform,
      field: 'platform',
      nocoValue: existing.platform,
      sheetValue: source.platform
    })
  }

  return { patch, conflicts }
}

function buildPlatformAccountReport(
  input: {
    personalDataValues: string[][]
    clients: NocoRecord[]
    platformAccounts: NocoRecord[]
    platforms: NocoRecord[]
  },
  now = new Date().toISOString()
): PlatformAccountReport {
  const source = buildSourcePlatformAccounts(input.personalDataValues, input.clients)
  const accountIndex = indexAccounts(input.platformAccounts)
  const platformIds = platformRecordIdByPlatform(input.platforms)
  const createPlans: AccountCreatePlan[] = []
  const patchBlankPlans: AccountPatchPlan[] = []
  const conflicts: Array<Record<string, unknown>> = []
  const duplicates: Array<Record<string, unknown>> = []

  for (const sourceAccount of source.accounts) {
    const matches = accountIndex.get(sourceAccount.sourceKey) ?? []
    const platformRecordId = platformIds.get(sourceAccount.platform)
    if (!matches.length) {
      createPlans.push({
        sourceKey: sourceAccount.sourceKey,
        clientId: sourceAccount.clientId,
        clientName: sourceAccount.clientName,
        market: sourceAccount.market,
        platform: sourceAccount.platform,
        platformRecordId,
        record: buildAccountRecord(sourceAccount, platformRecordId)
      })
      continue
    }
    if (matches.length > 1) {
      duplicates.push({
        sourceKey: sourceAccount.sourceKey,
        clientId: sourceAccount.clientId,
        clientName: sourceAccount.clientName,
        platform: sourceAccount.platform,
        accountIds: matches.map(account => account.Id)
      })
      continue
    }

    const existing = matches[0]
    const diff = diffBlankPatch(existing, sourceAccount)
    conflicts.push(...diff.conflicts)
    if (Object.keys(diff.patch).length) {
      patchBlankPlans.push({
        sourceKey: sourceAccount.sourceKey,
        accountId: Number(existing.Id),
        clientId: sourceAccount.clientId,
        clientName: sourceAccount.clientName,
        market: sourceAccount.market,
        platform: sourceAccount.platform,
        patch: diff.patch
      })
    }
  }

  return {
    checkedAt: now,
    sourcePlatformAccounts: source.accounts,
    platformCreatePlans: platformCreatePlans(input.platforms),
    createPlans,
    patchBlankPlans,
    conflicts,
    duplicates,
    incompleteSource: source.incompleteSource,
    unmatchedClients: source.unmatchedClients
  }
}

function summarize(report: PlatformAccountReport): Record<string, unknown> {
  return {
    sourcePlatformAccounts: report.sourcePlatformAccounts.length,
    platformCreatePlans: report.platformCreatePlans.length,
    createPlans: report.createPlans.length,
    patchBlankPlans: report.patchBlankPlans.length,
    conflicts: report.conflicts.length,
    duplicates: report.duplicates.length,
    incompleteSource: report.incompleteSource.length,
    unmatchedClients: report.unmatchedClients.length
  }
}

function mask(value: unknown): string {
  return String(value ?? '') ? '***' : ''
}

function renderManualReview(report: PlatformAccountReport): string {
  const lines = [
    '# Platform Account Migration Review',
    '',
    '## Summary',
    '',
    '```json',
    JSON.stringify(summarize(report), null, 2),
    '```',
    '',
    '## Conflicts',
    '',
    '| client | platform | field | Noco | Sheet |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const conflict of report.conflicts) {
    const field = String(conflict.field ?? '')
    const sensitive = /password/i.test(field)
    lines.push(
      `| ${conflict.clientName ?? ''} | ${conflict.platform ?? ''} | ${field} | ${sensitive ? mask(conflict.nocoValue) : conflict.nocoValue ?? ''} | ${sensitive ? mask(conflict.sheetValue) : conflict.sheetValue ?? ''} |`
    )
  }
  lines.push('', '## Duplicates', '', '| client | platform | account ids |', '| --- | --- | --- |')
  for (const duplicate of report.duplicates) {
    lines.push(`| ${duplicate.clientName ?? ''} | ${duplicate.platform ?? ''} | ${duplicate.accountIds ?? ''} |`)
  }
  lines.push('', '## Incomplete Source', '', '| client | platform | reason |', '| --- | --- | --- |')
  for (const item of report.incompleteSource) {
    lines.push(`| ${item.clientName ?? item.sheetClientName ?? ''} | ${item.platform ?? ''} | ${item.reason ?? ''} |`)
  }
  lines.push('', '## Unmatched Clients', '', '| column | name | chat id | reason |', '| --- | --- | --- | --- |')
  for (const item of report.unmatchedClients) {
    lines.push(`| ${item.columnIndex ?? ''} | ${item.sheetClientName ?? ''} | ${item.sheetCommonChatId ?? ''} | ${item.reason ?? ''} |`)
  }
  return `${lines.join('\n')}\n`
}

function fixtureValues(): string[][] {
  return [
    ['', 'Alice', 'Bob', 'Carol', 'Dana'],
    ['имя', 'Alice', 'Bob', 'Carol', 'Dana'],
    ['Id общего чата', '1001', '1002', '', '9999'],
    ['ТГ', '@personal_alice', '@personal_bob', '@personal_carol', '@personal_dana'],
    ['ruHH', '', '', '', ''],
    ['rusPhoneNumber', '79991112233', '', '', ''],
    ['passwordHH', 'hhPass', '', '', ''],
    ['emailHH', 'alice@example.com', 'bob@example.com', '', 'dana@example.com'],
    ['passwordEmailHH', 'emailPass', 'bobEmailPass', '', 'danaEmailPass'],
    ['tg', 'alice_auto', 'bob_auto', '', 'dana_auto'],
    ['tgPassword', 'tgPass', '', '', 'danaTgPass'],
    ['enHH', '', '', '', ''],
    ['rusPhoneNumber', '15550001111', '', '', ''],
    ['passwordHH', 'enPass', '', '', ''],
    ['emailHH', 'alice-en@example.com', '', '', ''],
    ['passwordEmailHH', 'enEmailPass', '', '', ''],
    ['telegramLogin', 'alice_en_auto', '', '', ''],
    ['telegramPassword', 'aliceEnTgPass', '', '', '']
  ]
}

function runTests(): void {
  const clients: NocoRecord[] = [
    { Id: 1, client_name: 'Alice', telegram_general_chat_id: '1001' },
    { Id: 2, client_name: 'Bob', telegram_general_chat_id: '1002' },
    { Id: 3, client_name: 'Carol', telegram_general_chat_id: '' }
  ]
  const platforms: NocoRecord[] = [
    { Id: 10, label: 'hh_ru' },
    { Id: 11, label: 'hh_en' }
  ]
  const platformAccounts: NocoRecord[] = [
    {
      Id: 100,
      clients_id: 1,
      platform: 'hh_ru',
      login: '',
      phone: '',
      password: 'existingPass',
      email: 'old@example.com'
    },
    {
      Id: 101,
      clients_id: 2,
      platform: 'email_ru',
      login: 'dupe1'
    },
    {
      Id: 102,
      clients_id: 2,
      platform: 'email_ru',
      login: 'dupe2'
    }
  ]
  const report = buildPlatformAccountReport({
    personalDataValues: fixtureValues(),
    clients,
    platformAccounts,
    platforms
  }, 'now')

  assert.equal(report.platformCreatePlans.length, 4)
  assert(report.platformCreatePlans.some(plan => plan.platform === 'email_ru'))
  assert(report.platformCreatePlans.some(plan => plan.platform === 'telegram_en'))
  assert(report.sourcePlatformAccounts.some(account => account.platform === 'telegram_ru' && account.clientId === 1))
  assert(!report.sourcePlatformAccounts.some(account => account.platform === 'telegram' && account.fields.login === 'personal_alice'))
  assert(report.createPlans.some(plan => plan.platform === 'email_ru' && plan.clientId === 1))
  assert(report.createPlans.some(plan => plan.platform === 'telegram_en' && plan.clientId === 1))
  assert(report.patchBlankPlans.some(plan => plan.accountId === 100 && plan.patch.login === '79991112233'))
  assert(report.conflicts.some(conflict => conflict.accountId === 100 && conflict.field === 'password'))
  assert(report.duplicates.some(duplicate => duplicate.clientId === 2 && duplicate.platform === 'email_ru'))
  assert(report.incompleteSource.some(item => item.clientId === 2 && item.platform === 'telegram_ru' && item.reason === 'missing_tg_password'))
  assert(report.unmatchedClients.some(item => item.sheetClientName === 'Dana'))
}

module.exports = {
  REQUIRED_PLATFORMS,
  buildPlatformAccountReport,
  buildSourcePlatformAccounts,
  renderManualReview,
  runTests,
  summarize
}
