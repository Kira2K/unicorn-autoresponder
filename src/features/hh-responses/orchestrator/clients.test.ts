const assert = require('node:assert/strict')

const {
  attachHHAuthCredentials,
  attachHHAuthCredentialsBestEffort
} = require('./clients.ts')

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

async function main(): Promise<void> {
  await testStrictAttachStillThrows()
  await testBestEffortAttachSkipsOnlyBrokenClients()

  console.log('orchestrator client selection tests passed')
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
