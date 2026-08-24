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
  updateClientProfile(profile) {
    return request('/api/client/me', {
      method: 'PATCH',
      body: JSON.stringify(profile)
    })
  },
  clientProfileOptions() {
    return request('/api/client/profile-options')
  },
  createPlatformAccount(account) {
    return request('/api/client/platform-accounts', {
      method: 'POST',
      body: JSON.stringify(account)
    })
  },
  updatePlatformAccount(accountId, account) {
    return request(`/api/client/platform-accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify(account)
    })
  },
  deletePlatformAccount(accountId) {
    return request(`/api/client/platform-accounts/${accountId}`, { method: 'DELETE' })
  },
  providerClients() {
    return request('/api/provider/clients')
  },
  acquireDolphinLease(_targetClientName, targetClientId, options = {}) {
    return request('/api/dolphin/lease/acquire', {
      method: 'POST',
      body: JSON.stringify({ targetClientId, ...options })
    })
  },
  dolphinProfileStatus(targetClientId) {
    const query = targetClientId ? `?targetClientId=${encodeURIComponent(targetClientId)}` : ''
    return request(`/api/dolphin/profiles/status${query}`)
  },
  latestDolphinVerificationCode() {
    return request('/api/dolphin/verification-code/latest')
  },
  adminLatestClient() {
    return request('/api/admin/latest-client')
  },
  startHhResponsesDryRun() {
    return request('/api/admin/hh-responses/start', { method: 'POST' })
  },
  adminLinkedInAccounts() {
    return request('/api/admin/linkedin/accounts')
  },
  adminLinkedInHistory() {
    return request('/api/admin/linkedin/runs')
  },
  updateAdminLinkedInAccount(platformAccountId, payload) {
    return request(`/api/admin/linkedin/accounts/${encodeURIComponent(platformAccountId)}`, {
      method: 'PATCH', body: JSON.stringify(payload)
    })
  },
  startAdminLinkedInRun(platformAccountId, action) {
    return request(`/api/admin/linkedin/accounts/${encodeURIComponent(platformAccountId)}/runs`, {
      method: 'POST',
      body: JSON.stringify({ action })
    })
  },
  adminLinkedInRun(runId) {
    return request(`/api/admin/linkedin/runs/${encodeURIComponent(runId)}`)
  },
  startAdminProfilePreview(platformAccountId, profile) {
    return request(`/api/admin/linkedin/accounts/${encodeURIComponent(platformAccountId)}/profile-previews`, {
      method: 'POST', body: JSON.stringify(profile)
    })
  },
  adminProfileParameters(platformAccountId, type, keywords) {
    const query = new URLSearchParams({ type, keywords })
    return request(`/api/admin/linkedin/accounts/${encodeURIComponent(platformAccountId)}/profile-parameters?${query}`)
  },
  adminProfileJob(jobId) {
    return request(`/api/admin/linkedin/profile-jobs/${encodeURIComponent(jobId)}`)
  },
  adminProfileJobs() {
    return request('/api/admin/linkedin/profile-jobs')
  },
  analyzeAdminProfile(profile) {
    return request('/api/admin/linkedin/profile-analysis', {
      method: 'POST', body: JSON.stringify(profile)
    })
  },
  applyAdminProfileJob(jobId, planHash) {
    return request(`/api/admin/linkedin/profile-jobs/${encodeURIComponent(jobId)}/apply`, {
      method: 'POST', body: JSON.stringify({ planHash })
    })
  },
  rollbackAdminProfileJob(jobId) {
    return request(`/api/admin/linkedin/profile-jobs/${encodeURIComponent(jobId)}/rollback`, {
      method: 'POST'
    })
  },
  telegramStatus(params = {}) {
    const query = new URLSearchParams()
    if (params.targetClientId) query.set('targetClientId', params.targetClientId)
    if (params.platformAccountId) query.set('platformAccountId', params.platformAccountId)
    return request(`/api/telegram/status${query.toString() ? `?${query}` : ''}`)
  },
  telegramConnect(payload = {}) {
    return request('/api/telegram/connect', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },
  telegramDialogs(params = {}, options = {}) {
    const query = new URLSearchParams()
    if (params.targetClientId) query.set('targetClientId', params.targetClientId)
    if (params.platformAccountId) query.set('platformAccountId', params.platformAccountId)
    if (params.list) query.set('list', params.list)
    if (params.folderId) query.set('folderId', params.folderId)
    if (params.query) query.set('query', params.query)
    if (params.limit) query.set('limit', params.limit)
    if (params.privateOnly === true) query.set('privateOnly', 'true')
    return request(`/api/telegram/dialogs${query.toString() ? `?${query}` : ''}`, {
      signal: options.signal
    })
  },
  telegramFolders(params = {}) {
    const query = new URLSearchParams()
    if (params.targetClientId) query.set('targetClientId', params.targetClientId)
    if (params.platformAccountId) query.set('platformAccountId', params.platformAccountId)
    return request(`/api/telegram/folders${query.toString() ? `?${query}` : ''}`)
  },
  telegramMessages(params = {}, options = {}) {
    const query = new URLSearchParams()
    if (params.targetClientId) query.set('targetClientId', params.targetClientId)
    if (params.platformAccountId) query.set('platformAccountId', params.platformAccountId)
    if (params.chatId) query.set('chatId', params.chatId)
    if (params.limit) query.set('limit', params.limit)
    return request(`/api/telegram/messages${query.toString() ? `?${query}` : ''}`, {
      signal: options.signal
    })
  },
  telegramSend(payload = {}) {
    return request('/api/telegram/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },
  telegramRenameContact(payload = {}) {
    return request('/api/telegram/rename-contact', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },
  telegramReauth(payload = {}) {
    return request('/api/telegram/reauth', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },
  telegramDisconnect(payload = {}) {
    const query = new URLSearchParams()
    if (payload.platformAccountId) query.set('platformAccountId', payload.platformAccountId)
    if (payload.targetClientId) query.set('targetClientId', payload.targetClientId)
    return request(`/api/telegram/disconnect${query.toString() ? `?${query}` : ''}`, { method: 'DELETE' })
  },
  adminTelegramSenders(options = {}) {
    return request('/api/admin/telegram/senders', { signal: options.signal })
  },
  adminTelegramDialogScan(params = {}, options = {}) {
    const query = new URLSearchParams()
    query.set('days', params.days ?? 1)
    if (params.targetClientId) query.set('targetClientId', params.targetClientId)
    if (params.platformAccountId) query.set('platformAccountId', params.platformAccountId)
    return request(`/api/admin/telegram/dialogs/scan?${query}`, {
      signal: options.signal
    })
  },
  adminTelegramSend(payload = {}) {
    return request('/api/admin/telegram/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },
  adminCvTailorFromPdf(payload = {}) {
    return request('/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },
  adminClientTelegramSend(clientId, payload = {}) {
    return request(`/api/admin/clients/${encodeURIComponent(clientId)}/telegram/send`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }
}
