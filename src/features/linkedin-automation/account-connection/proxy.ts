const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}

const SUPPORTED_PROTOCOLS = new Set(['http', 'https', 'socks4', 'socks5'])

function normalizeProtocol(value: unknown): 'http' | 'https' | 'socks4' | 'socks5' {
  const protocol = String(value ?? '').trim().toLowerCase().replace(/:$/, '')
  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    throw new LinkedInAuthError(
      'dolphin_proxy_protocol_unsupported',
      `Dolphin proxy protocol is unsupported: ${protocol || 'missing'}.`
    )
  }
  return protocol as 'http' | 'https' | 'socks4' | 'socks5'
}

function resolveLinkedInProxy(profile: any) {
  const proxy = profile?.proxy
  if (!proxy) {
    throw new LinkedInAuthError(
      'dolphin_proxy_missing',
      'The En Dolphin profile must have a custom proxy.'
    )
  }

  const host = String(proxy.host ?? proxy.server ?? proxy.ip ?? '').trim()
  const port = Number(proxy.port)
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new LinkedInAuthError(
      'dolphin_proxy_invalid',
      'The En Dolphin profile has an invalid proxy host or port.'
    )
  }
  if (proxy.lastCheck?.status === false) {
    throw new LinkedInAuthError(
      'dolphin_proxy_unhealthy',
      'The En Dolphin profile proxy failed its latest Dolphin health check.'
    )
  }

  return {
    host,
    port,
    protocol: normalizeProtocol(proxy.protocol ?? proxy.type),
    username: String(proxy.username ?? proxy.login ?? '').trim() || undefined,
    password: String(proxy.password ?? '').trim() || undefined
  }
}

function safeProxySummary(proxy: { protocol: string; username?: string }) {
  return { configured: true, protocol: proxy.protocol, authenticated: Boolean(proxy.username) }
}

module.exports = { normalizeProtocol, resolveLinkedInProxy, safeProxySummary }
