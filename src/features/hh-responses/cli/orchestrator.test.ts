const assert = require('node:assert/strict')

const {
  fetchSelectedClientsByUniqueNames,
  getRecommendedExternalTimeoutMs,
  runWithBoundedConcurrency
} = require('./orchestrator.ts') as {
  fetchSelectedClientsByUniqueNames(
    db: {
      getAutomationTargetByName?: (name: string, market?: 'Ru' | 'En') => Promise<any>
      getAutomationTargets: (options?: unknown) => Promise<any[]>
    },
    clientNames: string[]
  ): Promise<any[]>
  getRecommendedExternalTimeoutMs(
    clientCount: number,
    watchMs?: number,
    clientStartDelayMs?: number,
    concurrency?: number
  ): number | undefined
  runWithBoundedConcurrency<T, R>(
    items: T[],
    options: {
      concurrency: number
      startDelayMs: number
      runItem: (item: T, index: number) => Promise<R>
      getWaitMessage?: (item: T, index: number, waitMs: number) => string
    }
  ): Promise<R[]>
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function testDefaultSerialConcurrencyShape(): Promise<void> {
  let active = 0
  let maxActive = 0
  const startOrder: number[] = []

  const results = await runWithBoundedConcurrency([0, 1, 2, 3, 4, 5], {
    concurrency: 1,
    startDelayMs: 0,
    runItem: async (item, index) => {
      startOrder.push(index)
      active += 1
      maxActive = Math.max(maxActive, active)
      await wait(2)
      active -= 1

      return item * 10
    }
  })

  assert.equal(maxActive, 1)
  assert.deepEqual(startOrder, [0, 1, 2, 3, 4, 5])
  assert.deepEqual(results, [0, 10, 20, 30, 40, 50])
}

async function testConfiguredConcurrencyCapsActiveRuns(): Promise<void> {
  let active = 0
  let maxActive = 0

  await runWithBoundedConcurrency([0, 1, 2, 3, 4, 5], {
    concurrency: 2,
    startDelayMs: 0,
    runItem: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await wait(5)
      active -= 1

      return true
    }
  })

  assert.equal(maxActive, 2)
}

function testExternalTimeoutAccountsForClientBatches(): void {
  const serial = getRecommendedExternalTimeoutMs(4, 1000, 0, 1)
  const twoAtATime = getRecommendedExternalTimeoutMs(4, 1000, 0, 2)

  assert.equal(serial, 268400)
  assert.equal(twoAtATime, 266200)
}

async function testSelectedClientsFetchByNameWithoutAllTargets(): Promise<void> {
  const calls: unknown[] = []
  const clients = await fetchSelectedClientsByUniqueNames(
    {
      getAutomationTargets: async (options?: unknown) => {
        calls.push(options)

        return [
          {
            clientName: 'Artem',
            market: 'Ru'
          }
        ]
      }
    },
    ['Artem']
  )

  assert.deepEqual(calls, [{ market: 'Ru', clientNames: ['Artem'] }])
  assert.deepEqual(clients, [{ clientName: 'Artem', market: 'Ru' }])
}

async function main(): Promise<void> {
  await testDefaultSerialConcurrencyShape()
  await testConfiguredConcurrencyCapsActiveRuns()
  testExternalTimeoutAccountsForClientBatches()
  await testSelectedClientsFetchByNameWithoutAllTargets()

  console.log('orchestrator cli tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
