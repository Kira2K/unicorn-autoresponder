const {
  DOLPHIN_HEADLESS,
  DOLPHIN_PROFILE_START_MAX_ATTEMPTS,
  DOLPHIN_PROFILE_START_RETRY_BASE_MS
} = require('../orchestrator/config.ts')
const { getErrorMessage, wait } = require('../orchestrator/runtime-utils.ts')
const { requestLocalDolphin } = require('./local-api.ts')

type DolphinStartResponse = import('./types.ts').DolphinStartResponse

const startedProfileIds = new Set<number>()

function getStartedProfileIds(): number[] {
  return [...startedProfileIds]
}

async function stopDolphinProfile(profileId: number): Promise<void> {
  await requestLocalDolphin(`/browser_profiles/${profileId}/stop`)
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
  const response = await requestLocalDolphin<DolphinStartResponse>(
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
      await wait(retryDelayMs)
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

module.exports = {
  getStartedProfileIds,
  startDolphinProfile,
  stopDolphinProfile,
  stopStartedProfiles
}
