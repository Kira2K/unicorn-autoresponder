async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.message || body.error || `Request failed: ${response.status}`)
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

export const api = {
  login(email, password) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })
  },
  me() {
    return request('/api/auth/me')
  },
  logout() {
    return request('/api/auth/logout', { method: 'POST' })
  },
  clientDashboard() {
    return request('/api/client/me')
  },
  providerClients() {
    return request('/api/provider/clients')
  },
  acquireDolphinLease(_targetClientName, targetClientId) {
    return request('/api/dolphin/lease/acquire', {
      method: 'POST',
      body: JSON.stringify({ targetClientId })
    })
  },
  adminLatestClient() {
    return request('/api/admin/latest-client')
  },
  startHhResponsesDryRun() {
    return request('/api/admin/hh-responses/start', { method: 'POST' })
  }
}
