const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  mapAllClientsAutomationData,
  mapClientHHAuthCredentials,
  mapClientHHAuthCredentialsByCommonChatId
} = require('../../integrations/google-sheets/automation-mapper.ts')
const { createAppDb } = require('../../platform/db/index.ts') as {
  createAppDb(): any
}
const {
  SHEET_LABELS,
  SHEET_NAMES,
  getMarketProfileIdLabel,
  getMarketProxyLabel
} = require('../../platform/db/schema.ts') as {
  SHEET_LABELS: Record<string, string>
  SHEET_NAMES: Record<string, string>
  getMarketProfileIdLabel(market: 'Ru' | 'En'): string
  getMarketProxyLabel(market: 'Ru' | 'En'): string
}
const {
  createGoogleSheetsDbFromValues
} = require('../../platform/db/google-sheets-db.ts') as {
  createGoogleSheetsDbFromValues(values: {
    personalDataValues?: string[][]
    dolphinMainValues?: string[][]
    stacksValues?: string[][]
  }): any
}
const { parseMarketEnv } = require('../hh-responses/orchestrator/config.ts')
const {
  getVacancyIdFromUrl,
  isAutoResponderUrl,
  normalizeHhUrl
} = require('../hh-responses/shared/hh-url.ts')
const {
  createCompanyStopListBrowserSource,
  findBlockedCompanyMatch,
  normalizeBlockedCompanies
} = require('../../../shared/company-stop-list.ts') as {
  createCompanyStopListBrowserSource(): string
  findBlockedCompanyMatch(companyName: unknown, blockedCompanies: unknown): any
  normalizeBlockedCompanies(blockedCompanies: unknown): Array<{
    id: string
    name: string
  }>
}
const {
  MOCK_BLOCKED_COMPANIES,
  attachBlockedCompanies
} = require('../hh-responses/orchestrator/blocked-companies.ts') as {
  MOCK_BLOCKED_COMPANIES: Array<{ id: string; name: string }>
  attachBlockedCompanies(clients: any[]): any[]
}
const {
  isClientReportSuccessful,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames,
  splitTelegramMessage
} = require('../hh-responses/cli/orchestrator.ts')

const personalDataValues = [
  ['имя', 'Иван', 'Мария'],
  ['стек', 'PYTHON', 'React'],
  ['ruHH', '', ''],
  ['rusPhoneNumber', '+7 999 111-22-33', '8 (999) 222-33-44'],
  ['emailHH', 'ivan-ru@example.com', 'maria-ru@example.com'],
  ['passwordHH', 'ivan-ru-pass', 'maria-ru-pass'],
  ['enHH', '', ''],
  ['rusPhoneNumber', '+7 999 333-44-55 (note 12345)', '8 (999) 444-55-66'],
  ['emailHH', 'ivan-en@example.com', 'maria-en@example.com'],
  ['passwordHH', 'ivan-en-pass', 'maria-en-pass'],
  ['Id общего чата', '100', '200']
]
const dolphinMainValues = [
  ['имя', 'Иван', 'Мария'],
  ['СТЕК', 'PYTHON', 'React'],
  ['Делаем отклики Ru', 'да', 'да'],
  ['Делаем отклики En', '', 'да'],
  ['Dolphin Profile Ru Id', '123', '456'],
  ['Dolphin Profile En Id', '', '789'],
  ['Id общего чата', '100', '200'],
  ['Сопровод Ru', 'cover 1', 'cover 2'],
  ['Сопровод En', '', 'cover en']
]
const stacksValues = [
  ['', 'PYTHON', 'React', 'КИРА'],
  [
    'Ru',
    'https://hh.ru/search/vacancy?text=python',
    'https://hh.ru/search/vacancy?text=react',
    'https://hh.ru/search/vacancy?text=kira'
  ],
  [
    'En',
    'https://hh.ru/search/vacancy?text=python-en',
    'https://hh.ru/search/vacancy?text=react-en',
    'https://hh.ru/search/vacancy?text=kira-en'
  ]
]

const targets = mapAllClientsAutomationData(
  personalDataValues,
  dolphinMainValues,
  stacksValues
)

assert.equal(targets.length, 2)
assert.equal(targets[0].clientName, 'Иван')
assert.equal(targets[0].dolphinProfileId, 123)
assert.equal(targets[0].stackScenario, 'https://hh.ru/search/vacancy?text=python')
assert.equal(targets[1].clientName, 'Мария')

const allMarketTargets = mapAllClientsAutomationData(
  personalDataValues,
  dolphinMainValues,
  stacksValues,
  {
    workWithRuOnly: false
  }
)

assert.equal(allMarketTargets.length, 3)
assert.equal(allMarketTargets[2].clientName, 'Мария')
assert.equal(allMarketTargets[2].market, 'En')
assert.equal(allMarketTargets[2].dolphinProfileId, 789)
assert.equal(
  allMarketTargets[2].stackScenario,
  'https://hh.ru/search/vacancy?text=react-en'
)
assert.equal(allMarketTargets[2].coverText, 'cover en')

const enOnlyTargets = mapAllClientsAutomationData(
  personalDataValues,
  dolphinMainValues,
  stacksValues,
  {
    market: 'En'
  }
)

assert.equal(enOnlyTargets.length, 1)
assert.equal(enOnlyTargets[0].clientName, 'Мария')
assert.equal(enOnlyTargets[0].market, 'En')

assert.equal(parseMarketEnv(undefined), 'Ru')
assert.equal(parseMarketEnv(''), 'Ru')
assert.equal(parseMarketEnv('ru'), 'Ru')
assert.equal(parseMarketEnv('en'), 'En')
assert.throws(() => parseMarketEnv('unset'), /Invalid ORCHESTRATOR_WORK_WITH_MARKET/)
assert.throws(() => parseMarketEnv('all'), /Invalid ORCHESTRATOR_WORK_WITH_MARKET/)

const ivanCredentials = mapClientHHAuthCredentials(personalDataValues, 'Иван')
const mariaCredentials = mapClientHHAuthCredentials(personalDataValues, 'Мария')
const mariaEnCredentials = mapClientHHAuthCredentials(personalDataValues, 'Мария', 'En')
const mariaCredentialsById = mapClientHHAuthCredentialsByCommonChatId(
  personalDataValues,
  '200',
  'Ru'
)
const mariaEnCredentialsById = mapClientHHAuthCredentialsByCommonChatId(
  personalDataValues,
  '200',
  'En'
)

assert.equal(ivanCredentials.phone, '9991112233')
assert.equal(ivanCredentials.email, 'ivan-ru@example.com')
assert.equal(ivanCredentials.password, 'ivan-ru-pass')
assert.equal(mariaCredentials.phone, '9992223344')
assert.equal(mariaCredentials.password, 'maria-ru-pass')
assert.equal(mariaEnCredentials.phone, '9994445566')
assert.equal(mariaEnCredentials.email, 'maria-en@example.com')
assert.equal(mariaEnCredentials.password, 'maria-en-pass')
assert.equal(mariaCredentialsById.clientName, 'Мария')
assert.equal(mariaCredentialsById.phone, '9992223344')
assert.equal(mariaEnCredentialsById.phone, '9994445566')
assert.equal(
  mapClientHHAuthCredentials(personalDataValues, 'Иван', 'En').phone,
  '9993334455'
)

const duplicateNamePersonalDataValues = [
  ['имя', 'Кира', 'Кира'],
  ['стек', 'КИРА', 'React'],
  ['rusPhoneNumber', '+7 999 111-22-33', '8 (999) 222-33-44'],
  ['passwordHH', 'kira-pass-1', 'kira-pass-2'],
  ['Id общего чата', '5216637594', '-5107656391']
]
const duplicateNameDolphinMainValues = [
  ['имя', 'Кира', 'Кира', 'Без пары'],
  ['СТЕК', 'КИРА', 'React', 'React'],
  ['Делаем отклики Ru', 'да', 'да', 'да'],
  ['Dolphin Profile Ru Id', '770032142', '769499246', '111'],
  ['Id общего чата', '5216637594', '-5107656391', '999'],
  ['Сопровод Ru', 'cover 1', 'cover 2', 'cover 3']
]
const warnings: string[] = []
const originalWarn = console.warn
console.warn = (message?: unknown) => {
  warnings.push(String(message ?? ''))
}
const duplicateNameTargets = mapAllClientsAutomationData(
  duplicateNamePersonalDataValues,
  duplicateNameDolphinMainValues,
  stacksValues
)
console.warn = originalWarn

assert.equal(duplicateNameTargets.length, 2)
assert.deepEqual(
  duplicateNameTargets.map((target: any) => target.commonChatId),
  ['5216637594', '-5107656391']
)
assert.equal(warnings.length, 1)
assert.match(warnings[0], /AUTOMATION PROFILE SKIPPED/)
assert.equal(
  selectClientsByCommonChatIds(duplicateNameTargets, ['5216637594'])[0]
    .dolphinProfileId,
  770032142
)
assert.throws(
  () => selectClientsByUniqueNames(duplicateNameTargets, ['Кира']),
  /ambiguous/
)

assert.equal(getVacancyIdFromUrl('https://hh.ru/vacancy/12345'), '12345')
assert.equal(
  getVacancyIdFromUrl('https://hh.ru/applicant/vacancy_response?vacancyId=987'),
  '987'
)
assert.equal(getVacancyIdFromUrl('not a vacancy'), undefined)
assert.equal(isAutoResponderUrl('https://hh.ru/search/vacancy?text=js'), true)
assert.equal(isAutoResponderUrl('https://example.com/search/vacancy'), false)
assert.equal(normalizeHhUrl('/vacancy/111'), 'https://hh.ru/vacancy/111')
assert.equal(normalizeHhUrl('javascript:alert(1)'), undefined)

const blockedCompanies = [
  { id: 'mock-comtek', name: 'Comtek' },
  { id: 'mock-trynexis', name: 'Trynexis' },
  { id: 'mock-sberbank', name: 'Sberbank' }
]
assert.equal(
  findBlockedCompanyMatch('Comtek', blockedCompanies)?.blockedCompany.id,
  'mock-comtek'
)
assert.equal(
  findBlockedCompanyMatch('  COMTEK, LLC  ', blockedCompanies)?.reason,
  'substring'
)
assert.equal(
  findBlockedCompanyMatch('Trynexiz', blockedCompanies)?.blockedCompany.id,
  'mock-trynexis'
)
assert.equal(
  findBlockedCompanyMatch('sber', blockedCompanies)?.blockedCompany.id,
  'mock-sberbank'
)
assert.equal(
  findBlockedCompanyMatch('Cberbank', blockedCompanies)?.reason,
  'edit_distance_1'
)
assert.equal(findBlockedCompanyMatch('Totally Different', blockedCompanies), undefined)
assert.deepEqual(normalizeBlockedCompanies([{ id: 1, name: ' Comtek ' }]), [
  { id: '1', name: 'Comtek' }
])
assert.deepEqual(MOCK_BLOCKED_COMPANIES, [
  { id: 'mock-comtek', name: 'Comtek' },
  { id: 'mock-trynexis', name: 'Trynexis' }
])
assert.deepEqual(attachBlockedCompanies([targets[0]])[0].blockedCompanies, [
  { id: 'mock-comtek', name: 'Comtek' },
  { id: 'mock-trynexis', name: 'Trynexis' }
])
const browserStopListWindow: any = {}
new Function(
  'window',
  `${createCompanyStopListBrowserSource()}; return window.HHCompanyStopList;`
)(browserStopListWindow)
assert.equal(
  browserStopListWindow.HHCompanyStopList.findBlockedCompanyMatch(
    'Comtek',
    blockedCompanies
  ).blockedCompany.id,
  'mock-comtek'
)

const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
assert.match(indexSource, /blockedCompanies/)
assert.match(indexSource, /COMPANY_STOP_LIST_SKIPPED/)
assert.ok(
  indexSource.indexOf('findBlockedCompanyMatch(companyName)') <
    indexSource.indexOf('topBtn.click()')
)

const autoResponderControlSource = fs.readFileSync(
  path.join(__dirname, 'auto-responder', 'control.ts'),
  'utf8'
)
assert.match(autoResponderControlSource, /settings\.blockedCompanies/)

const telegramChunks = splitTelegramMessage('x'.repeat(9000))
assert.equal(telegramChunks.length, 3)
assert.ok(telegramChunks.every((chunk: string) => chunk.length <= 3900))

assert.equal(
  isClientReportSuccessful({
    opened: true,
    startButtonClicked: true,
    autoResponderWatchTimedOut: true,
    profileStopped: true,
    profileTagRemoved: true,
    profileStatusRestored: true,
    stopButtonClicked: false,
    autoResponderStopReason: 'orchestrator_stop_after_watch'
  }),
  true
)

function getTypeScriptFiles(rootDir: string): string[] {
  const files: string[] = []

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue
    }

    const entryPath = path.join(rootDir, entry.name)

    if (entry.isDirectory()) {
      files.push(...getTypeScriptFiles(entryPath))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath)
    }
  }

  return files
}

function assertNoNewDirectGoogleSheetsImports(): void {
  const allowedDirectImports = new Set(
    [
      'check-table-state.ts',
      'db/google-sheets/google-sheets-db-factory.ts',
      'db/google-sheets/sheet-state.ts',
      'db/google-sheets-db.ts',
      'doctor.ts',
      'noco/integrations/google-sheets.ts',
      'sheets/automation-mapper.ts',
      'sheets/automation-repository.ts',
      'sheets/google-client.ts'
    ].map(item => item.replace(/\//g, path.sep))
  )
  const rootDir = __dirname
  const offenders = getTypeScriptFiles(rootDir)
    .map(filePath => path.relative(rootDir, filePath))
    .filter(relativePath => {
      if (allowedDirectImports.has(relativePath)) {
        return false
      }

      const content = fs.readFileSync(path.join(rootDir, relativePath), 'utf8')

      return /require\(['"][^'"]*google-sheets-check\.ts['"]\)/.test(content)
    })

  assert.deepEqual(offenders, [])
}

assertNoNewDirectGoogleSheetsImports()

assert.equal(typeof createAppDb().getAutomationTargets, 'function')
assert.equal(SHEET_NAMES.personalData, 'ПЕРС ДАННЫЕ')
assert.equal(SHEET_LABELS.commonChatId, 'Id общего чата')
assert.equal(getMarketProfileIdLabel('En'), 'Dolphin Profile En Id')
assert.equal(getMarketProxyLabel('Ru'), 'Прокси Ru')

async function runDbBoundaryChecks(): Promise<void> {
  const db = createGoogleSheetsDbFromValues({
    personalDataValues: [
      ...personalDataValues,
      ['рынок', 'Ru', 'Ru/En'],
      ['Dolphin Profile En Id', '', '789'],
      ['Dolphin Profile Ru Id', '123', '456'],
      ['Прокси En', '', 'socks5://example.proxy:10000'],
      ['Реальные данные', '', ''],
      ['ФИО', 'Иван Иванов', 'Мария Петрова'],
      ['ТГ', '@ivan', '@maria']
    ],
    dolphinMainValues,
    stacksValues
  })

  const dbTargets = await db.getAutomationTargets()

  assert.deepEqual(
    dbTargets,
    mapAllClientsAutomationData(
      [
        ...personalDataValues,
        ['рынок', 'Ru', 'Ru/En'],
        ['Dolphin Profile En Id', '', '789'],
        ['Dolphin Profile Ru Id', '123', '456'],
        ['Прокси En', '', 'socks5://example.proxy:10000'],
        ['Реальные данные', '', ''],
        ['ФИО', 'Иван Иванов', 'Мария Петрова'],
        ['ТГ', '@ivan', '@maria']
      ],
      dolphinMainValues,
      stacksValues
    )
  )
  assert.equal(
    (await db.getAutomationTargetByName('Иван', 'Ru')).dolphinProfileId,
    123
  )
  assert.deepEqual(
    await db.getHHAuthCredentialsByClientName('Мария', 'En'),
    mapClientHHAuthCredentials(
      [
        ...personalDataValues,
        ['рынок', 'Ru', 'Ru/En'],
        ['Dolphin Profile En Id', '', '789'],
        ['Dolphin Profile Ru Id', '123', '456'],
        ['Прокси En', '', 'socks5://example.proxy:10000'],
        ['Реальные данные', '', ''],
        ['ФИО', 'Иван Иванов', 'Мария Петрова'],
        ['ТГ', '@ivan', '@maria']
      ],
      'Мария',
      'En'
    )
  )
  assert.deepEqual(
    await db.getHHAuthCredentialsByCommonChatId('200', 'Ru'),
    mapClientHHAuthCredentialsByCommonChatId(
      [
        ...personalDataValues,
        ['рынок', 'Ru', 'Ru/En'],
        ['Dolphin Profile En Id', '', '789'],
        ['Dolphin Profile Ru Id', '123', '456'],
        ['Прокси En', '', 'socks5://example.proxy:10000'],
        ['Реальные данные', '', ''],
        ['ФИО', 'Иван Иванов', 'Мария Петрова'],
        ['ТГ', '@ivan', '@maria']
      ],
      '200',
      'Ru'
    )
  )
  assert.deepEqual(
    (await db.getStudentTelegramRecords()).map((record: any) => ({
      name: record.name,
      telegram: record.telegram,
      normalizedTelegram: record.normalizedTelegram
    })),
    [
      {
        name: 'Иван Иванов',
        telegram: '@ivan',
        normalizedTelegram: 'ivan'
      },
      {
        name: 'Мария Петрова',
        telegram: '@maria',
        normalizedTelegram: 'maria'
      }
    ]
  )
  assert.deepEqual(
    (await db.getProxyRequiredClients('En')).map((record: any) => ({
      firstName: record.firstName,
      chatId: record.chatId,
      profileId: record.profileId,
      sheetProxyName: record.sheetProxyName
    })),
    [
      {
        firstName: 'Мария',
        chatId: '200',
        profileId: '789',
        sheetProxyName: 'socks5://example.proxy:10000'
      }
    ]
  )
}

runDbBoundaryChecks()
  .then(() => {
    console.log('Refactor regression checks passed')
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
