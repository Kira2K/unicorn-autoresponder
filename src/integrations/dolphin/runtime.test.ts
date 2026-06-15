const assert = require('node:assert/strict')

process.env.DOLPHIN_PROFILE_STOP_VERIFY_INTERVAL_MS = '1'
process.env.DOLPHIN_PROFILE_STOP_VERIFY_MS = '2'

const {
  __resetDolphinRuntimeForTests,
  __setDolphinRuntimeTestDependencies,
  getStartedProfileIds,
  startDolphinProfile,
  stopDolphinProfile
} = require('./runtime.ts') as {
  __resetDolphinRuntimeForTests(): void
  __setDolphinRuntimeTestDependencies(overrides: Record<string, unknown>): void
  getStartedProfileIds(): number[]
  startDolphinProfile(profileId: number): Promise<unknown>
  stopDolphinProfile(profileId: number): Promise<void>
}

async function startTrackedProfile(profileId: number): Promise<void> {
  await startDolphinProfile(profileId)
  assert.deepEqual(getStartedProfileIds(), [profileId])
}

async function testStopFallsBackToProcessKill(): Promise<void> {
  __resetDolphinRuntimeForTests()
  let running = true
  const calls: string[] = []

  __setDolphinRuntimeTestDependencies({
    requestLocalDolphin: async (endpointPath: string) => {
      calls.push(endpointPath)
      return endpointPath.endsWith('/start')
        ? { automation: { port: 9222 } }
        : { success: true }
    },
    getRunningDolphinBrowserProfileIds: () => (running ? [101] : []),
    killDolphinBrowserProfileProcesses: (profileIds: number[]) => {
      assert.deepEqual(profileIds, [101])
      running = false
      return [{ processId: 1, parentProcessId: 0, profileId: 101 }]
    },
    wait: async () => undefined
  })

  await startTrackedProfile(101)
  await stopDolphinProfile(101)

  assert.deepEqual(calls, ['/browser_profiles/101/start', '/browser_profiles/101/stop'])
  assert.deepEqual(getStartedProfileIds(), [])
}

async function testStopKeepsTrackingWhenStillRunning(): Promise<void> {
  __resetDolphinRuntimeForTests()

  __setDolphinRuntimeTestDependencies({
    requestLocalDolphin: async (endpointPath: string) => {
      return endpointPath.endsWith('/start')
        ? { automation: { port: 9222 } }
        : { success: true }
    },
    getRunningDolphinBrowserProfileIds: () => [202],
    killDolphinBrowserProfileProcesses: () => [],
    wait: async () => undefined
  })

  await startTrackedProfile(202)
  await assert.rejects(
    () => stopDolphinProfile(202),
    /Dolphin profile 202 is still running/
  )
  assert.deepEqual(getStartedProfileIds(), [202])
}

async function testApiStopFailureCanStillCleanWithFallback(): Promise<void> {
  __resetDolphinRuntimeForTests()
  let running = true

  __setDolphinRuntimeTestDependencies({
    requestLocalDolphin: async (endpointPath: string) => {
      if (endpointPath.endsWith('/start')) {
        return { automation: { port: 9222 } }
      }

      throw new Error('local API stop failed')
    },
    getRunningDolphinBrowserProfileIds: () => (running ? [303] : []),
    killDolphinBrowserProfileProcesses: () => {
      running = false
      return [{ processId: 3, parentProcessId: 0, profileId: 303 }]
    },
    wait: async () => undefined
  })

  await startTrackedProfile(303)
  await stopDolphinProfile(303)
  assert.deepEqual(getStartedProfileIds(), [])
}

async function main(): Promise<void> {
  await testStopFallsBackToProcessKill()
  await testStopKeepsTrackingWhenStillRunning()
  await testApiStopFailureCanStillCleanWithFallback()
  __resetDolphinRuntimeForTests()
  console.log('dolphin runtime tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
