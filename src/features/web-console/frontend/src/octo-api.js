async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.message || body.error || `Request failed: ${response.status}`)
    error.status = response.status
    throw error
  }
  return body
}

export const octoApi = {
  profileStatus(options = {}) {
    return request('/api/octo/profiles/status', { signal: options.signal })
  },
  startOnboarding(payload, options = {}) {
    return request('/api/octo/onboarding', {
      method: 'POST', body: JSON.stringify(payload), signal: options.signal
    })
  },
  saveNodeMavenKey(key, options = {}) {
    return request('/api/octo/nodemaven-key', {
      method: 'PUT', body: JSON.stringify({ key: String(key).trim() }), signal: options.signal
    })
  },
  locations(level, location = {}, options = {}) {
    const query = new URLSearchParams({ level })
    if (location.country) query.set('country', location.country)
    if (location.region) query.set('region', location.region)
    return request(`/api/octo/locations?${query}`, { signal: options.signal })
  },
  continueOnboarding(id, options = {}) {
    return request(`/api/octo/onboarding/${encodeURIComponent(id)}/continue`, {
      method: 'POST', body: JSON.stringify({ acceptLowScore: true }), signal: options.signal
    })
  },
  ensureProfiles(ownProxy, options = {}) {
    return request('/api/octo/profiles/ensure', {
      method: 'POST', body: JSON.stringify({ ownProxy: Boolean(ownProxy) }), signal: options.signal
    })
  },
  requestGrant(profileId, options = {}) {
    return request('/api/octo/grants', {
      method: 'POST', body: JSON.stringify({ profileId }), signal: options.signal
    })
  },
  grant(id, options = {}) {
    return request(`/api/octo/grants/${encodeURIComponent(id)}`, { signal: options.signal })
  },
  saveProxy(profileId, draft, options = {}) {
    return request(`/api/octo/profiles/${encodeURIComponent(profileId)}/proxy`, {
      method: 'POST', body: JSON.stringify(octoProxyPayload(draft)), signal: options.signal
    })
  }
}

export function octoProxyDraft(proxy = {}) {
  return { type: proxy.type || 'http', host: proxy.host || '', port: proxy.port ?? '', login: '', password: '', changeIpUrl: '' }
}

export function octoProxyPayload(draft) {
  const type = draft.type, host = String(draft.host || '').trim(), port = Number(draft.port)
  if (!['http', 'https', 'socks4', 'socks5'].includes(type) || !host || /\s/.test(host) ||
      !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_proxy_fields')
  const changeIpUrl = String(draft.changeIpUrl || '').trim()
  if (changeIpUrl) {
    let url
    try { url = new URL(changeIpUrl) } catch { throw new Error('invalid_proxy_fields') }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_proxy_fields')
  }
  return { type, host, port, login: draft.login || '', password: draft.password || '', ...(changeIpUrl ? { changeIpUrl } : {}) }
}

// Secrets enter the view only for a valid, currently granted access window.
export function octoGrantForDisplay(grant, now = Date.now()) {
  const { password, guest, ...publicFields } = grant
  const expiresAt = typeof grant.expiresAt === 'number' ? grant.expiresAt : NaN
  publicFields.expiresAt = Number.isFinite(expiresAt) ? expiresAt : undefined
  if (grant.phase !== 'granted' || !Number.isFinite(expiresAt) || expiresAt <= now ||
      typeof password !== 'string' || !/^\d{5}$/.test(password)) return publicFields
  return { ...publicFields, password, ...(guest ? { guest: { email: guest.email, password: guest.password } } : {}) }
}
