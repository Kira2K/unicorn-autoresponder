const { DOLPHIN_LOCAL_API_BASE_URL } = require('../orchestrator/config.ts')

function stringifyApiMessage(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'string') {
    return value.trim() || undefined
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function requestLocalDolphin<T>(
  endpointPath: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
  } = {}
): Promise<T> {
  const response = await fetch(`${DOLPHIN_LOCAL_API_BASE_URL}${endpointPath}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const responseText = await response.text()
  let data: any = null

  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = responseText
  }

  if (!response.ok) {
    const message =
      stringifyApiMessage(data?.error) ||
      stringifyApiMessage(data?.message) ||
      stringifyApiMessage(data) ||
      `Dolphin local API failed: ${response.status} ${response.statusText}`

    const error = new Error(message) as Error & { details?: any }
    error.details = data

    throw error
  }

  return data as T
}

module.exports = {
  requestLocalDolphin
}
