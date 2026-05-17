type Market = 'En' | 'Ru'

type ProxyCheckStatus = 'ok' | 'needs_proxy' | 'data_mismatch' | 'error'

type PersonalDataClient = {
  columnIndex: number
  firstName: string
  secondName: string
  sheetMarket: string
  stack: string
  chatId: string
  profileId: string
  sheetProxyName: string
}

type SafeDolphinProxy = {
  id?: number | string
  name: string
  type?: string
  browserProfilesCount?: number
  lastCheckStatus?: boolean | null
}

type DolphinProfileSnapshot = {
  id: string
  name?: string
  proxyId?: string
  proxy?: SafeDolphinProxy | null
}

type DolphinProfileNameCandidate = {
  format: 'firstname_stack_market' | 'firstname_secondname_stack_market'
  name: string
}

type ProxyNameValidation = {
  valid: boolean
  format?: 'legacy' | 'standard'
  issues: string[]
  parts: string[]
}

type ProxyCheckResult = {
  market: Market
  status: ProxyCheckStatus
  issues: string[]
  notes: string[]
  columnIndex: number
  firstName: string
  secondName: string
  sheetMarket: string
  stack: string
  expectedStackMarket: string
  chatId: string
  profileId: string
  sheetProxyName: string
  checkedProxyName: string
  checkedProxySource: 'attached' | 'inventory' | 'sheet' | 'none'
  proxyNameValidation?: ProxyNameValidation
  dolphinProfile?: DolphinProfileSnapshot
  profileNameCandidates: DolphinProfileNameCandidate[]
  matchedExistingProfiles: DolphinProfileSnapshot[]
  inventoryProxy?: SafeDolphinProxy
  inventoryProxyMatches: number
  checkedAt: string
}

type ClassifyClientInput = {
  client: PersonalDataClient
  market: Market
  dolphinProfile?: DolphinProfileSnapshot
  dolphinProfileError?: string
  matchedExistingProfiles?: DolphinProfileSnapshot[]
  inventoryProxyMatches: SafeDolphinProxy[]
  checkedAt?: string
}

type SheetRows = Record<
  | 'name'
  | 'fullName'
  | 'stack'
  | 'market'
  | 'chatId'
  | 'profileId'
  | 'proxy',
  number
>

function normalizeSheetValue(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeKey(value: unknown): string {
  return normalizeSheetValue(value).toLowerCase()
}

function normalizeLookupKey(value: unknown): string {
  return normalizeKey(value).replace(/\s+/g, ' ')
}

function normalizeMarket(value: unknown): Market {
  const normalized = normalizeKey(value)

  if (!normalized || normalized === 'en') {
    return 'En'
  }

  if (normalized === 'ru') {
    return 'Ru'
  }

  throw new Error(`Unsupported market: ${String(value)}`)
}

function getMarketLabels(market: Market): { profileId: string; proxy: string } {
  return {
    profileId: `Dolphin Profile ${market} Id`,
    proxy: `Прокси ${market}`
  }
}

function findRowIndexByLabel(values: string[][], label: string): number {
  const normalizedLabel = normalizeKey(label)
  const rowIndex = values.findIndex(row =>
    row.some(cell => normalizeKey(cell) === normalizedLabel)
  )

  if (rowIndex === -1) {
    throw new Error(`Row label "${label}" was not found in ПЕРС ДАННЫЕ`)
  }

  return rowIndex
}

function findRowIndexOptionalByLabel(
  values: string[][],
  label: string
): number | undefined {
  const normalizedLabel = normalizeKey(label)
  const rowIndex = values.findIndex(row =>
    row.some(cell => normalizeKey(cell) === normalizedLabel)
  )

  return rowIndex === -1 ? undefined : rowIndex
}

function findRowIndexByLabelInSection(
  values: string[][],
  sectionLabel: string,
  label: string
): number {
  const sectionStartRowIndex = findRowIndexByLabel(values, sectionLabel)
  const normalizedSectionLabel = normalizeKey(sectionLabel)
  const normalizedLabel = normalizeKey(label)

  for (
    let rowIndex = sectionStartRowIndex;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row = values[rowIndex] ?? []

    if (
      rowIndex > sectionStartRowIndex &&
      row.some(cell => normalizeKey(cell) === normalizedSectionLabel)
    ) {
      break
    }

    if (row.some(cell => normalizeKey(cell) === normalizedLabel)) {
      return rowIndex
    }
  }

  throw new Error(
    `Row label "${label}" was not found in "${sectionLabel}" section`
  )
}

function findLabelColumnIndex(row: string[], label: string): number {
  const normalizedLabel = normalizeKey(label)
  const columnIndex = row.findIndex(cell => normalizeKey(cell) === normalizedLabel)

  if (columnIndex === -1) {
    throw new Error(`Column label "${label}" was not found in its row`)
  }

  return columnIndex
}

function getCell(values: string[][], rowIndex: number, columnIndex: number): string {
  return normalizeSheetValue(values[rowIndex]?.[columnIndex])
}

function getGroupedCell(
  values: string[][],
  rowIndex: number,
  columnIndex: number
): string {
  let value = ''

  for (let index = 0; index <= columnIndex; index += 1) {
    const explicitValue = getCell(values, rowIndex, index)

    if (explicitValue) {
      value = explicitValue
    }
  }

  return value
}

function isMarketEnabledForClient(sheetMarket: string, market: Market): boolean {
  const marketTokens = normalizeKey(sheetMarket)
    .split(/[^a-z]+/)
    .filter(Boolean)

  return marketTokens.includes(normalizeKey(market))
}

function getRequiredSheetRows(values: string[][], market: Market): SheetRows {
  const labels = getMarketLabels(market)

  return {
    name: findRowIndexByLabel(values, 'имя'),
    fullName: findRowIndexByLabelInSection(values, 'Реальные данные', 'ФИО'),
    stack: findRowIndexByLabel(values, 'стек'),
    market: findRowIndexByLabel(values, 'рынок'),
    chatId: findRowIndexByLabel(values, 'Id общего чата'),
    profileId: findRowIndexByLabel(values, labels.profileId),
    proxy: findRowIndexOptionalByLabel(values, labels.proxy) ?? -1
  }
}

function parsePersonalDataClients(
  values: string[][],
  market: Market
): PersonalDataClient[] {
  const rows = getRequiredSheetRows(values, market)
  const nameRow = values[rows.name] ?? []
  const nameLabelColumnIndex = findLabelColumnIndex(nameRow, 'имя')
  const clients: PersonalDataClient[] = []

  for (
    let columnIndex = nameLabelColumnIndex + 1;
    columnIndex < nameRow.length;
    columnIndex += 1
  ) {
    const firstName = getCell(values, rows.name, columnIndex)
    const chatId = getCell(values, rows.chatId, columnIndex)
    const sheetMarket = getGroupedCell(values, rows.market, columnIndex)

    if (!firstName || !chatId) {
      continue
    }

    if (!isMarketEnabledForClient(sheetMarket, market)) {
      continue
    }

    clients.push({
      columnIndex,
      firstName,
      secondName: getCell(values, rows.fullName, columnIndex),
      sheetMarket,
      stack: getGroupedCell(values, rows.stack, columnIndex),
      chatId,
      profileId: getCell(values, rows.profileId, columnIndex),
      sheetProxyName: getCell(values, rows.proxy, columnIndex)
    })
  }

  return clients
}

function splitProxyName(name: string): string[] {
  return name.split('|').map(part => part.trim())
}

function validateProxyName(
  proxyName: string,
  client: PersonalDataClient,
  _market: Market
): ProxyNameValidation {
  const parts = splitProxyName(proxyName)
  const issues: string[] = []

  if (parts.length !== 4 && parts.length !== 5) {
    return {
      valid: false,
      issues: ['invalid_proxy_name_part_count'],
      parts
    }
  }

  const isLegacy = parts.length === 5
  const format = isLegacy ? 'legacy' : 'standard'
  const profileId = isLegacy ? (parts[1] ?? '') : ''
  const chatId = isLegacy ? (parts[3] ?? '') : (parts[2] ?? '')

  if (isLegacy && profileId !== client.profileId) {
    issues.push('profile_id_mismatch')
  }

  if (chatId !== client.chatId) {
    issues.push('chat_id_mismatch')
  }

  return {
    valid: issues.length === 0,
    format,
    issues,
    parts
  }
}

function getSafeProxyName(proxy: SafeDolphinProxy | null | undefined): string {
  return normalizeSheetValue(proxy?.name)
}

function looksLikeProxyConnectionValue(value: string): boolean {
  const normalized = normalizeKey(value)

  return (
    normalized.includes('://') ||
    normalized.includes('@') ||
    /^[a-z0-9.-]+:\d+/.test(normalized)
  )
}

function hasUsableProfileId(profileId: string): boolean {
  return /^\d+$/.test(profileId)
}

function findExactProxyMatches(
  proxies: SafeDolphinProxy[],
  proxyName: string
): SafeDolphinProxy[] {
  const normalizedProxyName = normalizeSheetValue(proxyName)

  if (!normalizedProxyName) {
    return []
  }

  return proxies.filter(proxy => getSafeProxyName(proxy) === normalizedProxyName)
}

function getSecondNameCandidate(client: PersonalDataClient): string {
  const firstNameKey = normalizeLookupKey(client.firstName)
  const fullNameTokens = normalizeSheetValue(client.secondName)
    .split(/[\s/|]+/)
    .map(token => token.trim())
    .filter(Boolean)

  for (const token of fullNameTokens) {
    const tokenKey = normalizeLookupKey(token)

    if (tokenKey && !firstNameKey.split(' ').includes(tokenKey)) {
      return token
    }
  }

  return ''
}

function getDolphinProfileNameCandidates(
  client: PersonalDataClient,
  market: Market
): DolphinProfileNameCandidate[] {
  const candidates: DolphinProfileNameCandidate[] = []
  const firstName = normalizeSheetValue(client.firstName)
  const secondName = getSecondNameCandidate(client)
  const stack = normalizeSheetValue(client.stack)

  if (!firstName || !stack) {
    return candidates
  }

  candidates.push({
    format: 'firstname_stack_market',
    name: `${firstName} ${stack} ${market}`
  })

  if (secondName) {
    candidates.push({
      format: 'firstname_secondname_stack_market',
      name: `${firstName} ${secondName} ${stack} ${market}`
    })
  }

  return candidates
}

function findMatchingExistingProfiles(
  profiles: DolphinProfileSnapshot[],
  client: PersonalDataClient,
  market: Market
): DolphinProfileSnapshot[] {
  const candidateKeys = new Set(
    getDolphinProfileNameCandidates(client, market).map(candidate =>
      normalizeLookupKey(candidate.name)
    )
  )

  return profiles.filter(profile => candidateKeys.has(normalizeLookupKey(profile.name)))
}

function classifyProxyClient(input: ClassifyClientInput): ProxyCheckResult {
  const {
    client,
    market,
    dolphinProfile,
    dolphinProfileError,
    matchedExistingProfiles = []
  } = input
  const issues: string[] = []
  const notes: string[] = []
  const checkedAt = input.checkedAt ?? new Date().toISOString()
  const expectedStackMarket = `${client.stack} ${market}`.trim()
  const profileNameCandidates = getDolphinProfileNameCandidates(client, market)
  const attachedProxyName = getSafeProxyName(dolphinProfile?.proxy)
  const hasAttachedProxy = Boolean(dolphinProfile?.proxy || dolphinProfile?.proxyId)
  const sheetProxyName = normalizeSheetValue(client.sheetProxyName)
  const inventoryProxyMatches = input.inventoryProxyMatches
  const inventoryProxy = inventoryProxyMatches[0]
  let status: ProxyCheckStatus = 'ok'
  let checkedProxyName = ''
  let checkedProxySource: ProxyCheckResult['checkedProxySource'] = 'none'
  let proxyNameValidation: ProxyNameValidation | undefined

  if (!client.profileId) {
    issues.push('missing_profile_id')

    if (matchedExistingProfiles.length) {
      issues.push('profile_exists_but_not_connected')
    }

    status = 'error'
  } else if (!hasUsableProfileId(client.profileId)) {
    issues.push('invalid_profile_id')
    status = 'error'
  } else if (dolphinProfileError) {
    issues.push('dolphin_profile_error')
    notes.push(dolphinProfileError)
    status = 'error'
  } else if (!sheetProxyName && !hasAttachedProxy) {
    status = 'needs_proxy'
  } else if (!sheetProxyName && hasAttachedProxy) {
    issues.push('sheet_missing_api_has_proxy')
    status = 'data_mismatch'
    checkedProxyName = attachedProxyName
    checkedProxySource = 'attached'
  } else if (sheetProxyName && hasAttachedProxy) {
    checkedProxyName = attachedProxyName
    checkedProxySource = 'attached'

    if (
      attachedProxyName &&
      attachedProxyName !== sheetProxyName &&
      !looksLikeProxyConnectionValue(sheetProxyName)
    ) {
      notes.push('sheet_proxy_differs_from_api')
    }
  } else if (sheetProxyName && !hasAttachedProxy) {
    checkedProxyName = sheetProxyName
    checkedProxySource = inventoryProxy ? 'inventory' : 'sheet'

    if (inventoryProxy) {
      notes.push('proxy_exists_not_attached')
    } else {
      issues.push('sheet_has_proxy_api_missing_proxy')
      status = 'data_mismatch'
    }
  }

  if (inventoryProxyMatches.length > 1) {
    notes.push('multiple_inventory_proxies_same_name')
  }

  if (checkedProxySource === 'attached' && !checkedProxyName) {
    issues.push('invalid_proxy_name', 'attached_proxy_name_missing')
    status = 'error'
  }

  if (checkedProxyName) {
    proxyNameValidation = validateProxyName(checkedProxyName, client, market)

    if (!proxyNameValidation.valid) {
      issues.push('invalid_proxy_name', ...proxyNameValidation.issues)
      status = 'error'
    }
  }

  return {
    market,
    status,
    issues: [...new Set(issues)],
    notes: [...new Set(notes)],
    columnIndex: client.columnIndex,
    firstName: client.firstName,
    secondName: client.secondName,
    sheetMarket: client.sheetMarket,
    stack: client.stack,
    expectedStackMarket,
    chatId: client.chatId,
    profileId: client.profileId,
    sheetProxyName,
    checkedProxyName,
    checkedProxySource,
    proxyNameValidation,
    dolphinProfile,
    profileNameCandidates,
    matchedExistingProfiles,
    inventoryProxy,
    inventoryProxyMatches: inventoryProxyMatches.length,
    checkedAt
  }
}

module.exports = {
  classifyProxyClient,
  findMatchingExistingProfiles,
  findExactProxyMatches,
  getDolphinProfileNameCandidates,
  normalizeMarket,
  parsePersonalDataClients,
  validateProxyName
}
