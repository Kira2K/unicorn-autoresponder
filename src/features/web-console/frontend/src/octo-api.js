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
  }
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
