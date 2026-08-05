const assert = require('node:assert/strict')

const {
  attachHHAuthCredentials,
  attachHHAuthCredentialsBestEffort,
  excludeClients,
  selectClientsByCommonChatIdsBestEffort,
  selectClientsByUniqueNamesBestEffort
} = require('./clients.ts') as {
  attachHHAuthCredentials: Function
  attachHHAuthCredentialsBestEffort: Function
  excludeClients(
    clients: ClientAutomationData[],
    options: {
      clientNames?: string[]
      clientIds?: string[]
    }
  ): {
    clients: ClientAutomationData[]
    excluded: ClientAutomationData[]
  }
  selectClientsByCommonChatIdsBestEffort(
    clients: ClientAutomationData[],
    clientIds: string[]
  ): {
    clients: ClientAutomationData[]
    missingIds: string[]
  }
  selectClientsByUniqueNamesBestEffort(
    clients: ClientAutomationData[],
    clientNames: string[]
  ): {
    clients: ClientAutomationData[]
    missingNames: string[]
    ambiguousNames: Array<{
      clientName: string
      matchingIds: string[]
    }>
  }
}
const {
  attachBlockedCompanies,
  GLOBAL_BLOCKED_COMPANIES,
  mergeBlockedCompanies,
  parseRunExtraBlockedCompanies
} = require('./blocked-companies.ts') as {
  attachBlockedCompanies(clients: ClientAutomationData[]): ClientAutomationData[]
  GLOBAL_BLOCKED_COMPANIES: Array<{ id: string; name: string }>
  mergeBlockedCompanies(...sources: unknown[]): Array<{ id: string; name: string }>
  parseRunExtraBlockedCompanies(value?: string): Array<{ id: string; name: string }>
}

type ClientAutomationData = import('./types.ts').ClientAutomationData
type ClientHHAuthCredentials = import('./types.ts').ClientHHAuthCredentials

function makeClient(
  patch: Partial<ClientAutomationData> = {}
): ClientAutomationData {
  return {
    clientName: 'Kira',
    stack: 'Frontend',
    market: 'Ru',
    stackSheetName: 'FRONTEND',
    stackScenario: 'https://hh.ru/search/vacancy',
    dolphinProfileId: 123,
    commonChatId: '-100',
    ...patch
  }
}

function makeCredentials(
  clientName: string
): ClientHHAuthCredentials {
  return {
    clientName,
    market: 'Ru',
    phone: '9775442105',
    rawPhone: '+79775442105',
    email: 'client@example.test',
    password: 'temporary-password'
  }
}

function makeRepository(failingChatIds = new Set<string>()) {
  return {
    async getHHAuthCredentialsByCommonChatId(
      commonChatId: string
    ): Promise<ClientHHAuthCredentials> {
      if (failingChatIds.has(commonChatId)) {
        throw new Error(`No HH credentials for ${commonChatId}`)
      }

      return makeCredentials(`Client ${commonChatId}`)
    }
  }
}

async function testStrictAttachStillThrows(): Promise<void> {
  await assert.rejects(
    () =>
      attachHHAuthCredentials(
        [makeClient({ commonChatId: '-100' })],
        makeRepository(new Set(['-100']))
      ),
    /No HH credentials for -100/
  )
}

async function testBestEffortAttachSkipsOnlyBrokenClients(): Promise<void> {
  const result = await attachHHAuthCredentialsBestEffort(
    [
      makeClient({ clientName: 'Good', commonChatId: '-100' }),
      makeClient({ clientName: 'Broken', commonChatId: '-200' })
    ],
    makeRepository(new Set(['-200']))
  )

  assert.equal(result.clients.length, 1)
  assert.equal(result.clients[0].clientName, 'Good')
  assert.equal(result.clients[0].hhAuthCredentials?.clientName, 'Client -100')
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].client.clientName, 'Broken')
  assert.match(String(result.skipped[0].error), /No HH credentials for -200/)
}

function testExcludeClientsByNameAndId(): void {
  const result = excludeClients(
    [
      makeClient({ clientName: 'Kira', commonChatId: '-100' }),
      makeClient({ clientName: 'Good', commonChatId: '-200' }),
      makeClient({ clientName: 'Also Disabled', commonChatId: '-300' })
    ],
    {
      clientNames: ['Kira'],
      clientIds: ['-300']
    }
  )

  assert.deepEqual(
    result.clients.map(client => client.clientName),
    ['Good']
  )
  assert.deepEqual(
    result.excluded.map(client => client.commonChatId),
    ['-100', '-300']
  )
}

function testSelectedClientIdsBestEffortSkipsMissingIds(): void {
  const result = selectClientsByCommonChatIdsBestEffort(
    [
      makeClient({ clientName: 'First', commonChatId: '-100' }),
      makeClient({ clientName: 'Second', commonChatId: '-200' })
    ],
    ['-200', '-404', '-100', '-100']
  )

  assert.deepEqual(
    result.clients.map(client => client.commonChatId),
    ['-200', '-100']
  )
  assert.deepEqual(result.missingIds, ['-404'])
}

function testSelectedClientNamesBestEffortSkipsMissingAndAmbiguousNames(): void {
  const result = selectClientsByUniqueNamesBestEffort(
    [
      makeClient({ clientName: 'First', commonChatId: '-100' }),
      makeClient({ clientName: 'Duplicate', commonChatId: '-200' }),
      makeClient({ clientName: 'Duplicate', commonChatId: '-300' })
    ],
    ['First', 'Missing', 'Duplicate']
  )

  assert.deepEqual(
    result.clients.map(client => client.commonChatId),
    ['-100']
  )
  assert.deepEqual(result.missingNames, ['Missing'])
  assert.deepEqual(result.ambiguousNames, [
    {
      clientName: 'Duplicate',
      matchingIds: ['-200', '-300']
    }
  ])
}

function testBlockedCompaniesMergeAndRunExtras(): void {
  assert.deepEqual(GLOBAL_BLOCKED_COMPANIES, [
    { id: 'global-comtek', name: 'Comtek' }
  ])
  assert.deepEqual(
    mergeBlockedCompanies(
      [{ id: 'global-comtek', name: 'Comtek' }],
      [{ id: 'client-stop-list:1:comtek', name: ' comtek ' }],
      [{ id: 'client-stop-list:1:ozon', name: 'Ozon' }]
    ),
    [
      { id: 'global-comtek', name: 'Comtek' },
      { id: 'client-stop-list:1:ozon', name: 'Ozon' }
    ]
  )
  assert.deepEqual(parseRunExtraBlockedCompanies('Alpha, Beta; Gamma'), [
    { id: 'run-extra-stop-list:alpha', name: 'Alpha' },
    { id: 'run-extra-stop-list:beta', name: 'Beta' },
    { id: 'run-extra-stop-list:gamma', name: 'Gamma' }
  ])
}

function testAttachBlockedCompaniesUsesRunExtras(): void {
  const previous = process.env.ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES
  process.env.ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES = 'Alpha, Comtek'

  try {
    assert.deepEqual(
      attachBlockedCompanies([
        makeClient({
          blockedCompanies: [{ id: 'client-stop-list:1:ozon', name: 'Ozon' }]
        })
      ])[0].blockedCompanies,
      [
        { id: 'global-comtek', name: 'Comtek' },
        { id: 'client-stop-list:1:ozon', name: 'Ozon' },
        { id: 'run-extra-stop-list:alpha', name: 'Alpha' }
      ]
    )
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES
    } else {
      process.env.ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES = previous
    }
  }
}

async function main(): Promise<void> {
  await testStrictAttachStillThrows()
  await testBestEffortAttachSkipsOnlyBrokenClients()
  testExcludeClientsByNameAndId()
  testSelectedClientIdsBestEffortSkipsMissingIds()
  testSelectedClientNamesBestEffortSkipsMissingAndAmbiguousNames()
  testBlockedCompaniesMergeAndRunExtras()
  testAttachBlockedCompaniesUsesRunExtras()

  console.log('orchestrator client selection tests passed')
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
