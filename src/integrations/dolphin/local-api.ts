const { DOLPHIN_LOCAL_API_BASE_URL } = require('../../features/hh-responses/orchestrator/config.ts')

type LocalDolphinRequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  retryAuth?: boolean
}

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

function getDolphinApiToken(): string {
  const token = String(process.env.dolphin_api_token ?? '').trim()

  if (!token) {
    throw new Error('Missing required environment variable: dolphin_api_token')
  }

  return token
}

function isDolphinLocalSessionError(status: number, data: any): boolean {
  const text = [
    data?.error,
    data?.message,
    typeof data === 'string' ? data : undefined,
    stringifyApiMessage(data)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    status === 401 ||
    text.includes('invalid session token') ||
    text.includes('token refresh timeout') ||
    text.includes('refresh token') ||
    text.includes('unauthorized')
  )
}

async function loginLocalDolphinWithToken(): Promise<unknown> {
  return await requestLocalDolphin('/auth/login-with-token', {
    method: 'POST',
    body: {
      token: getDolphinApiToken()
    },
    retryAuth: false
  })
}

async function requestLocalDolphin<T>(
  endpointPath: string,
  options: LocalDolphinRequestOptions = {}
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
    if (
      options.retryAuth !== false &&
      endpointPath !== '/auth/login-with-token' &&
      isDolphinLocalSessionError(response.status, data)
    ) {
      await loginLocalDolphinWithToken()

      return await requestLocalDolphin<T>(endpointPath, {
        ...options,
        retryAuth: false
      })
    }

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
  isDolphinLocalSessionError,
  loginLocalDolphinWithToken,
  requestLocalDolphin
}
