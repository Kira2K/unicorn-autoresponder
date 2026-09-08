const root = account => `/api/admin/linkedin/accounts/${account}/post-writer`
async function request(path, method = 'GET', body) {
  const response = await fetch(path, { method, credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Не удалось получить Post Writer')
  return data
}
export const postApi = {
  get: account => request(root(account)),
  settings: (account, settings) => request(`${root(account)}/settings`, 'PUT', settings),
  start: (account, mode, requestKey, input = {}) => request(`${root(account)}/runs`, 'POST', { ...input, mode, requestKey }),
  policy: () => request('/api/admin/linkedin/post-writer/policy'),
  savePolicy: value => request('/api/admin/linkedin/post-writer/policy', 'PUT', value),
  action: (run, action, memeReviewedHash) => request(`/api/admin/linkedin/post-runs/${run.id}/${action}`, 'POST',
    { contentHash: run.hash, memeReviewedHash }),
  events: account => `${root(account)}/events`
}
