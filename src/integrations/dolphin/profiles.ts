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

type DolphinBrowserProfile = import('./types.ts').DolphinBrowserProfile
type DolphinProfileResponse = import('./types.ts').DolphinProfileResponse

async function getDolphinProfile(
  profileId: number
): Promise<DolphinBrowserProfile> {
  const response = await requestDolphinCloudApi<DolphinProfileResponse>(
    `/browser_profiles/${profileId}`
  )

  if (!response.data) {
    throw new Error(`Dolphin profile ${profileId} was not returned by API`)
  }

  return response.data
}

async function getDolphinProfileTags(profileId: number): Promise<string[]> {
  const profile = await getDolphinProfile(profileId)

  return Array.isArray(profile.tags) ? profile.tags : []
}

async function updateDolphinProfileTags(
  profileId: number,
  tags: string[]
): Promise<void> {
  await requestDolphinCloudApi<DolphinProfileResponse>(
    `/browser_profiles/${profileId}`,
    {
      method: 'PATCH',
      body: {
        tags
      }
    }
  )
}

function getDolphinProfileStatusId(
  profile: DolphinBrowserProfile
): number | null {
  const statusId = Number(profile.status?.id)

  return Number.isFinite(statusId) ? statusId : null
}

async function updateDolphinProfileStatus(
  profileId: number,
  statusId: number | null
): Promise<void> {
  await requestDolphinCloudApi<DolphinProfileResponse>(
    `/browser_profiles/${profileId}`,
    {
      method: 'PATCH',
      body: {
        statusId: statusId ?? 0
      }
    }
  )

  const verifiedStatusId = getDolphinProfileStatusId(
    await getDolphinProfile(profileId)
  )

  if (verifiedStatusId !== statusId) {
    throw new Error(
      `Dolphin profile ${profileId} status was not updated: expected ${String(statusId)}, got ${String(verifiedStatusId)}`
    )
  }
}

async function addDolphinProfileTag(
  profileId: number,
  tag: string
): Promise<void> {
  const tags = await getDolphinProfileTags(profileId)

  if (!tags.includes(tag)) {
    await updateDolphinProfileTags(profileId, [...tags, tag])
  }

  const verifiedTags = await getDolphinProfileTags(profileId)

  if (!verifiedTags.includes(tag)) {
    throw new Error(`Dolphin profile ${profileId} tag was not applied: ${tag}`)
  }
}

async function removeDolphinProfileTag(
  profileId: number,
  tag: string
): Promise<void> {
  const tags = await getDolphinProfileTags(profileId)
  const nextTags = tags.filter(item => item !== tag)

  if (nextTags.length !== tags.length) {
    await updateDolphinProfileTags(profileId, nextTags)
  }

  const verifiedTags = await getDolphinProfileTags(profileId)

  if (verifiedTags.includes(tag)) {
    throw new Error(`Dolphin profile ${profileId} tag was not removed: ${tag}`)
  }
}

module.exports = {
  addDolphinProfileTag,
  getDolphinProfile,
  getDolphinProfileStatusId,
  removeDolphinProfileTag,
  updateDolphinProfileStatus
}
