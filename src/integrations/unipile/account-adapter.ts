const { createUnipileHttpClient } = require('./http-client.ts') as {
  createUnipileHttpClient(options?: any): { request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> }
}

type LinkedInProxy = import('../../features/linkedin-automation/account-connection/types.ts').LinkedInProxy
type UnipileAccount = import('../../features/linkedin-automation/account-connection/types.ts').UnipileAccount
type UnipileAuthIntentResult = import('../../features/linkedin-automation/account-connection/types.ts').UnipileAuthIntentResult
type UnipileOwnProfile = import('../../features/linkedin-automation/account-connection/types.ts').UnipileOwnProfile

function unipileProxyProtocol(proxy: LinkedInProxy): LinkedInProxy['protocol'] {
  const isDataImpulse = proxy.host.trim().toLowerCase() === 'gw.dataimpulse.com'
  return isDataImpulse && proxy.protocol === 'socks5' ? 'https' : proxy.protocol
}

function authIntentPayload(input: {
  liAt: string
  userAgent: string
  proxy: LinkedInProxy
  accountId?: string
  state?: string
}) {
  return {
    provider: 'linkedin',
    ...(input.accountId ? { account_id: input.accountId } : {}),
    ...(input.state ? { state: input.state } : {}),
    credentials: {
      access_token: input.liAt,
      user_agent: input.userAgent
    },
    config: {
      products: ['classic'],
      custom_proxy: {
        host: input.proxy.host,
        port: input.proxy.port,
        protocol: unipileProxyProtocol(input.proxy),
        ...(input.proxy.username ? { username: input.proxy.username } : {}),
        ...(input.proxy.password ? { password: input.proxy.password } : {})
      }
    }
  }
}

function createUnipileAccountAdapter(http = createUnipileHttpClient()) {
  return {
    async authenticateLinkedIn(input: Parameters<typeof authIntentPayload>[0]) {
      return await http.request<UnipileAuthIntentResult>('POST', '/auth/intent', authIntentPayload(input))
    },
    async getAccount(accountId: string) {
      return await http.request<UnipileAccount>('GET', `/accounts/${encodeURIComponent(accountId)}`)
    },
    async getOwnProfile(accountId: string) {
      return await http.request<UnipileOwnProfile>(
        'GET', `/${encodeURIComponent(accountId)}/users/me`
      )
    }
  }
}

module.exports = { authIntentPayload, createUnipileAccountAdapter, unipileProxyProtocol }
