const {
  DOLPHIN_HEADLESS,
  DOLPHIN_PROFILE_STOP_VERIFY_INTERVAL_MS,
  DOLPHIN_PROFILE_STOP_VERIFY_MS,
  DOLPHIN_PROFILE_START_MAX_ATTEMPTS,
  DOLPHIN_PROFILE_START_RETRY_BASE_MS
} = require('../../features/hh-responses/orchestrator/config.ts')
const { getErrorMessage, wait } = require('../../features/hh-responses/orchestrator/runtime-utils.ts')
const {
  getRunningDolphinBrowserProfileIds,
  killDolphinBrowserProfileProcesses
} = require('./preflight.ts') as {
  getRunningDolphinBrowserProfileIds(): number[]
  killDolphinBrowserProfileProcesses(profileIds: number[]): Array<{
    processId: number
    parentProcessId: number
    profileId: number
  }>
}
const { requestLocalDolphin } = require('./local-api.ts') as {
  requestLocalDolphin<T>(
    endpointPath: string,
    options?: {
      method?: 'GET' | 'POST'
      body?: unknown
    }
  ): Promise<T>
}

type DolphinStartResponse = import('./types.ts').DolphinStartResponse
type DolphinRuntimeDependencies = {
  getRunningDolphinBrowserProfileIds: () => number[]
  killDolphinBrowserProfileProcesses: typeof killDolphinBrowserProfileProcesses
  requestLocalDolphin: typeof requestLocalDolphin
  wait: typeof wait
}

const startedProfileIds = new Set<number>()
const defaultDependencies: DolphinRuntimeDependencies = {
  getRunningDolphinBrowserProfileIds,
  killDolphinBrowserProfileProcesses,
  requestLocalDolphin,
  wait
}
let dependencies = defaultDependencies

function getStartedProfileIds(): number[] {
  return [...startedProfileIds]
}

function isDolphinProfileRunning(profileId: number): boolean {
  return dependencies.getRunningDolphinBrowserProfileIds().includes(profileId)
}

async function waitForDolphinProfileToStop(profileId: number): Promise<boolean> {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= DOLPHIN_PROFILE_STOP_VERIFY_MS) {
    if (!isDolphinProfileRunning(profileId)) {
      return true
    }

    await dependencies.wait(DOLPHIN_PROFILE_STOP_VERIFY_INTERVAL_MS)
  }

  return !isDolphinProfileRunning(profileId)
}

async function stopDolphinProfile(profileId: number): Promise<void> {
  let stopError: unknown

  try {
    await dependencies.requestLocalDolphin(`/browser_profiles/${profileId}/stop`)
  } catch (error: unknown) {
    stopError = error
    console.warn(
      `Dolphin local stop failed for profile ${profileId}: ${getErrorMessage(error)}`
    )
  }

  if (!(await waitForDolphinProfileToStop(profileId))) {
    const killedProcesses = dependencies.killDolphinBrowserProfileProcesses([profileId])
    if (killedProcesses.length) {
      console.warn(
        `Dolphin stop fallback terminated ${killedProcesses.length} leftover anty.exe process(es) ` +
          `for profile ${profileId}`
      )
    }
  }

  if (!(await waitForDolphinProfileToStop(profileId))) {
    throw new Error(
      `Dolphin profile ${profileId} is still running after local stop` +
        (stopError ? `: ${getErrorMessage(stopError)}` : '')
    )
  }

  startedProfileIds.delete(profileId)
}

async function stopStartedProfiles(): Promise<void> {
  const profileIds = getStartedProfileIds()

  if (!profileIds.length) {
    return
  }

  await Promise.all(
    profileIds.map(async profileId => {
      try {
        await stopDolphinProfile(profileId)
      } catch (error: unknown) {
        console.error(
          `Failed to stop Dolphin profile ${profileId}: ${getErrorMessage(error)}`
        )
      }
    })
  )
}

function isAlreadyRunningError(error: any): boolean {
  const duplicateCode = error?.details?.errorObject?.code
  const message = String(
    error?.message ?? error?.details?.error ?? error?.details?.message ?? ''
  ).toLowerCase()

  return (
    duplicateCode === 'E_BROWSER_RUN_DUPLICATE' ||
    message.includes('already running')
  )
}

function isProfileStartBusyError(error: any): boolean {
  const message = String(
    error?.message ?? error?.details?.error ?? error?.details?.message ?? ''
  ).toLowerCase()

  return (
    isAlreadyRunningError(error) ||
    message.includes('ebusy') ||
    message.includes('resource busy') ||
    message.includes('devtoolsactiveport') ||
    message.includes('profile is locked') ||
    message.includes('still running')
  )
}

function isAlreadyRunningResponse(response: DolphinStartResponse): boolean {
  const message = String(
    response.error ?? response.errorObject?.text ?? ''
  ).toLowerCase()

  return (
    response.errorObject?.code === 'E_BROWSER_RUN_DUPLICATE' ||
    message.includes('already running')
  )
}

async function requestDolphinProfileStart(
  profileId: number,
  body: {
    automation: boolean
    headless: boolean
  }
): Promise<DolphinStartResponse> {
  const response = await dependencies.requestLocalDolphin<DolphinStartResponse>(
    `/browser_profiles/${profileId}/start`,
    {
      method: 'POST',
      body
    }
  )

  if (response.success === false || isAlreadyRunningResponse(response)) {
    const error = new Error(
      response.error ||
        response.errorObject?.text ||
        'Dolphin profile start failed'
    ) as Error & {
      details?: DolphinStartResponse
    }
    error.details = response

    throw error
  }

  return response
}

async function startDolphinProfileWithHeadless(
  profileId: number,
  headless: boolean
): Promise<DolphinStartResponse> {
  const body = {
    automation: true,
    headless
  }
  const maxAttempts = DOLPHIN_PROFILE_START_MAX_ATTEMPTS

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await requestDolphinProfileStart(profileId, body)
      startedProfileIds.add(profileId)

      return response
    } catch (error: any) {
      if (!isProfileStartBusyError(error) || attempt === maxAttempts) {
        throw error
      }

      const retryDelayMs = DOLPHIN_PROFILE_START_RETRY_BASE_MS * attempt
      console.warn(
        `Dolphin profile ${profileId} is busy before start attempt ` +
          `${attempt + 1}/${maxAttempts}; stopping and waiting ${retryDelayMs}ms`
      )
      await stopDolphinProfile(profileId).catch(() => undefined)
      await dependencies.wait(retryDelayMs)
    }
  }

  throw new Error(
    `Dolphin profile ${profileId} did not start after ${maxAttempts} attempts`
  )
}

async function startDolphinProfile(
  profileId: number
): Promise<DolphinStartResponse> {
  return await startDolphinProfileWithHeadless(profileId, DOLPHIN_HEADLESS)
}

function __setDolphinRuntimeTestDependencies(
  overrides: Partial<DolphinRuntimeDependencies>
): void {
  dependencies = {
    ...defaultDependencies,
    ...overrides
  }
}

function __resetDolphinRuntimeForTests(): void {
  dependencies = defaultDependencies
  startedProfileIds.clear()
}

module.exports = {
  __resetDolphinRuntimeForTests,
  __setDolphinRuntimeTestDependencies,
  getStartedProfileIds,
  startDolphinProfile,
  stopDolphinProfile,
  stopStartedProfiles
}
