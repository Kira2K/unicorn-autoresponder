const assert = require('node:assert/strict')

const {
  mapAllClientsAutomationData,
  mapClientHHAuthCredentials,
  mapClientHHAuthCredentialsByCommonChatId
} = require('./sheets/automation-mapper.ts')
const { parseMarketEnv } = require('./orchestrator/config.ts')
const {
  getVacancyIdFromUrl,
  isAutoResponderUrl,
  normalizeHhUrl
} = require('./shared/hh-url.ts')
const {
  isClientReportSuccessful,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames,
  splitTelegramMessage
} = require('./orchestrator.ts')

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

const telegramChunks = splitTelegramMessage('x'.repeat(9000))
assert.equal(telegramChunks.length, 3)
assert.ok(telegramChunks.every((chunk: string) => chunk.length <= 3900))

assert.equal(
  isClientReportSuccessful({
    opened: true,
    startButtonClicked: true,
    autoResponderWatchTimedOut: true,
    stopButtonClicked: false,
    autoResponderStopReason: 'orchestrator_stop_after_watch'
  }),
  true
)

console.log('Refactor regression checks passed')
