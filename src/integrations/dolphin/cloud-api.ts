const DOLPHIN_CLOUD_API_BASE_URL = 'https://dolphin-anty-api.com'

type DolphinCloudApiRequestOptions = {
  method?: 'GET' | 'PATCH' | 'POST' | 'DELETE' | 'PUT'
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

function buildDolphinCloudApiUrl(
  endpointPath: string,
  query?: DolphinCloudApiRequestOptions['query']
): string {
  const url = new URL(endpointPath, DOLPHIN_CLOUD_API_BASE_URL)

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  return url.toString()
}

function stringifyApiMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()

    return trimmed || undefined
  }

  if (value === undefined || value === null) {
    return undefined
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function requestDolphinCloudApi<T>(
  endpointPath: string,
  options: DolphinCloudApiRequestOptions = {}
): Promise<T> {
  const token = process.env.dolphin_api_token

  if (!token) {
    throw new Error('Missing required environment variable: dolphin_api_token')
  }

  const response = await fetch(buildDolphinCloudApiUrl(endpointPath, options.query), {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
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
      stringifyApiMessage(data?.message) ||
      stringifyApiMessage(data?.error) ||
      stringifyApiMessage(data) ||
      `Dolphin cloud API failed: ${response.status} ${response.statusText}`

    const error = new Error(message) as Error & { details?: any }
    error.details = data

    throw error
  }

  return data as T
}

module.exports = {
  buildDolphinCloudApiUrl,
  requestDolphinCloudApi
}
