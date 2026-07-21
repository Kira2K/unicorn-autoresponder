const assert = require('node:assert/strict')

const { buildTargets, parseArgs } = require('./index.ts') as {
  buildTargets(state: {
    clients: Array<Record<string, unknown> & { Id: number }>
    profiles: Array<Record<string, unknown> & { Id: number }>
    autoresponseRows: Array<Record<string, unknown> & { Id: number }>
    platformAccounts: Array<Record<string, unknown> & { Id: number }>
    stacks: Array<Record<string, unknown> & { Id: number }>
  }, marketFilter?: 'Ru' | 'En', clientNames?: string[]): Array<{
    clientId: number
    clientName: string
    enabled: boolean
    market: 'Ru' | 'En'
    dolphinProfileId: number
    commonChatId: string
    hasCanonicalHHAccount: boolean
    problems: string[]
  }>
  parseArgs(args: string[]): {
    clientNames: string[]
    json: boolean
    market?: 'Ru' | 'En'
    strict: boolean
  }
}

const COVER_EN = '\u0421\u043e\u043f\u0440\u043e\u0432\u043e\u0434_En'
const RESPONSE_RU = '\u0414\u0435\u043b\u0430\u0435\u043c_\u043e\u0442\u043a\u043b\u0438\u043a\u0438_Ru'
const RESPONSE_EN = '\u0414\u0435\u043b\u0430\u0435\u043c_\u043e\u0442\u043a\u043b\u0438\u043a\u0438_En'

function baseState() {
  return {
    clients: [
      {
        Id: 1,
        client_name: 'Kira',
        telegram_general_chat_id: '5216637594',
        rel_clients_primary_stack: { Id: 10, name: 'FRONTEND' }
      },
      {
        Id: 2,
        client_name: 'Artem',
        telegram_general_chat_id: '-1002',
        rel_clients_primary_stack: { Id: 10, name: 'FRONTEND' }
      }
    ],
    profiles: [
      {
        Id: 101,
        locale: 'en',
        dolphin_profile_id: '700001',
        rel_dolphinProfiles_client: { Id: 1 }
      },
      {
        Id: 102,
        locale: 'en',
        dolphin_profile_id: '700002',
        rel_dolphinProfiles_client: { Id: 2 }
      }
    ],
    autoresponseRows: [
      {
        Id: 201,
        rel_hhAutoresponses_client: { Id: 1, client_name: 'Kira' },
        [COVER_EN]: 'Hello!',
        [RESPONSE_RU]: 'FALSE',
        [RESPONSE_EN]: 'FALSE'
      },
      {
        Id: 202,
        rel_hhAutoresponses_client: { Id: 2, client_name: 'Artem' },
        [COVER_EN]: 'Hello!',
        [RESPONSE_RU]: 'FALSE',
        [RESPONSE_EN]: 'TRUE'
      }
    ],
    platformAccounts: [
      {
        Id: 301,
        rel_platformAccounts_client: { Id: 1 },
        rel_platformAccounts_platform: { Id: 10, label: 'hh_en' }
      },
      {
        Id: 302,
        rel_platformAccounts_client: { Id: 2 },
        rel_platformAccounts_platform: { Id: 10, label: 'hh_en' }
      }
    ],
    stacks: [
      {
        Id: 10,
        name: 'FRONTEND',
        hh_scenario_url_en: 'https://hh.ru/search/vacancy?text=frontend-en'
      }
    ]
  }
}

function testParseArgs(): void {
  const options = parseArgs([
    '--market=en',
    '--client-names=Kira, Artem',
    '--json',
    '--strict'
  ])

  assert.deepEqual(options, {
    clientNames: ['Kira', 'Artem'],
    json: true,
    market: 'En',
    strict: true
  })
}

function testSelectedDisabledClientIsReported(): void {
  const targets = buildTargets(baseState(), 'En', ['Kira'])

  assert.equal(targets.length, 1)
  assert.equal(targets[0].clientName, 'Kira')
  assert.equal(targets[0].enabled, false)
  assert.equal(targets[0].dolphinProfileId, 700001)
  assert.equal(targets[0].hasCanonicalHHAccount, true)
  assert.match(
    targets[0].problems.join('\n'),
    /HH autoresponses disabled for En/
  )
}

function testMissingSelectedClientIsReported(): void {
  const targets = buildTargets(baseState(), 'En', ['Missing Client'])

  assert.equal(targets.length, 1)
  assert.equal(targets[0].clientName, 'Missing Client')
  assert.equal(targets[0].clientId, 0)
  assert.deepEqual(targets[0].problems, ['client not found'])
}

function testUnselectedDisabledClientsStayHidden(): void {
  const targets = buildTargets(baseState(), 'En')

  assert.equal(targets.length, 1)
  assert.equal(targets[0].clientName, 'Artem')
  assert.equal(targets[0].enabled, true)
}

testParseArgs()
testSelectedDisabledClientIsReported()
testMissingSelectedClientIsReported()
testUnselectedDisabledClientsStayHidden()

console.log('noco:hh-response-readiness tests passed')
