const fs = require('node:fs/promises')
const path = require('node:path')

require('dotenv').config({ quiet: true })

const DOLPHIN_API_BASE_URL = 'https://dolphin-anty-api.com'
const PROFILES_EXPORT_FILE = path.resolve(__dirname, 'dolphin-profiles.json')

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'

type ApiRequestOptions = {
  method?: HttpMethod
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

type DolphinLoginResponse = {
  message?: string
  userId?: number
}

type DolphinPaginatedResponse<T> = {
  current_page?: number
  last_page?: number
  per_page?: number
  total?: number
  data: T[]
}

type DolphinBrowserProfile = {
  id: number | string
  name?: string
  status?: string
  createdAt?: string
  updatedAt?: string
}

type DolphinProxy = {
  id: number
  name: string | null
  type: string
  host: string
  port: number
  status?: boolean
  createdAt?: string
  updatedAt?: string
}

const dolphinApiToken: string | undefined = process.env.dolphin_api_token

if (!dolphinApiToken) {
  throw new Error('Missing required environment variable: dolphin_api_token')
}

console.log(dolphinApiToken)

function buildUrl(path: string, query?: ApiRequestOptions['query']): string {
  const url = new URL(path, DOLPHIN_API_BASE_URL)

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  return url.toString()
}

async function requestDolphinApi<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const method = options.method ?? 'GET'
  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers: {
      Authorization: `Bearer ${dolphinApiToken}`,
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
      data?.message ||
      data?.error ||
      (typeof data === 'string' && data.trim()) ||
      `Dolphin API request failed: ${response.status} ${response.statusText}`

    throw new Error(message)
  }

  return data as T
}

async function loginWithToken(): Promise<DolphinLoginResponse> {
  return requestDolphinApi<DolphinLoginResponse>('/v1.0/auth/login-with-token', {
    method: 'POST',
    body: {
      token: dolphinApiToken
    }
  })
}

async function getBrowserProfiles(
  limit = 10
): Promise<DolphinPaginatedResponse<DolphinBrowserProfile>> {
  return requestDolphinApi<DolphinPaginatedResponse<DolphinBrowserProfile>>(
    '/browser_profiles',
    {
      query: {
        limit
      }
    }
  )
}

async function getAllBrowserProfiles(): Promise<DolphinBrowserProfile[]> {
  const limit = 100
  const firstPage = await requestDolphinApi<DolphinPaginatedResponse<DolphinBrowserProfile>>(
    '/browser_profiles',
    {
      query: {
        limit
      }
    }
  )

  const profiles = [...firstPage.data]
  const total = firstPage.total ?? profiles.length
  let currentPage = firstPage.current_page ?? 1

  while (profiles.length < total) {
    currentPage += 1

    const nextPage = await requestDolphinApi<DolphinPaginatedResponse<DolphinBrowserProfile>>(
      '/browser_profiles',
      {
        query: {
          limit,
          page: currentPage
        }
      }
    )

    if (!nextPage.data.length) {
      break
    }

    profiles.push(...nextPage.data)
  }

  return profiles
}

async function getProxies(limit = 10): Promise<DolphinPaginatedResponse<DolphinProxy>> {
  return requestDolphinApi<DolphinPaginatedResponse<DolphinProxy>>('/proxy', {
    query: {
      limit
    }
  })
}

async function exportBrowserProfilesToJson(
  filePath = PROFILES_EXPORT_FILE
): Promise<string> {
  const profiles = await getAllBrowserProfiles()
  const payload = {
    exportedAt: new Date().toISOString(),
    total: profiles.length,
    profiles
  }

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')

  return filePath
}

async function connectToDolphinApi(): Promise<void> {
  const profiles = await getBrowserProfiles(1)
  console.log('Connected to Dolphin Anty API')
  console.log(`Browser profiles available: ${profiles.total ?? profiles.data.length}`)

  const exportPath = await exportBrowserProfilesToJson()
  console.log(`Profiles exported to ${exportPath}`)
}

if (require.main === module) {
  connectToDolphinApi().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
}

module.exports = {
  connectToDolphinApi,
  dolphinApiToken,
  exportBrowserProfilesToJson,
  getAllBrowserProfiles,
  getBrowserProfiles,
  getProxies,
  loginWithToken,
  requestDolphinApi
}
