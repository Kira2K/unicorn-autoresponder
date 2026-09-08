export function textApi(token = () => '') {
  return async (path = '', method = 'GET', body) => {
    const response = await fetch(`/api/post-writer/text${path}`, { method, credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(value.message || 'Не удалось выполнить запрос Writer')
    return value
  }
}
