import { createRequire } from 'node:module'

type ProfileListQuery = Record<string, string | number | boolean | undefined>
type ProfileListRequest = <T>(path: string, options?: { query?: ProfileListQuery }) => Promise<T>

const { requestDolphinCloudApi } = createRequire(import.meta.url)('./cloud-api.ts') as {
  requestDolphinCloudApi: ProfileListRequest
}

export type DolphinProfilesPage<T> = {
  data: T[]
  per_page?: number
  total?: number
  next_page_url?: string | null
}

export async function getDolphinProfilesPage<T>(
  query: ProfileListQuery = {},
  request: ProfileListRequest = requestDolphinCloudApi
): Promise<DolphinProfilesPage<T>> {
  const response = await request<DolphinProfilesPage<T>>('/browser_profiles/list-cursor', {
    query: { ...query, limit: query.limit ?? 100 }
  })
  if (!response || !Array.isArray(response.data)) {
    throw new Error('Dolphin вернул некорректный список профилей: отсутствует массив data.')
  }
  return response
}

function nextCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && value) {
    try {
      const cursor = new URL(value, 'https://dolphin-anty-api.com').searchParams.get('cursor')
      if (cursor) return cursor
    } catch {}
  }
  throw new Error('Dolphin вернул некорректный next_page_url: отсутствует cursor.')
}

// Cursor contract: https://docs.dolphin-anty-cdn.com/openapi.yaml
// Reuse only the cursor, keeping the original filters and never following a supplied host.
export async function listAllDolphinProfiles<T extends { id?: number | string }>(
  query: ProfileListQuery = {},
  request: ProfileListRequest = requestDolphinCloudApi
): Promise<T[]> {
  const profiles = new Map<string, T>()
  const seenCursors = new Set<string>()
  let total: number | undefined
  let pageQuery = { ...query }
  if (typeof query.cursor === 'string') seenCursors.add(query.cursor)

  for (let page = 0; page < 10_000; page += 1) {
    const response = await getDolphinProfilesPage<T>(pageQuery, request)
    if (typeof response.total === 'number' && Number.isInteger(response.total) && response.total >= 0) {
      total = response.total
    }
    for (const profile of response.data) {
      const id = profile?.id
      if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim() ||
          (typeof id === 'number' && !Number.isFinite(id))) {
        throw new Error('Dolphin вернул профиль без корректного id.')
      }
      const key = String(id).trim()
      if (!profiles.has(key)) profiles.set(key, profile)
    }
    const cursor = nextCursor(response.next_page_url)
    if (cursor === undefined) {
      if (total !== undefined && profiles.size < total) {
        throw new Error(`Dolphin вернул неполный список профилей: получено ${profiles.size} из ${total}. Повторите чтение.`)
      }
      return [...profiles.values()]
    }
    if (seenCursors.has(cursor)) {
      throw new Error('Dolphin повторил cursor при получении списка профилей.')
    }
    seenCursors.add(cursor)
    pageQuery = { ...query, cursor }
  }
  throw new Error('Dolphin превысил лимит страниц списка профилей.')
}
