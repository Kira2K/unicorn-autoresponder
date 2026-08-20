const { requestDolphinCloudApi } = require('./cloud-api.ts') as {
  requestDolphinCloudApi<T>(path: string, options?: any): Promise<T>
}
const { getDolphinProfile } = require('./profiles.ts') as {
  getDolphinProfile(id: number): Promise<any>
}

function hasProxyConnection(proxy: any): boolean {
  return Boolean(proxy?.host ?? proxy?.server ?? proxy?.ip)
}

async function getDolphinProfileWithProxy(
  profileId: number,
  dependencies: {
    getProfile(id: number): Promise<any>
    request<T>(path: string, options?: any): Promise<T>
  } = { getProfile: getDolphinProfile, request: requestDolphinCloudApi }
) {
  const profile = await dependencies.getProfile(profileId)
  if (hasProxyConnection(profile?.proxy)) return profile

  const proxyId = profile?.proxyId ?? profile?.proxy?.id
  if (proxyId === undefined || proxyId === null || proxyId === '') return profile
  const response = await dependencies.request<any>('/proxy', {
    query: { ids: String(proxyId) }
  })
  const proxies = Array.isArray(response?.data) ? response.data : [response?.data]
  const proxy = proxies.find((item: any) => String(item?.id ?? '') === String(proxyId))
  return proxy ? { ...profile, proxy } : profile
}

async function createAndAttachDolphinProxy(
  profileId: number,
  proxy: any,
  request: typeof requestDolphinCloudApi = requestDolphinCloudApi
) {
  const created = await request<any>('/proxy', {
    method: 'POST',
    body: {
      type: proxy.type, host: proxy.host, port: proxy.port,
      ...(proxy.login ? { login: proxy.login } : {}),
      ...(proxy.password ? { password: proxy.password } : {}),
      name: `LinkedIn auth | Dolphin ${profileId}`
    }
  })
  const proxyId = Number(created?.data?.id)
  if (!Number.isFinite(proxyId) || proxyId <= 0) {
    throw new Error('Dolphin did not return the created proxy ID.')
  }
  await request(`/browser_profiles/${profileId}`, {
    method: 'PATCH', body: { proxy: { id: proxyId } }
  })
}

module.exports = {
  createAndAttachDolphinProxy,
  getDolphinProfileWithProxy,
  hasProxyConnection
}
