const assert = require('node:assert/strict')
const { createLinkedInAuthRunService } = require('./linkedin-auth-runs.ts') as {
  createLinkedInAuthRunService(options: any): import('./linkedin-auth-types.ts').LinkedInAuthRunService
}

async function nextTurn() {
  await new Promise(resolve => setImmediate(resolve))
}

async function run(): Promise<void> {
  let finish: (value: any) => void = () => undefined
  const writes: any[] = []
  const service = createLinkedInAuthRunService({
    repository: {
      async listAccounts() {
        return [{ platformAccountId: 10, clientName: 'Kira', linkedinUrl: 'https://linkedin.com/in/kira' }]
      }
    },
    async execute(_account: any, _action: any, onEvent: (event: any) => void) {
      onEvent({ stage: 'cdp_connected', status: 'succeeded' })
      return await new Promise(resolve => { finish = resolve })
    },
    history: {
      async start(value: any) { writes.push(['start', value.runId]) },
      async finish(value: any) { writes.push(['finish', value.status]) },
      async list() { return [{ runId: 'saved-run' }] }
    }
  })

  const accounts = await service.listAccounts()
  assert.equal(accounts[0].state, 'not_connected')
  const started = await service.start(10, 'connect')
  assert.equal(started.status, 'running')
  await assert.rejects(
    service.start(10, 'check'),
    (error: any) => error.code === 'linkedin_auth_run_active'
  )
  await nextTurn()
  assert.equal(service.get(started.runId)?.stage, 'cdp_connected')
  finish({ mode: 'connected', accountId: 'acc_1', liAt: 'SECRET_LI_AT' })
  await nextTurn()
  const completed = service.get(started.runId)
  assert.equal(completed?.status, 'succeeded')
  assert.equal(completed?.result?.accountId, 'acc_1')
  assert.equal(JSON.stringify(completed).includes('SECRET_LI_AT'), false)
  assert.deepEqual(await service.listHistory(), [{ runId: 'saved-run' }])
  assert.deepEqual(writes, [['start', started.runId], ['finish', 'succeeded']])
}

run()
  .then(() => console.log('linkedin auth run manager tests passed'))
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
