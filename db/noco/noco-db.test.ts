const assert = require('node:assert/strict')
const {
  buildAutomationTargetsFromNocoState,
  createNocoDb,
  isEnabled,
  normalizeId,
  scenarioLookupStack
} = require('./noco-db.ts') as {
  buildAutomationTargetsFromNocoState(state: any, options?: any): any[]
  createNocoDb(options?: any): any
  isEnabled(value: unknown): boolean
  normalizeId(value: unknown): string
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
        }
      ],
      rawRows: [
        {
          Id: 1,
          rel_dolphinMainRaw_client: { Id: 1, client_name: 'Кира' },
          rel_dolphinMainRaw_dolphin_profile_ru: { Id: 1 },
          Dolphin_Profile_Ru_Id: '770032142',
          Dolphin_Profile_En_Id: '',
          Сопровод_Ru: 'Здравствуйте!',
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
        }
      ]
    },
    { market: 'Ru' }
  )

  assert.equal(targets.length, 1)
  assert.equal(targets[0].clientName, 'Кира')
  assert.equal(targets[0].stack, 'FRONTEND')
  assert.equal(targets[0].market, 'Ru')
  assert.equal(targets[0].dolphinProfileId, 770032142)
  assert.equal(targets[0].coverText, 'Здравствуйте!')
  assert.equal(targets[0].stackScenario, 'https://hh.ru/applicant/vacancy_response?kira')

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
        rel_dolphinMainRaw_client: { Id: 36, client_name: 'Иван Чебыкин' },
        rel_dolphinMainRaw_hh_account_ru: { Id: 101 },
        Делаем_отклики_Ru: true
      }
    ],
    m8zej2vsv4iypl8: [
      {
        Id: 100,
        client_name: 'Иван Чебыкин',
        platform: 'hh_ru',
        clients_id: 36,
        phone: '+79998887766',
        password: 'secret',
        email: 'ivan@example.com',
        email_password: 'mail-secret'
      },
      {
        Id: 101,
        client_name: 'Иван Чебыкин',
        platform: 'hh_ru',
        clients_id: 36,
        phone: '+79990001122',
        password: 'relation-secret'
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
  assert.equal(credentials.password, 'relation-secret')
}

runTests()
  .then(() => {
    console.log('db:noco tests passed')
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
