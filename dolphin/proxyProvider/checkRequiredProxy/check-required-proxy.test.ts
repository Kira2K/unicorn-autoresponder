const assert = require('node:assert/strict')
const {
  addCorrectProxyMatchesToInvalidProxyNameResults,
  getInvalidProxyOwnNameResults,
  getInvalidProxySavedNameResults,
  parseCliArgs,
  toInvalidProxySavedNameMapText,
  toRunSummaryText
} = require('./index.ts') as {
  addCorrectProxyMatchesToInvalidProxyNameResults(
    results: any[],
    proxyInventory: any[]
  ): any[]
  getInvalidProxyOwnNameResults(
    results: any[],
    proxyInventory: any[],
    options?: any
  ): any[]
  getInvalidProxySavedNameResults(
    results: any[],
    proxyInventory: any[],
    options?: any
  ): any[]
  parseCliArgs(argv: string[]): any
  toInvalidProxySavedNameMapText(results: any[]): string
  toRunSummaryText(input: any): string
}
const {
  classifyProxyClient,
  findMatchingExistingProfiles,
  findExactProxyMatches,
  getDolphinProfileNameCandidates,
  parsePersonalDataClients,
  validateProxyName
} = require('./logic.ts') as {
  classifyProxyClient(input: any): any
  findMatchingExistingProfiles(
    profiles: any[],
    client: any,
    market: 'En' | 'Ru'
  ): any[]
  findExactProxyMatches(proxies: any[], proxyName: string): any[]
  getDolphinProfileNameCandidates(client: any, market: 'En' | 'Ru'): any[]
  parsePersonalDataClients(values: string[][], market: 'En' | 'Ru'): any[]
  validateProxyName(proxyName: string, client: any, market: 'En' | 'Ru'): any
}

function proxy(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? name,
    name,
    ...overrides
  }
}

function profile(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? name,
    name,
    ...overrides
  }
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    columnIndex: 1,
    firstName: 'Кира',
    secondName: 'Кира Иванова',
    sheetMarket: 'En',
    stack: 'Frontend',
    chatId: '-1001',
    profileId: '111',
    sheetProxyName: 'Кира | 111 | Кира Иванова | -1001 | Frontend En',
    ...overrides
  }
}

function checked(input: Record<string, unknown>) {
  return classifyProxyClient({
    market: 'En',
    inventoryProxyMatches: [],
    checkedAt: '2026-05-16T00:00:00.000Z',
    ...input
  })
}

function sheetValuesWithoutProxyRuRow() {
  return [
    ['', 'Frontend', '', '', '', ''],
    ['ФИО', 'Wrong Kira', 'Wrong Ivan', 'Wrong Maria', 'Wrong Rusya', 'Wrong Empty'],
    ['имя', 'Кира', 'Иван', 'Мария', 'Руся', 'Пустой'],
    ['Реальные данные', '', '', '', '', ''],
    ['ФИО', 'Кира Иванова', 'Иван Петров', 'Мария Сидорова', 'Руся Рулев', 'Пустой Чат'],
    ['стек', 'Frontend', '', 'Python', 'Go', 'QA'],
    ['рынок', 'En', '', 'Ru', 'Ru/En', 'En'],
    ['Id общего чата', '-1001', '-1002', '-1003', '-1004', ''],
    ['Dolphin Profile En Id', '111', '', '333', '444', '555'],
    ['Dolphin Profile Ru Id', '211', '222', '', '244', '255'],
    ['Прокси En', 'Кира | 111 | Кира Иванова | -1001 | Frontend En', '', '', '', '']
  ]
}

function getOnlyIssue(result: any, issue: string) {
  assert.equal(result.issues.includes(issue), true)
  return result
}

const personalDataValues = sheetValuesWithoutProxyRuRow()
const [kira, ivan, rusya] = parsePersonalDataClients(personalDataValues, 'En')
const ruClients = parsePersonalDataClients(personalDataValues, 'Ru')

assert.equal(kira.firstName, 'Кира')
assert.equal(kira.secondName, 'Кира Иванова')
assert.equal(kira.stack, 'Frontend')
assert.equal(kira.profileId, '111')
assert.equal(kira.sheetProxyName, 'Кира | 111 | Кира Иванова | -1001 | Frontend En')
assert.equal(ivan.profileId, '')
assert.equal(rusya.firstName, 'Руся')
assert.deepEqual(
  ruClients.map((parsedClient: any) => parsedClient.firstName),
  ['Мария', 'Руся']
)
assert.equal(
  ruClients.every((parsedClient: any) => parsedClient.sheetProxyName === ''),
  true
)

assert.deepEqual(parseCliArgs([]), {})
assert.deepEqual(parseCliArgs(['--market', 'Ru']), { market: 'Ru' })
assert.deepEqual(parseCliArgs(['--market=ru']), { market: 'Ru' })
assert.deepEqual(parseCliArgs(['--no-redact-proxy-connections']), {
  redactProxyConnectionValues: false
})
assert.deepEqual(parseCliArgs(['--redact-proxy-connections']), {
  redactProxyConnectionValues: true
})
assert.throws(() => parseCliArgs(['--wat']), /Unsupported argument/)

assert.deepEqual(
  getDolphinProfileNameCandidates(kira, 'En').map((candidate: any) => candidate.name),
  ['Кира Frontend En', 'Кира Иванова Frontend En']
)

assert.deepEqual(
  getDolphinProfileNameCandidates(
    client({
      firstName: 'Кира Иванова',
      secondName: 'Кира Иванова'
    }),
    'En'
  ).map((candidate: any) => candidate.name),
  ['Кира Иванова Frontend En']
)

assert.deepEqual(
  getDolphinProfileNameCandidates(
    client({
      firstName: 'Безфамильный',
      secondName: ''
    }),
    'En'
  ).map((candidate: any) => candidate.name),
  ['Безфамильный Frontend En']
)

assert.deepEqual(
  findMatchingExistingProfiles(
    [
      profile('кира   frontend en', { id: '1' }),
      profile('Кира Иванова Frontend En', { id: '2' }),
      profile('Frontend Кира En', { id: '3' })
    ],
    kira,
    'En'
  ).map((matchedProfile: any) => matchedProfile.id),
  ['1', '2']
)

assert.deepEqual(
  findMatchingExistingProfiles(
    [
      profile('Вася Пупкин Frontend En', { id: 'vasya-1' }),
      profile('Пупкин Вася Frontend En', { id: 'vasya-2' })
    ],
    client({
      firstName: 'Вася',
      secondName: 'Вася пупкин'
    }),
    'En'
  ).map((matchedProfile: any) => matchedProfile.id),
  ['vasya-1']
)

assert.equal(
  validateProxyName('Kira | 111 | Ivanova | -1001 | Frontend En', kira, 'En')
    .valid,
  true
)
assert.equal(
  validateProxyName('Any Name | Any Second Name | -1001 | Wrong Stack En', kira, 'En')
    .valid,
  true
)
assert.deepEqual(
  validateProxyName('Kira | 999 | Ivanova | -1001 | Frontend En', kira, 'En')
    .issues,
  ['profile_id_mismatch']
)
assert.deepEqual(
  validateProxyName('Kira | 111 | Ivanova | -999 | Frontend En', kira, 'En')
    .issues,
  ['chat_id_mismatch']
)
assert.deepEqual(
  validateProxyName('Kira | Ivanova | -1001 | Frontend En', kira, 'En').issues,
  []
)
assert.deepEqual(
  validateProxyName('Kira | Ivanova | -999 | Frontend En', kira, 'En').issues,
  ['chat_id_mismatch']
)
assert.deepEqual(
  validateProxyName('Kira | Ivanova | Frontend En', kira, 'En').issues,
  ['invalid_proxy_name_part_count']
)

getOnlyIssue(
  checked({
    client: client({ profileId: '', sheetProxyName: '' })
  }),
  'missing_profile_id'
)

getOnlyIssue(
  checked({
    client: client({ profileId: '', sheetProxyName: '' }),
    matchedExistingProfiles: [profile('Кира Frontend En', { id: '111' })]
  }),
  'profile_exists_but_not_connected'
)

assert.equal(
  checked({
    client: client({ profileId: 'abc', sheetProxyName: '' })
  }).issues.includes('invalid_profile_id'),
  true
)

assert.equal(
  checked({
    client: client({ sheetProxyName: '' }),
    dolphinProfileError: 'not found'
  }).issues.includes('dolphin_profile_error'),
  true
)

assert.equal(
  checked({
    client: client({ sheetProxyName: '' }),
    dolphinProfile: { id: '111' }
  }).status,
  'needs_proxy'
)

assert.equal(
  checked({
    client: kira,
    dolphinProfile: {
      id: '111',
      proxy: proxy('Kira | 111 | Ivanova | -1001 | Frontend En', { id: 1 })
    }
  }).status,
  'ok'
)

assert.deepEqual(
  checked({
    client: kira,
    dolphinProfile: { id: '111' },
    inventoryProxyMatches: findExactProxyMatches(
      [proxy('Кира | 111 | Кира Иванова | -1001 | Frontend En', { id: 1 })],
      kira.sheetProxyName
    )
  }).notes,
  ['proxy_exists_not_attached']
)

assert.equal(
  checked({
    client: client({ sheetProxyName: '' }),
    dolphinProfile: {
      id: '111',
      proxy: proxy('Kira | 111 | Ivanova | -1001 | Frontend En', { id: 1 })
    }
  }).issues.includes('sheet_missing_api_has_proxy'),
  true
)

assert.equal(
  checked({
    client: kira,
    dolphinProfile: { id: '111' }
  }).issues.includes('sheet_has_proxy_api_missing_proxy'),
  true
)

assert.equal(
  checked({
    client: kira,
    dolphinProfile: {
      id: '111',
      proxy: proxy('Kira | 111 | Ivanova | -1001 | Frontend En', { id: 1 })
    }
  }).notes.includes('sheet_proxy_differs_from_api'),
  true
)

assert.equal(
  checked({
    client: kira,
    dolphinProfile: {
      id: '111',
      proxy: proxy('Other | Other Name | -999 | Wrong Stack En', { id: 2 })
    }
  }).issues.includes('invalid_proxy_name'),
  true
)

assert.equal(
  checked({
    client: kira,
    dolphinProfile: { id: '111' },
    inventoryProxyMatches: [
      proxy(kira.sheetProxyName, { id: 1 }),
      proxy(kira.sheetProxyName, { id: 2 })
    ]
  }).notes.includes('multiple_inventory_proxies_same_name'),
  true
)

assert.deepEqual(
  addCorrectProxyMatchesToInvalidProxyNameResults(
    [
      {
        ...kira,
        market: 'En',
        issues: ['invalid_proxy_name']
      }
    ],
    [
      proxy('Kira | 111 | Ivanova | -1001 | Frontend En', { id: 1 }),
      proxy('Wrong proxy name', { id: 2 }),
      proxy('Other | 111 | Other | -1001 | Frontend En', { id: 3 })
    ]
  )[0].correctProxyNameMatches.map((matchedProxy: any) => matchedProxy.id),
  [1, 3]
)

assert.deepEqual(
  getInvalidProxyOwnNameResults(
    [
      checked({
        client: kira,
        dolphinProfile: {
          id: '111',
          proxy: proxy('Bad attached proxy name', { id: 4 })
        }
      }),
      checked({
        client: client({
          sheetProxyName: 'socks5://login:password@gw.example.com:10028'
        }),
        dolphinProfile: { id: '111' }
      })
    ],
    [proxy('Kira | 111 | Ivanova | -1001 | Frontend En', { id: 1 })]
  ).map((result: any) => result.checkedProxySource),
  ['attached']
)

const [invalidSavedProxyNameResult] = getInvalidProxySavedNameResults(
  [
    checked({
      client: client({
        sheetProxyName: 'socks5://login:password@gw.example.com:10028'
      }),
      dolphinProfile: { id: '111' }
    }),
    checked({
      client: kira,
      dolphinProfile: {
        id: '111',
        proxy: proxy('Kira | 111 | Ivanova | -1001 | Frontend En', { id: 1 })
      }
    })
  ],
  [proxy('Kira | 111 | Ivanova | -1001 | Frontend En', { id: 1 })]
)

assert.deepEqual(
  invalidSavedProxyNameResult.sheetProxyNameValidation.issues,
  ['invalid_proxy_name_part_count']
)
assert.deepEqual(
  invalidSavedProxyNameResult.correctProxyNameMatches.map((matchedProxy: any) => matchedProxy.id),
  [1]
)

assert.equal(
  invalidSavedProxyNameResult.sheetProxyName,
  'socks5://login:password@gw.example.com:10028'
)

assert.equal(
  getInvalidProxySavedNameResults(
    [
      checked({
        client: client({
          sheetProxyName: 'socks5://login:password@gw.example.com:10028'
        }),
        dolphinProfile: { id: '111' }
      })
    ],
    [],
    { redactProxyConnectionValues: true }
  )[0].sheetProxyName,
  '[proxy_connection_value_redacted]'
)

assert.equal(
  toInvalidProxySavedNameMapText([
    invalidSavedProxyNameResult,
    {
      ...invalidSavedProxyNameResult,
      firstName: 'Без корректного имени',
      checkedProxyName: '',
      correctProxyNameMatches: []
    }
  ]),
  'Кира >>> Kira | 111 | Ivanova | -1001 | Frontend En\n'
)

assert.equal(
  toRunSummaryText({
    payload: {
      generatedAt: '2026-05-17T00:00:00.000Z',
      market: 'En',
      sourceSheet: 'ПЕРС ДАННЫЕ',
      total: 2,
      counts: {
        ok: 1,
        error: 1
      },
      results: [
        {
          issues: ['missing_profile_id']
        },
        {
          issues: ['profile_exists_but_not_connected']
        }
      ]
    },
    invalidProxyOwnNameResults: [{}],
    invalidProxySavedNameResults: [
      invalidSavedProxyNameResult,
      {
        ...invalidSavedProxyNameResult,
        checkedProxyName: '',
        correctProxyNameMatches: []
      }
    ],
    runDirectory: 'reports/run'
  }),
  [
    'generatedAt: 2026-05-17T00:00:00.000Z',
    'market: En',
    'sourceSheet: ПЕРС ДАННЫЕ',
    'total: 2',
    'ok: 1',
    'needs_proxy: 0',
    'data_mismatch: 0',
    'error: 1',
    'missing_profile_id: 1',
    'profile_exists_but_not_connected: 1',
    'invalid_proxy_own_name: 1',
    'invalid_proxy_saved_name: 2',
    'invalid_proxy_saved_name_map: 1',
    'runDirectory: reports/run',
    ''
  ].join('\n')
)

console.log('checkRequiredProxy tests passed')
