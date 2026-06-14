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

type ProfileAccessAction = 'add' | 'remove'

const FULL_PROFILE_ACCESS = {
  view: true,
  update: true,
  delete: true,
  share: true,
  usage: true
}

function uniqueProfileIds(profileIds: number[]): number[] {
  return [...new Set(profileIds.map(Number).filter(id => Number.isFinite(id) && id > 0))]
}

async function updateBrowserProfilesAccess(
  profileIds: number[],
  userId: number,
  action: ProfileAccessAction
): Promise<unknown> {
  const ids = uniqueProfileIds(profileIds)
  if (!ids.length) return { ok: true, skipped: true }

  return await requestDolphinCloudApi('/browser_profiles/access', {
    method: 'POST',
    body: {
      ids,
      users: [
        {
          id: userId,
          ...FULL_PROFILE_ACCESS
        }
      ],
      action
    }
  })
}

async function shareBrowserProfiles(profileIds: number[], userId: number): Promise<unknown> {
  return await updateBrowserProfilesAccess(profileIds, userId, 'add')
}

async function removeBrowserProfilesAccess(profileIds: number[], userId: number): Promise<unknown> {
  return await updateBrowserProfilesAccess(profileIds, userId, 'remove')
}

module.exports = {
  FULL_PROFILE_ACCESS,
  removeBrowserProfilesAccess,
  shareBrowserProfiles,
  uniqueProfileIds,
  updateBrowserProfilesAccess
}
