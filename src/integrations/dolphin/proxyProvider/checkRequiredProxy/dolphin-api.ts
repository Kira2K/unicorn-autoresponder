const { requestDolphinCloudApi } = require('../../cloud-api.ts') as {
  requestDolphinCloudApi<T>(
    endpointPath: string,
    options?: {
      method?: 'GET' | 'PATCH' | 'POST' | 'DELETE' | 'PUT'
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
    }
  ): Promise<T>
}

type DolphinPaginatedResponse<T> = {
  current_page?: number
  last_page?: number
  per_page?: number
  total?: number
  data?: T[]
}

type DolphinProxy = {
  id?: number | string
  name?: string | null
  type?: string
  browser_profiles_count?: number
  lastCheck?: {
    status?: boolean
  } | null
}

type DolphinProfile = {
  id?: number | string
  name?: string
  proxyId?: number | string | null
  proxy?: DolphinProxy | null
}

type DolphinProfileResponse = {
  data?: DolphinProfile
}

function toSafeProxy(proxy: DolphinProxy | null | undefined) {
  if (!proxy) {
    return null
  }

  return {
    id: proxy.id,
    name: String(proxy.name ?? '').trim(),
    type: proxy.type,
    browserProfilesCount: proxy.browser_profiles_count,
    lastCheckStatus: proxy.lastCheck?.status ?? null
  }
}

async function getDolphinProfileSnapshot(profileId: string) {
  const response = await requestDolphinCloudApi<DolphinProfileResponse>(
    `/browser_profiles/${profileId}`
  )
  const profile = response.data

  if (!profile) {
    throw new Error(`Dolphin profile ${profileId} was not returned by API`)
  }

  return {
    id: String(profile.id ?? profileId),
    name: profile.name,
    proxyId:
      profile.proxyId === undefined || profile.proxyId === null
        ? undefined
        : String(profile.proxyId),
    proxy: toSafeProxy(profile.proxy)
  }
}

function toSafeProfile(profile: DolphinProfile) {
  return {
    id: String(profile.id ?? ''),
    name: String(profile.name ?? '').trim(),
    proxyId:
      profile.proxyId === undefined || profile.proxyId === null
        ? undefined
        : String(profile.proxyId),
    proxy: toSafeProxy(profile.proxy)
  }
}

async function getAllDolphinProfileSnapshots() {
  const limit = 100
  const profiles = []
  let page = 1
  let total = Number.POSITIVE_INFINITY

  while (profiles.length < total) {
    const response = await requestDolphinCloudApi<
      DolphinPaginatedResponse<DolphinProfile>
    >('/browser_profiles', {
      query: {
        limit,
        page
      }
    })
    const data = response.data ?? []

    profiles.push(...data.map(toSafeProfile).filter(profile => profile.id))
    total = response.total ?? profiles.length

    if (!data.length || page >= (response.last_page ?? page)) {
      break
    }

    page += 1
  }

  return profiles
}

async function getAllDolphinProxySnapshots() {
  const limit = 100
  const proxies = []
  let page = 1
  let total = Number.POSITIVE_INFINITY

  while (proxies.length < total) {
    const response = await requestDolphinCloudApi<
      DolphinPaginatedResponse<DolphinProxy>
    >('/proxy', {
      query: {
        limit,
        page
      }
    })
    const data = response.data ?? []

    proxies.push(...data.map(toSafeProxy).filter(Boolean))
    total = response.total ?? proxies.length

    if (!data.length || page >= (response.last_page ?? page)) {
      break
    }

    page += 1
  }

  return proxies
}

module.exports = {
  getAllDolphinProfileSnapshots,
  getAllDolphinProxySnapshots,
  getDolphinProfileSnapshot
}
