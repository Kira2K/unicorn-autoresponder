const {
  AUTOMATION_LOCK_STATUS_COLOR,
  AUTOMATION_LOCK_STATUS_NAME
} = require('../orchestrator/config.ts')
const { requestDolphinCloudApi } = require('./cloud-api.ts') as {
  requestDolphinCloudApi<T>(
    endpointPath: string,
    options?: {
      method?: 'GET' | 'PATCH' | 'POST' | 'DELETE' | 'PUT'
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
    }
  ): Promise<T>
}

type DolphinProfileStatusListResponse =
  import('./types.ts').DolphinProfileStatusListResponse
type DolphinProfileStatusResponse =
  import('./types.ts').DolphinProfileStatusResponse

let automationLockStatusId: number | undefined

async function ensureAutomationLockStatusId(): Promise<number> {
  if (automationLockStatusId !== undefined) {
    return automationLockStatusId
  }

  const statuses =
    await requestDolphinCloudApi<DolphinProfileStatusListResponse>(
      '/browser_profiles/statuses?limit=50'
    )
  const existingStatus = statuses.data?.find(
    status =>
      status.name === AUTOMATION_LOCK_STATUS_NAME && status.deleted !== 1
  )
  const existingStatusId = Number(existingStatus?.id)

  if (Number.isFinite(existingStatusId)) {
    automationLockStatusId = existingStatusId
    return automationLockStatusId
  }

  const createdStatus =
    await requestDolphinCloudApi<DolphinProfileStatusResponse>(
      '/browser_profiles/statuses',
      {
        method: 'POST',
        body: {
          name: AUTOMATION_LOCK_STATUS_NAME,
          color: AUTOMATION_LOCK_STATUS_COLOR,
          type: 'common'
        }
      }
    )
  const createdStatusId = Number(createdStatus.data?.id)

  if (!Number.isFinite(createdStatusId)) {
    throw new Error(
      `Dolphin automation status was not created: ${AUTOMATION_LOCK_STATUS_NAME}`
    )
  }

  automationLockStatusId = createdStatusId
  return automationLockStatusId
}

module.exports = {
  ensureAutomationLockStatusId
}
