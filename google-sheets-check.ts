require('dotenv').config({ quiet: true })

const fs = require('node:fs/promises')
const path = require('node:path')
const { google } = require('googleapis')

const GOOGLE_KEY_FILE = path.resolve(
  __dirname,
  'project-f5183b61-c5a8-4384-bc9-10f265644c86.json'
)

const spreadsheetIdFromEnv: string | undefined =
  process.env.google_spreadsheet_id
const GOOGLE_SHEET_EXPORT_FILE = path.resolve(
  __dirname,
  'google-sheet-export.json'
)
const CLIENT_STACK_MAPPING_EXPORT_FILE = path.resolve(
  __dirname,
  'client-stack-mapping.json'
)
const PERSONAL_DATA_SHEET_NAME = 'ПЕРС ДАННЫЕ'
const DOLPHIN_MAIN_SHEET_NAME = 'Dolphin main'
const STACKS_SHEET_NAME = 'Стеки'
const DOLPHIN_MAIN_NAME_LABEL = 'имя'
const DOLPHIN_MAIN_STACK_LABEL = 'СТЕК'
const tableToVarsTranslations: Record<
  keyof typeof TableToVarsTranslations,
  TableToVarsTranslations
> = {
  // TODO: get rid of strings, it must be just enum reuse
  telegram: 'ТГ' as TableToVarsTranslations.telegram,
  stack: 'стек' as TableToVarsTranslations.stack,
  hhRuPhoneNumber: 'rusPhoneNumber' as TableToVarsTranslations.hhRuPhoneNumber,
  hhEmail: 'emailHH' as TableToVarsTranslations.hhEmail,
  hhEmailPassword: 'passwordEmailHH' as TableToVarsTranslations.hhEmailPassword,
  hhPassword: 'passwordHH' as TableToVarsTranslations.hhPassword,
  dolphinProfileId:
    'Dolphin Profile Id' as TableToVarsTranslations.dolphinProfileId,
  dolphinProfileRuId:
    'Dolphin Profile Ru Id' as TableToVarsTranslations.dolphinProfileRuId,
  dolphinProfileEnId:
    'Dolphin Profile En Id' as TableToVarsTranslations.dolphinProfileEnId,
  ruResponses: 'Делаем отклики Ru' as TableToVarsTranslations.ruResponses,
  enResponses: 'Делаем отклики En' as TableToVarsTranslations.enResponses,
  commonChatId: 'Id общего чата' as TableToVarsTranslations.commonChatId,
  dolphinMainTelegramId:
    'ТГ id' as TableToVarsTranslations.dolphinMainTelegramId,
  coverRu: 'Сопровод Ru' as TableToVarsTranslations.coverRu,
  coverEn: 'Сопровод En' as TableToVarsTranslations.coverEn
}

type SpreadsheetCandidate = {
  id: string
  name: string
}

type SheetInfo = {
  spreadsheetTitle: string
  firstSheetTitle: string
  sheetTitles: string[]
}

type NameTelegramAccount = {
  name: string
  telegram: string
  dolphinProfileId?: number
}

type ClientStackMapping = {
  clientName: string
  stack: string
  market?: string
  stackSheetName: string
  stackScenario?: string
}

type ClientAutomationMapping = ClientStackMapping & {
  market: 'Ru' | 'En'
  dolphinProfileId: number
  commonChatId: string
  coverText?: string
}

type ClientHHAuthCredentials = {
  clientName: string
  phone: string
  rawPhone: string
  password: string
  email?: string
  emailPassword?: string
}

type ClientsStackMappingExport = {
  exportedAt: string
  spreadsheetId: string
  spreadsheetTitle: string
  personalDataSheetName: string
  stacksSheetName: string
  allowedStacks: string[]
  workWithRuOnly: boolean
  total: number
  mappings: ClientStackMapping[]
}

type MapClientsByAllowedStacksOptions = {
  workWithRuOnly?: boolean
}

type AutomationMappingOptions = {
  workWithRuOnly?: boolean
}

async function createGoogleAuth() {
  return new google.auth.GoogleAuth({
    keyFile: GOOGLE_KEY_FILE,
    scopes: [
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ]
  })
}

async function findFirstAccessibleSpreadsheet(
  auth: any
): Promise<SpreadsheetCandidate> {
  const drive = google.drive({ version: 'v3', auth })
  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id, name)',
    pageSize: 1
  })

  const file = response.data.files?.[0]

  if (!file?.id || !file?.name) {
    throw new Error(
      'No Google Sheets are visible to this service account. Share a sheet with the service account email or set google_spreadsheet_id in .env.'
    )
  }

  return {
    id: file.id,
    name: file.name
  }
}

async function getSheetInfo(
  auth: any,
  spreadsheetId: string
): Promise<SheetInfo> {
  const sheets = google.sheets({ version: 'v4', auth })
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties.title'
  })

  const firstSheetTitle = response.data.sheets?.[0]?.properties?.title

  if (!firstSheetTitle) {
    throw new Error('Spreadsheet has no visible sheets.')
  }

  const spreadsheetTitle = response.data.properties?.title ?? spreadsheetId
  console.log(`Spreadsheet: ${spreadsheetTitle}`)

  return {
    spreadsheetTitle,
    firstSheetTitle,
    sheetTitles:
      response.data.sheets
        ?.map((sheet: any) => sheet.properties?.title)
        .filter(Boolean) ?? []
  }
}

async function resolveSpreadsheet(auth: any): Promise<SpreadsheetCandidate> {
  return spreadsheetIdFromEnv !== undefined
    ? { id: spreadsheetIdFromEnv, name: spreadsheetIdFromEnv }
    : await findFirstAccessibleSpreadsheet(auth)
}

async function fetchSheetValues(rangeOverride?: string): Promise<{
  spreadsheet: SpreadsheetCandidate
  spreadsheetTitle: string
  range: string
  values: string[][]
}> {
  const auth = await createGoogleAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheet = await resolveSpreadsheet(auth)
  const sheetInfo = await getSheetInfo(auth, spreadsheet.id)
  const range = rangeOverride ?? `'${sheetInfo.firstSheetTitle}'`

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheet.id,
    range
  })

  return {
    spreadsheet,
    spreadsheetTitle: sheetInfo.spreadsheetTitle,
    range,
    values: response.data.values ?? []
  }
}

async function fetchAllSheetValues(): Promise<{
  spreadsheet: SpreadsheetCandidate
  spreadsheetTitle: string
  sheets: Array<{
    title: string
    values: string[][]
  }>
}> {
  const auth = await createGoogleAuth()
  const sheetsApi = google.sheets({ version: 'v4', auth })
  const spreadsheet = await resolveSpreadsheet(auth)
  const sheetInfo = await getSheetInfo(auth, spreadsheet.id)
  const sheets = []

  for (const title of sheetInfo.sheetTitles) {
    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: spreadsheet.id,
      range: `'${title}'`
    })

    sheets.push({
      title,
      values: response.data.values ?? []
    })
  }

  return {
    spreadsheet,
    spreadsheetTitle: sheetInfo.spreadsheetTitle,
    sheets
  }
}

async function fetchNamedSheetValues(sheetNames: string[]): Promise<{
  spreadsheet: SpreadsheetCandidate
  spreadsheetTitle: string
  sheets: Array<{
    title: string
    values: string[][]
  }>
}> {
  const auth = await createGoogleAuth()
  const sheetsApi = google.sheets({ version: 'v4', auth })
  const spreadsheet = await resolveSpreadsheet(auth)
  const sheetInfo = await getSheetInfo(auth, spreadsheet.id)
  const availableSheetNames = new Map(
    sheetInfo.sheetTitles.map((title: string) => [normalizeKey(title), title])
  )
  const ranges = sheetNames.map(sheetName => {
    const title = availableSheetNames.get(normalizeKey(sheetName))

    if (!title) {
      throw new Error(`Sheet "${sheetName}" was not found`)
    }

    return `'${title}'`
  })
  const response = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId: spreadsheet.id,
    ranges
  })
  const valueRanges = response.data.valueRanges ?? []

  return {
    spreadsheet,
    spreadsheetTitle: sheetInfo.spreadsheetTitle,
    sheets: sheetNames.map((sheetName, index) => ({
      title: availableSheetNames.get(normalizeKey(sheetName)) ?? sheetName,
      values: valueRanges[index]?.values ?? []
    }))
  }
}

async function fetchMinimalSheetData(): Promise<void> {
  const result = await fetchSheetValues()
  const values = result.values.slice(0, 5).map(row => row.slice(0, 5))

  console.log(`Sheet file: ${result.spreadsheet.name}`)
  console.log(`Range: ${result.range}!A1:E5 preview`)
  console.log('Values:')
  console.log(JSON.stringify(values, null, 2))
}

async function exportSheetDataToJson(
  filePath = GOOGLE_SHEET_EXPORT_FILE
): Promise<string> {
  const result = await fetchSheetValues()
  const payload = {
    exportedAt: new Date().toISOString(),
    spreadsheetId: result.spreadsheet.id,
    spreadsheetTitle: result.spreadsheetTitle,
    range: result.range,
    rowCount: result.values.length,
    values: result.values
  }

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')

  console.log(`Sheet file: ${result.spreadsheet.name}`)
  console.log(`Saved ${payload.rowCount} rows to ${filePath}`)

  return filePath
}

function normalizeSheetValue(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeKey(value: unknown): string {
  return normalizeSheetValue(value).toLowerCase()
}

function isYes(value: unknown): boolean {
  return value === 'TRUE' || value === true || normalizeKey(value) === 'да'
}

function getRequiredSheet(
  sheets: Array<{
    title: string
    values: string[][]
  }>,
  expectedTitle: string
): string[][] {
  const sheet = sheets.find(
    item => normalizeKey(item.title) === normalizeKey(expectedTitle)
  )

  if (!sheet) {
    throw new Error(`Sheet "${expectedTitle}" was not found`)
  }

  return sheet.values
}

function findRowIndexByLabel(values: string[][], label: string): number {
  const normalizedLabel = normalizeKey(label)
  const rowIndex = values.findIndex(row =>
    row.some(cell => normalizeKey(cell) === normalizedLabel)
  )

  if (rowIndex === -1) {
    throw new Error(`Row label "${label}" was not found`)
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

function findColumnIndexByValue(row: string[], value: string): number {
  const normalizedValue = normalizeKey(value)
  const columnIndex = row.findIndex(
    cell => normalizeKey(cell) === normalizedValue
  )

  if (columnIndex === -1) {
    throw new Error(`Column value "${value}" was not found`)
  }

  return columnIndex
}

function findColumnIndexOptionalByValue(
  row: string[],
  value: string
): number | undefined {
  const normalizedValue = normalizeKey(value)
  const columnIndex = row.findIndex(
    cell => normalizeKey(cell) === normalizedValue
  )

  return columnIndex === -1 ? undefined : columnIndex
}

function findColumnIndexesByValue(row: string[], value: string): number[] {
  const normalizedValue = normalizeKey(value)
  const columnIndexes: number[] = []

  for (let index = 0; index < row.length; index += 1) {
    if (normalizeKey(row[index]) === normalizedValue) {
      columnIndexes.push(index)
    }
  }

  return columnIndexes
}

function getRowValueForClientColumn(
  personalDataValues: string[][],
  label: string,
  clientColumnIndex: number
): string {
  const rowIndex = findRowIndexByLabel(personalDataValues, label)

  return normalizeSheetValue(personalDataValues[rowIndex]?.[clientColumnIndex])
}

function getRowValueOptionalForClientColumn(
  values: string[][],
  label: string,
  clientColumnIndex: number | undefined
): string {
  if (clientColumnIndex === undefined) {
    return ''
  }

  const rowIndex = findRowIndexOptionalByLabel(values, label)

  if (rowIndex === undefined) {
    return ''
  }

  return normalizeSheetValue(values[rowIndex]?.[clientColumnIndex])
}

function getClientColumnIndex(
  personalDataValues: string[][],
  clientName: string
): number {
  const nameRowIndex = findRowIndexByLabel(personalDataValues, 'имя')

  return findColumnIndexByValue(personalDataValues[nameRowIndex], clientName)
}

function getClientColumnIndexOptional(
  values: string[][],
  clientName: string,
  nameLabel: string
): number | undefined {
  const nameRowIndex = findRowIndexOptionalByLabel(values, nameLabel)

  if (nameRowIndex === undefined) {
    return undefined
  }

  return findColumnIndexOptionalByValue(values[nameRowIndex] ?? [], clientName)
}

function getClientColumnIndexes(
  values: string[][],
  clientName: string,
  nameLabel: string
): number[] {
  const nameRowIndex = findRowIndexOptionalByLabel(values, nameLabel)

  if (nameRowIndex === undefined) {
    return []
  }

  return findColumnIndexesByValue(values[nameRowIndex] ?? [], clientName)
}

function getGroupedStackForClientColumn(
  personalDataValues: string[][],
  clientColumnIndex: number
): string {
  const stackLabel = tableToVarsTranslations.stack
  const stackRowIndex = findRowIndexByLabel(personalDataValues, stackLabel)
  const stackRow = personalDataValues[stackRowIndex] ?? []
  let stack = ''

  for (
    let columnIndex = 0;
    columnIndex <= clientColumnIndex;
    columnIndex += 1
  ) {
    const explicitStack = normalizeSheetValue(stackRow[columnIndex])

    if (explicitStack) {
      stack = explicitStack
    }
  }

  return stack
}

function getGroupedValueForClientColumn(
  values: string[][],
  label: string,
  clientColumnIndex: number | undefined
): string {
  if (clientColumnIndex === undefined) {
    return ''
  }

  const rowIndex = findRowIndexOptionalByLabel(values, label)
  const row = rowIndex === undefined ? [] : (values[rowIndex] ?? [])
  let value = ''

  for (
    let columnIndex = 0;
    columnIndex <= clientColumnIndex;
    columnIndex += 1
  ) {
    const explicitValue = normalizeSheetValue(row[columnIndex])

    if (explicitValue) {
      value = explicitValue
    }
  }

  return value
}

function findStackScenario(
  stacksValues: string[][],
  stack: string,
  market?: string
): string | undefined {
  const stackHeaders = stacksValues[0] ?? []
  const stackColumnIndex = findColumnIndexByValue(stackHeaders, stack)
  const normalizedMarket = normalizeKey(market)
  const marketRow = stacksValues.find(
    (row, index) => index > 0 && normalizeKey(row[0]) === normalizedMarket
  )

  return normalizeSheetValue(marketRow?.[stackColumnIndex]) || undefined
}

function normalizeAutomationStackForScenario(
  stack: string,
  clientName: string
): string {
  if (normalizeKey(stack) === 'frontend') {
    return normalizeKey(clientName) === 'кира' ? 'КИРА' : 'React'
  }

  return stack
}

function getAutomationStackForDolphinColumn(
  personalDataValues: string[][],
  dolphinMainValues: string[][],
  clientName: string,
  dolphinClientColumnIndex: number | undefined
): string {
  const dolphinStack = getGroupedValueForClientColumn(
    dolphinMainValues,
    DOLPHIN_MAIN_STACK_LABEL,
    dolphinClientColumnIndex
  )

  if (dolphinStack) {
    return normalizeAutomationStackForScenario(dolphinStack, clientName)
  }

  const personalClientColumnIndex = getClientColumnIndexOptional(
    personalDataValues,
    clientName,
    'имя'
  )
  const personalStack =
    personalClientColumnIndex === undefined
      ? ''
      : getGroupedStackForClientColumn(
          personalDataValues,
          personalClientColumnIndex
        )

  return personalStack
    ? normalizeAutomationStackForScenario(personalStack, clientName)
    : ''
}

function pickDolphinClientColumnForMarket(
  dolphinMainValues: string[][],
  clientName: string,
  market: 'Ru' | 'En'
): number | undefined {
  const dolphinClientColumnIndexes = getClientColumnIndexes(
    dolphinMainValues,
    clientName,
    DOLPHIN_MAIN_NAME_LABEL
  )
  const responseFlagLabel =
    market === 'Ru'
      ? tableToVarsTranslations.ruResponses
      : tableToVarsTranslations.enResponses

  return (
    dolphinClientColumnIndexes.find(columnIndex =>
      isYes(
        getRowValueOptionalForClientColumn(
          dolphinMainValues,
          responseFlagLabel,
          columnIndex
        )
      )
    ) ?? dolphinClientColumnIndexes[0]
  )
}

function getAutomationCoverText(
  dolphinMainValues: string[][],
  clientColumnIndex: number | undefined,
  market: 'Ru' | 'En'
): string | undefined {
  if (clientColumnIndex === undefined) {
    return undefined
  }

  const coverLabel =
    market === 'Ru'
      ? tableToVarsTranslations.coverRu
      : tableToVarsTranslations.coverEn

  return getRowValueOptionalForClientColumn(
    dolphinMainValues,
    coverLabel,
    clientColumnIndex
  )
}

function normalizeRuPhoneForHH(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '')

  if (
    digits.length === 11 &&
    (digits.startsWith('7') || digits.startsWith('8'))
  ) {
    return digits.slice(1)
  }

  return digits
}

function mapClientHHAuthCredentials(
  personalDataValues: string[][],
  clientName = 'Кира'
): ClientHHAuthCredentials {
  const clientColumnIndex = getClientColumnIndex(personalDataValues, clientName)
  const rawPhone = getRowValueOptionalForClientColumn(
    personalDataValues,
    tableToVarsTranslations.hhRuPhoneNumber,
    clientColumnIndex
  )
  const password = getRowValueOptionalForClientColumn(
    personalDataValues,
    tableToVarsTranslations.hhPassword,
    clientColumnIndex
  )
  const email = getRowValueOptionalForClientColumn(
    personalDataValues,
    tableToVarsTranslations.hhEmail,
    clientColumnIndex
  )
  const emailPassword = getRowValueOptionalForClientColumn(
    personalDataValues,
    tableToVarsTranslations.hhEmailPassword,
    clientColumnIndex
  )
  const phone = normalizeRuPhoneForHH(rawPhone)

  if (!rawPhone) {
    throw new Error(
      `HH rusPhoneNumber for client "${clientName}" was not found`
    )
  }

  if (!phone || phone.length !== 10) {
    throw new Error(
      `HH rusPhoneNumber for client "${clientName}" is invalid: ${rawPhone}`
    )
  }

  if (!password) {
    throw new Error(`HH passwordHH for client "${clientName}" was not found`)
  }

  return {
    clientName,
    phone,
    rawPhone,
    password,
    email: email || undefined,
    emailPassword: emailPassword || undefined
  }
}

function mapClientAutomationData(
  personalDataValues: string[][],
  dolphinMainValues: string[][],
  stacksValues: string[][],
  clientName = 'Кира',
  market: 'Ru' | 'En' = 'Ru'
): ClientAutomationMapping {
  const personalClientColumnIndex = getClientColumnIndexOptional(
    personalDataValues,
    clientName,
    'имя'
  )
  const selectedDolphinClientColumnIndex = pickDolphinClientColumnForMarket(
    dolphinMainValues,
    clientName,
    market
  )
  const stack = getAutomationStackForDolphinColumn(
    personalDataValues,
    dolphinMainValues,
    clientName,
    selectedDolphinClientColumnIndex
  )
  const profileIdLabel =
    market === 'Ru'
      ? tableToVarsTranslations.dolphinProfileRuId
      : tableToVarsTranslations.dolphinProfileEnId
  const responseFlagLabel =
    market === 'Ru'
      ? tableToVarsTranslations.ruResponses
      : tableToVarsTranslations.enResponses
  const rawDolphinProfileId =
    getRowValueOptionalForClientColumn(
      dolphinMainValues,
      profileIdLabel,
      selectedDolphinClientColumnIndex
    ) ||
    getRowValueOptionalForClientColumn(
      personalDataValues,
      profileIdLabel,
      personalClientColumnIndex
    )
  const responseFlag =
    getRowValueOptionalForClientColumn(
      dolphinMainValues,
      responseFlagLabel,
      selectedDolphinClientColumnIndex
    ) ||
    getRowValueOptionalForClientColumn(
      personalDataValues,
      responseFlagLabel,
      personalClientColumnIndex
    )
  const commonChatId =
    getRowValueOptionalForClientColumn(
      dolphinMainValues,
      tableToVarsTranslations.commonChatId,
      selectedDolphinClientColumnIndex
    ) ||
    getRowValueOptionalForClientColumn(
      dolphinMainValues,
      tableToVarsTranslations.dolphinMainTelegramId,
      selectedDolphinClientColumnIndex
    ) ||
    getRowValueOptionalForClientColumn(
      personalDataValues,
      tableToVarsTranslations.commonChatId,
      personalClientColumnIndex
    )
  const coverText = getAutomationCoverText(
    dolphinMainValues,
    selectedDolphinClientColumnIndex,
    market
  )
  const dolphinProfileId = Number(rawDolphinProfileId)

  if (
    personalClientColumnIndex === undefined &&
    selectedDolphinClientColumnIndex === undefined
  ) {
    throw new Error(`Client "${clientName}" was not found in automation sheets`)
  }

  if (!stack) {
    throw new Error(`Stack for client "${clientName}" was not found`)
  }

  if (!commonChatId) {
    throw new Error(`Common chat id for client "${clientName}" was not found`)
  }

  if (!isYes(responseFlag)) {
    throw new Error(
      `Responses for client "${clientName}" on market "${market}" are disabled`
    )
  }

  if (!Number.isFinite(dolphinProfileId)) {
    throw new Error(
      `${profileIdLabel} for client "${clientName}" is invalid: ${rawDolphinProfileId || 'empty'}`
    )
  }

  return {
    clientName,
    stack,
    market,
    dolphinProfileId,
    commonChatId,
    coverText,
    stackSheetName: STACKS_SHEET_NAME,
    stackScenario: findStackScenario(stacksValues, stack, market)
  }
}

function mapClientAutomationDataFromPersonalOnly(
  personalDataValues: string[][],
  stacksValues: string[][],
  clientName = 'Кира',
  market: 'Ru' | 'En' = 'Ru'
): ClientAutomationMapping {
  const clientColumnIndex = getClientColumnIndex(personalDataValues, clientName)
  const stack = getGroupedStackForClientColumn(
    personalDataValues,
    clientColumnIndex
  )
  const profileIdLabel =
    market === 'Ru'
      ? tableToVarsTranslations.dolphinProfileRuId
      : tableToVarsTranslations.dolphinProfileEnId
  const responseFlagLabel =
    market === 'Ru'
      ? tableToVarsTranslations.ruResponses
      : tableToVarsTranslations.enResponses
  const rawDolphinProfileId = getRowValueForClientColumn(
    personalDataValues,
    profileIdLabel,
    clientColumnIndex
  )
  const responseFlag = getRowValueForClientColumn(
    personalDataValues,
    responseFlagLabel,
    clientColumnIndex
  )
  const commonChatId = getRowValueForClientColumn(
    personalDataValues,
    tableToVarsTranslations.commonChatId,
    clientColumnIndex
  )
  const dolphinProfileId = Number(rawDolphinProfileId)

  if (!stack) {
    throw new Error(`Stack for client "${clientName}" was not found`)
  }

  if (!commonChatId) {
    throw new Error(`Common chat id for client "${clientName}" was not found`)
  }

  if (!isYes(responseFlag)) {
    throw new Error(
      `Responses for client "${clientName}" on market "${market}" are disabled`
    )
  }

  if (!Number.isFinite(dolphinProfileId)) {
    throw new Error(
      `${profileIdLabel} for client "${clientName}" is invalid: ${rawDolphinProfileId || 'empty'}`
    )
  }

  return {
    clientName,
    stack,
    market,
    dolphinProfileId,
    commonChatId,
    stackSheetName: STACKS_SHEET_NAME,
    stackScenario: findStackScenario(stacksValues, stack, market)
  }
}

async function getClientAutomationData(
  clientName = 'Кира'
): Promise<ClientAutomationMapping> {
  const result = await fetchNamedSheetValues([
    PERSONAL_DATA_SHEET_NAME,
    DOLPHIN_MAIN_SHEET_NAME,
    STACKS_SHEET_NAME
  ])
  const personalDataValues = getRequiredSheet(
    result.sheets,
    PERSONAL_DATA_SHEET_NAME
  )
  const dolphinMainValues = getRequiredSheet(
    result.sheets,
    DOLPHIN_MAIN_SHEET_NAME
  )
  const stacksValues = getRequiredSheet(result.sheets, STACKS_SHEET_NAME)

  return mapClientAutomationData(
    personalDataValues,
    dolphinMainValues,
    stacksValues,
    clientName
  )
}

async function getClientHHAuthCredentials(
  clientName = 'Кира'
): Promise<ClientHHAuthCredentials> {
  const result = await fetchNamedSheetValues([PERSONAL_DATA_SHEET_NAME])
  const personalDataValues = getRequiredSheet(
    result.sheets,
    PERSONAL_DATA_SHEET_NAME
  )

  return mapClientHHAuthCredentials(personalDataValues, clientName)
}

function mapAllClientsAutomationData(
  personalDataValues: string[][],
  dolphinMainValues: string[][],
  stacksValues: string[][],
  options: AutomationMappingOptions = {}
): ClientAutomationMapping[] {
  const workWithRuOnly = options.workWithRuOnly ?? true
  const nameRowIndex = findRowIndexByLabel(
    dolphinMainValues,
    DOLPHIN_MAIN_NAME_LABEL
  )
  const nameRow = dolphinMainValues[nameRowIndex] ?? []
  const firstClientColumnIndex =
    findColumnIndexByValue(nameRow, DOLPHIN_MAIN_NAME_LABEL) + 1
  const mappings: ClientAutomationMapping[] = []

  for (
    let columnIndex = firstClientColumnIndex;
    columnIndex < nameRow.length;
    columnIndex += 1
  ) {
    const clientName = normalizeSheetValue(nameRow[columnIndex])
    const commonChatId =
      getRowValueOptionalForClientColumn(
        dolphinMainValues,
        tableToVarsTranslations.commonChatId,
        columnIndex
      ) ||
      getRowValueOptionalForClientColumn(
        dolphinMainValues,
        tableToVarsTranslations.dolphinMainTelegramId,
        columnIndex
      ) ||
      getRowValueOptionalForClientColumn(
        personalDataValues,
        tableToVarsTranslations.commonChatId,
        getClientColumnIndexOptional(personalDataValues, clientName, 'имя')
      )

    if (!clientName || !commonChatId) {
      continue
    }

    const stack = getAutomationStackForDolphinColumn(
      personalDataValues,
      dolphinMainValues,
      clientName,
      columnIndex
    )

    if (!stack) {
      throw new Error(`Stack for client "${clientName}" was not found`)
    }

    const marketConfigs: Array<{
      market: 'Ru' | 'En'
      enabled: boolean
      rawDolphinProfileId: string
      profileIdLabel: TableToVarsTranslations
      coverText?: string
    }> = [
      {
        market: 'Ru',
        enabled: isYes(
          getRowValueOptionalForClientColumn(
            dolphinMainValues,
            tableToVarsTranslations.ruResponses,
            columnIndex
          )
        ),
        rawDolphinProfileId: getRowValueOptionalForClientColumn(
          dolphinMainValues,
          tableToVarsTranslations.dolphinProfileRuId,
          columnIndex
        ),
        profileIdLabel: tableToVarsTranslations.dolphinProfileRuId,
        coverText: getAutomationCoverText(dolphinMainValues, columnIndex, 'Ru')
      },
      {
        market: 'En',
        enabled: isYes(
          getRowValueOptionalForClientColumn(
            dolphinMainValues,
            tableToVarsTranslations.enResponses,
            columnIndex
          )
        ),
        rawDolphinProfileId: getRowValueOptionalForClientColumn(
          dolphinMainValues,
          tableToVarsTranslations.dolphinProfileEnId,
          columnIndex
        ),
        profileIdLabel: tableToVarsTranslations.dolphinProfileEnId,
        coverText: getAutomationCoverText(dolphinMainValues, columnIndex, 'En')
      }
    ]

    for (const config of marketConfigs) {
      if (!config.enabled) {
        continue
      }

      if (workWithRuOnly && config.market !== 'Ru') {
        continue
      }

      const dolphinProfileId = Number(config.rawDolphinProfileId)

      if (!Number.isFinite(dolphinProfileId)) {
        throw new Error(
          `${config.profileIdLabel} for client "${clientName}" is invalid: ${config.rawDolphinProfileId || 'empty'}`
        )
      }

      mappings.push({
        clientName,
        stack,
        market: config.market,
        dolphinProfileId,
        commonChatId,
        coverText: config.coverText,
        stackSheetName: STACKS_SHEET_NAME,
        stackScenario: findStackScenario(stacksValues, stack, config.market)
      })
    }
  }

  return mappings
}

async function getAllClientsAutomationData(
  options: AutomationMappingOptions = {}
): Promise<ClientAutomationMapping[]> {
  const result = await fetchAllSheetValues()
  const personalDataValues = getRequiredSheet(
    result.sheets,
    PERSONAL_DATA_SHEET_NAME
  )
  const dolphinMainValues = getRequiredSheet(
    result.sheets,
    DOLPHIN_MAIN_SHEET_NAME
  )
  const stacksValues = getRequiredSheet(result.sheets, STACKS_SHEET_NAME)

  return mapAllClientsAutomationData(
    personalDataValues,
    dolphinMainValues,
    stacksValues,
    options
  )
}

function mapClientStack(
  personalDataValues: string[][],
  stacksValues: string[][],
  clientName: string
): ClientStackMapping {
  const stackLabel = tableToVarsTranslations.stack
  const nameRowIndex = findRowIndexByLabel(personalDataValues, 'имя')
  const stackRowIndex = findRowIndexByLabel(personalDataValues, stackLabel)
  const clientColumnIndex = findColumnIndexByValue(
    personalDataValues[nameRowIndex],
    clientName
  )
  const stack = normalizeSheetValue(
    personalDataValues[stackRowIndex]?.[clientColumnIndex]
  )
  const marketRowIndex = findRowIndexByLabel(personalDataValues, 'рынок')
  const market = normalizeSheetValue(
    personalDataValues[marketRowIndex]?.[clientColumnIndex]
  )

  if (!stack) {
    throw new Error(`Stack for client "${clientName}" was not found`)
  }

  return {
    clientName,
    stack,
    market: market || undefined,
    stackSheetName: STACKS_SHEET_NAME,
    stackScenario: findStackScenario(stacksValues, stack, market)
  }
}

function mapClientsByAllowedStacks(
  personalDataValues: string[][],
  stacksValues: string[][],
  allowedStacks: string[],
  options: MapClientsByAllowedStacksOptions = {}
): ClientStackMapping[] {
  const stackLabel = tableToVarsTranslations.stack
  const workWithRuOnly = options.workWithRuOnly ?? true
  const normalizedAllowedStacks = new Set(allowedStacks.map(normalizeKey))
  const nameRowIndex = findRowIndexByLabel(personalDataValues, 'имя')
  const stackRowIndex = findRowIndexByLabel(personalDataValues, stackLabel)
  const marketRowIndex = findRowIndexByLabel(personalDataValues, 'рынок')
  const nameRow = personalDataValues[nameRowIndex] ?? []
  const stackRow = personalDataValues[stackRowIndex] ?? []
  const marketRow = personalDataValues[marketRowIndex] ?? []
  const mappings: ClientStackMapping[] = []
  let currentStack = ''

  for (let columnIndex = 0; columnIndex < nameRow.length; columnIndex += 1) {
    const clientName = normalizeSheetValue(nameRow[columnIndex])
    const explicitStack = normalizeSheetValue(stackRow[columnIndex])
    const market = normalizeSheetValue(marketRow[columnIndex])

    if (explicitStack) {
      currentStack = explicitStack
    }

    const stack = currentStack

    if (
      !clientName ||
      !stack ||
      !normalizedAllowedStacks.has(normalizeKey(stack))
    ) {
      continue
    }

    if (workWithRuOnly && normalizeKey(market) !== 'ru') {
      continue
    }

    mappings.push({
      clientName,
      stack,
      market: market || undefined,
      stackSheetName: STACKS_SHEET_NAME,
      stackScenario: findStackScenario(stacksValues, stack, market)
    })
  }

  return mappings
}

async function exportClientsStackMapping(
  allowedStacks = ['Кира', 'PYTHON'],
  workWithRuOnly = true,
  filePath = CLIENT_STACK_MAPPING_EXPORT_FILE
): Promise<ClientStackMapping[]> {
  const result = await fetchAllSheetValues()
  const personalDataValues = getRequiredSheet(
    result.sheets,
    PERSONAL_DATA_SHEET_NAME
  )
  const stacksValues = getRequiredSheet(result.sheets, STACKS_SHEET_NAME)
  const mappings = mapClientsByAllowedStacks(
    personalDataValues,
    stacksValues,
    allowedStacks,
    {
      workWithRuOnly
    }
  )
  const payload: ClientsStackMappingExport = {
    exportedAt: new Date().toISOString(),
    spreadsheetId: result.spreadsheet.id,
    spreadsheetTitle: result.spreadsheetTitle,
    personalDataSheetName: PERSONAL_DATA_SHEET_NAME,
    stacksSheetName: STACKS_SHEET_NAME,
    allowedStacks,
    workWithRuOnly,
    total: mappings.length,
    mappings
  }

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')

  console.log(mappings)
  console.log(`Client stack mappings saved to ${filePath}`)

  return mappings
}

async function exportClientStackMapping(
  clientName = 'Кира',
  filePath = CLIENT_STACK_MAPPING_EXPORT_FILE
): Promise<ClientStackMapping> {
  const result = await fetchAllSheetValues()
  const personalDataValues = getRequiredSheet(
    result.sheets,
    PERSONAL_DATA_SHEET_NAME
  )
  const stacksValues = getRequiredSheet(result.sheets, STACKS_SHEET_NAME)
  const mapping = mapClientStack(personalDataValues, stacksValues, clientName)

  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        spreadsheetId: result.spreadsheet.id,
        spreadsheetTitle: result.spreadsheetTitle,
        personalDataSheetName: PERSONAL_DATA_SHEET_NAME,
        stacksSheetName: STACKS_SHEET_NAME,
        mapping
      },
      null,
      2
    ),
    'utf8'
  )

  console.log(mapping)
  console.log(`Client stack mapping saved to ${filePath}`)

  return mapping
}

function mapNamesWithTelegramAccounts(
  values: string[][]
): NameTelegramAccount[] {
  const normalize = (value: unknown) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
  const isNameHeader = (header: string) => ['имя', 'name'].includes(header)
  const isTelegramHeader = (header: string) =>
    [
      'tg',
      'telegram',
      'телеграм',
      'тг',
      'тг аккаунт',
      'telegram account',
      'tg account'
    ].includes(header)

  const dedupeAccounts = (accounts: NameTelegramAccount[]) => {
    const seen = new Set<string>()

    return accounts.filter(account => {
      const key = `${account.name}\u0000${account.telegram.toLowerCase()}`

      if (seen.has(key)) {
        return false
      }

      seen.add(key)

      return true
    })
  }

  const headerRowIndex = values.findIndex(row => {
    const normalizedHeaders = row.map(normalize)

    return (
      normalizedHeaders.some(isNameHeader) &&
      normalizedHeaders.some(isTelegramHeader)
    )
  })

  if (headerRowIndex !== -1) {
    const headers = values[headerRowIndex]
    const rows = values.slice(headerRowIndex + 1)
    const normalizedHeaders = headers.map(normalize)
    const nameColumnIndex = normalizedHeaders.findIndex(isNameHeader)
    const telegramColumnIndex = normalizedHeaders.findIndex(isTelegramHeader)

    if (nameColumnIndex !== -1 && telegramColumnIndex !== -1) {
      return dedupeAccounts(
        rows
          .map(row => ({
            name: String(row[nameColumnIndex] ?? '').trim(),
            telegram: String(row[telegramColumnIndex] ?? '').trim()
          }))
          .filter(account => account.name && account.telegram)
      )
    }
  }

  const accounts: NameTelegramAccount[] = []

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex]
    const nameLabelColumnIndex = row.findIndex(cell =>
      isNameHeader(normalize(cell))
    )

    if (nameLabelColumnIndex === -1) {
      continue
    }

    const namesByColumn = new Map<number, string>()

    for (
      let columnIndex = nameLabelColumnIndex + 1;
      columnIndex < row.length;
      columnIndex += 1
    ) {
      const name = String(row[columnIndex] ?? '').trim()

      if (name) {
        namesByColumn.set(columnIndex, name)
      }
    }

    for (
      let dataRowIndex = rowIndex + 1;
      dataRowIndex < values.length;
      dataRowIndex += 1
    ) {
      const dataRow = values[dataRowIndex]
      const rowLabel = normalize(dataRow[nameLabelColumnIndex])

      if (isNameHeader(rowLabel)) {
        break
      }

      if (!isTelegramHeader(rowLabel)) {
        continue
      }

      for (const [columnIndex, name] of namesByColumn) {
        const telegram = String(dataRow[columnIndex] ?? '').trim()

        if (telegram) {
          accounts.push({
            name,
            telegram
          })
        }
      }
    }
  }

  return dedupeAccounts(accounts)
}

async function logNamesWithTelegramAccounts(): Promise<NameTelegramAccount[]> {
  const result = await fetchAllSheetValues()
  const accounts = result.sheets.flatMap(sheet =>
    mapNamesWithTelegramAccounts(sheet.values)
  )

  if (!accounts.length) {
    console.log(
      'No name + Telegram account pairs found. Expected headers like "имя" and "tg"/"telegram"/"телеграм".'
    )
  }

  console.log(accounts)

  return accounts
}

if (require.main === module) {
  exportClientsStackMapping().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

module.exports = {
  exportClientStackMapping,
  exportClientsStackMapping,
  exportSheetDataToJson,
  fetchSheetValues,
  fetchNamedSheetValues,
  fetchAllSheetValues,
  fetchMinimalSheetData,
  logNamesWithTelegramAccounts,
  getAllClientsAutomationData,
  getClientAutomationData,
  getClientHHAuthCredentials,
  mapAllClientsAutomationData,
  mapClientAutomationData,
  mapClientHHAuthCredentials,
  mapClientStack,
  mapClientsByAllowedStacks,
  mapNamesWithTelegramAccounts
}
