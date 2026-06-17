const DOLPHIN_API_V2_BASE_URL = 'https://apiv2.dolphin-anty-api.com/api/v2'

type TeamUser = {
  id: number
  username: string
  role: string
}

type TeamUserCredentialPatch = {
  username?: string
  password: string
  displayName?: string
}

function buildTeamUserCredentialPatch(patch: TeamUserCredentialPatch): {
  username?: string
  password: string
  displayName?: string
} {
  const body: { username?: string; password: string; displayName?: string } = {
    password: patch.password
  }
  if (patch.username) body.username = patch.username
  if (patch.displayName) body.displayName = patch.displayName
  return body
}

function getDolphinApiToken(): string {
  const token = String(process.env.dolphin_api_token ?? '').trim()

  if (!token) {
    throw new Error('Missing required environment variable: dolphin_api_token')
  }

  return token
}

function stringifyApiMessage(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.trim() || undefined

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function requestDolphinApiV2<T>(
  endpointPath: string,
  options: { method?: 'GET' | 'PATCH'; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${DOLPHIN_API_V2_BASE_URL}${endpointPath}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${getDolphinApiToken()}`,
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
      `Dolphin API v2 failed: ${response.status} ${response.statusText}`
    const error = new Error(message) as Error & { details?: any; status?: number }
    error.details = data
    error.status = response.status
    throw error
  }

  return data as T
}

async function listTeamUsers(): Promise<TeamUser[]> {
  const response = await requestDolphinApiV2<{ data?: TeamUser[] }>('/team/users?limit=100&page=1')
  return response.data ?? []
}

async function updateTeamUserCredentials(
  userId: number,
  patch: TeamUserCredentialPatch
): Promise<unknown> {
  return await requestDolphinApiV2(`/team/users/${userId}`, {
    method: 'PATCH',
    body: buildTeamUserCredentialPatch(patch)
  })
}

module.exports = {
  buildTeamUserCredentialPatch,
  listTeamUsers,
  requestDolphinApiV2,
  updateTeamUserCredentials
}
