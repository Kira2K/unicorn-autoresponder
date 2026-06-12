const assert = require('node:assert/strict')
const {
  buildAutomationTargetsFromNocoState,
  createNocoDb,
  isEnabled,
  normalizeId,
  responseField,
  scenarioLookupStack
} = require('./noco-db.ts') as {
  buildAutomationTargetsFromNocoState(state: any, options?: any): any[]
  createNocoDb(options?: any): any
  isEnabled(value: unknown): boolean
  normalizeId(value: unknown): string
  responseField(market: 'Ru' | 'En'): string
  scenarioLookupStack(clientName: string, stack: string): string
}

async function runTests(): Promise<void> {
  assert.equal(normalizeId('770032142.0'), '770032142')
  assert.equal(isEnabled('TRUE'), true)
  assert.equal(isEnabled('0'), false)
  assert.equal(scenarioLookupStack('Кира', 'FRONTEND'), 'КИРА')
  assert.equal(scenarioLookupStack('Антон', 'FRONTEND'), 'React')

  const targets = buildAutomationTargetsFromNocoState(
    {
      clients: [
        {
          Id: 1,
          client_name: 'Кира',
          telegram_general_chat_id: '5216637594',
          rel_clients_primary_stack: { Id: 4, name: 'FRONTEND' }
        },
        {
          Id: 2,
          client_name: 'Антон',
          telegram_general_chat_id: '-1001',
          rel_clients_primary_stack: { Id: 5, name: 'FullStack' }
        }
      ],
      autoresponseRows: [
        {
          Id: 1,
          rel_hhAutoresponses_client: { Id: 1, client_name: 'Кира' },
          Сопровод_Ru: 'Здравствуйте!',
          Делаем_отклики_Ru: 'TRUE',
          Делаем_отклики_En: 'FALSE'
        },
        {
          Id: 2,
          'Stack Override': { Id: 2, name: 'FRONTEND' },
          rel_hhAutoresponses_client: { Id: 2, client_name: 'Антон' },
          Сопровод_Ru: 'Добрый день!',
          Делаем_отклики_Ru: 'TRUE',
          Делаем_отклики_En: 'FALSE'
        }
      ],
      profiles: [
        {
          Id: 1,
          locale: 'ru',
          dolphin_profile_id: '770032142',
          rel_dolphinProfiles_client: { Id: 1 }
        },
        {
          Id: 2,
          locale: 'ru',
          dolphin_profile_id: '123456789',
          rel_dolphinProfiles_client: { Id: 2 }
        }
      ],
      stacks: [
        {
          Id: 1,
          name: 'КИРА',
          slug: 'kira',
          hh_scenario_alias: 'КИРА',
          hh_scenario_url_ru: 'https://hh.ru/applicant/vacancy_response?kira',
          hh_scenario_url_en: 'https://hh.ru/applicant/vacancy_response?kira-en'
        },
        {
          Id: 2,
          name: 'FRONTEND',
          slug: 'frontend',
          hh_scenario_alias: 'React',
          hh_scenario_url_ru: 'https://hh.ru/applicant/vacancy_response?front',
          hh_scenario_url_en: 'https://hh.ru/applicant/vacancy_response?front-en'
        },
        {
          Id: 3,
          name: 'PYTHON',
          slug: 'python',
          hh_scenario_alias: 'PYTHON',
          hh_scenario_url_ru: 'https://hh.ru/applicant/vacancy_response?python',
          hh_scenario_url_en: 'https://hh.ru/applicant/vacancy_response?python-en'
        }
      ]
    },
    { market: 'Ru' }
  )

  assert.equal(targets.length, 2)
  assert.equal(targets[0].clientName, 'Кира')
  assert.equal(targets[0].stack, 'FRONTEND')
  assert.equal(targets[0].market, 'Ru')
  assert.equal(targets[0].dolphinProfileId, 770032142)
  assert.equal(targets[0].commonChatId, '5216637594')
  assert.equal(targets[0].coverText, 'Здравствуйте!')
  assert.equal(targets[0].stackScenario, 'https://hh.ru/applicant/vacancy_response?kira')
  assert.equal(targets[1].clientName, 'Антон')
  assert.equal(targets[1].stack, 'FRONTEND')
  assert.equal(targets[1].dolphinProfileId, 123456789)
  assert.equal(targets[1].commonChatId, '-1001')
  assert.equal(targets[1].coverText, 'Добрый день!')
  assert.equal(targets[1].stackScenario, 'https://hh.ru/applicant/vacancy_response?front')

  assert.throws(
    () =>
      buildAutomationTargetsFromNocoState(
        {
          clients: [
            {
              Id: 1,
              client_name: 'Кира',
              telegram_general_chat_id: '5216637594',
              rel_clients_primary_stack: { Id: 4, name: 'FRONTEND' }
            }
          ],
          autoresponseRows: [
            {
              Id: 1,
              [responseField('Ru')]: 'TRUE',
              rel_hhAutoresponses_client: { Id: 1, client_name: 'Кира' },
            }
          ],
          profiles: [
            {
              Id: 1,
              locale: 'ru',
              dolphin_profile_id: '770032142',
              rel_dolphinProfiles_client: { Id: 1 }
            },
            {
              Id: 2,
              locale: 'ru',
              dolphin_profile_id: '770032143',
              rel_dolphinProfiles_client: { Id: 1 }
            }
          ],
          stacks: []
        },
        { market: 'Ru' }
      ),
    /ambiguous/
  )

  assert.throws(
    () =>
      buildAutomationTargetsFromNocoState(
        {
          clients: [
            {
              Id: 1,
              client_name: 'Kira',
              telegram_general_chat_id: '5216637594',
              rel_clients_primary_stack: { Id: 4, name: 'FRONTEND' }
            }
          ],
          autoresponseRows: [
            {
              Id: 1,
              rel_hhAutoresponses_client: { Id: 1, client_name: 'Kira' },
              'Stack Override': [
                { Id: 2, name: 'FRONTEND' },
                { Id: 3, name: 'PYTHON' }
              ],
            }
          ],
          profiles: [
            {
              Id: 1,
              locale: 'ru',
              dolphin_profile_id: '770032142',
              rel_dolphinProfiles_client: { Id: 1 }
            }
          ],
          stacks: []
        },
        { market: 'Ru' }
      ),
    /Stack Override.*ambiguous/
  )

  const recordsByTable: Record<string, any[]> = {
    mxza381054ldlza: [
      {
        Id: 36,
        client_name: 'Иван Чебыкин',
        telegram_general_chat_id: '-1003794953830'
      }
    ],
    mes5o0s90zwat1t: [
      {
        Id: 7,
        rel_hhAutoresponses_client: { Id: 36, client_name: 'Иван Чебыкин' },
        Делаем_отклики_Ru: true
      }
    ],
    m8zej2vsv4iypl8: [
      {
        client_name: 'Иван Чебыкин',
      },
      {
        Id: 101,
        client_name: 'Иван Чебыкин',
        platform: 'hh_ru',
        rel_platformAccounts_client: { Id: 36 },
        phone: '+79990001122',
        password: 'canonical-secret',
        email: 'ivan@example.com',
        email_password: 'mail-secret'
      }
    ]
  }
  const db = createNocoDb({
    nocoClient: {
      fetchRecords: async (tableId: string) => recordsByTable[tableId] ?? []
    }
  })
  const credentials = await db.getHHAuthCredentialsByCommonChatId(
    '-1003794953830',
    'Ru'
  )

  assert.equal(credentials.clientName, 'Иван Чебыкин')
  assert.equal(credentials.commonChatId, '-1003794953830')
  assert.equal(credentials.market, 'Ru')
  assert.equal(credentials.phone, '+79990001122')
  assert.equal(credentials.password, 'canonical-secret')

  const duplicateDb = createNocoDb({
    nocoClient: {
      fetchRecords: async (tableId: string) => ({
        ...recordsByTable,
        m8zej2vsv4iypl8: [
          ...recordsByTable.m8zej2vsv4iypl8,
          {
            Id: 102,
            client_name: 'Ð˜Ð²Ð°Ð½ Ð§ÐµÐ±Ñ‹ÐºÐ¸Ð½',
            platform: 'hh_ru',
            clients_id: 36,
            phone: '+79990003344',
            password: 'duplicate-secret'
          }
        ]
      })[tableId] ?? []
    }
  })

  await assert.rejects(
    () => duplicateDb.getHHAuthCredentialsByCommonChatId('-1003794953830', 'Ru'),
    /ambiguous/
  )
}

runTests()
  .then(() => {
    console.log('db:noco tests passed')
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
