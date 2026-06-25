const { requestDolphinCloudApi } = require('../../../integrations/dolphin/cloud-api.ts') as {
  requestDolphinCloudApi<T>(
    endpointPath: string,
    options?: {
      method?: 'GET' | 'PATCH' | 'POST' | 'DELETE' | 'PUT'
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
    }
  ): Promise<T>
}

type WebClient = import('./types.ts').WebClient
type WebConsoleRepository = import('./types.ts').WebConsoleRepository

type Locale = 'ru' | 'en'

type DolphinProfileRecord = {
  id: number
  locale: string
}

type DolphinProxySnapshot = {
  id?: number | string
  name?: string
  type?: string
  host?: string
  port?: number | string
  login?: string
  password?: string
  changeIpUrl?: string
  provider?: string
  browser_profiles_count?: number
  browserProfilesCount?: number
}

type DolphinProvisionResult = {
  created: Array<{ locale: Locale; profileId: number; profileName: string; proxyId?: number; proxyName?: string }>
  skippedSuspiciousProxies: DolphinProxySnapshot[]
  extraNamedProxies: DolphinProxySnapshot[]
}

type DolphinProvisioner = {
  ensureClientProfiles(input: {
    client: WebClient
    existingProfiles: DolphinProfileRecord[]
    actorRole: 'client' | 'admin'
    ownProxy?: boolean
  }): Promise<DolphinProvisionResult>
}

type DolphinProvisioningApi = {
  getProfile(profileId: number): Promise<Record<string, any>>
  listProfiles?(): Promise<Record<string, any>[]>
  createProfile(payload: Record<string, any>): Promise<Record<string, any>>
  listProxies(): Promise<DolphinProxySnapshot[]>
  updateProxy(proxyId: number, patch: Record<string, any>): Promise<unknown>
  updateProfileTags(profileId: number, tags: string[]): Promise<unknown>
}

const CREATE_PROFILE_FIELDS = [
  'platform',
  'platformVersion',
  'browserType',
  'mainWebsite',
  'statusId',
  'args',
  'notes',
  'fingerprint',
  'uaFullVersion',
  'folderId',
  'folder',
  'homepages',
  'newHomepages',
  'fontsMode',
  'fonts',
  'macAddress',
  'deviceName',
  'audio',
  'isHiddenProfileName',
  'disableLoadWebCameraAndCookies',
  'enableArgIsChromeIcon',
  'doNotTrack',
  'useragent',
  'webrtc',
  'canvas',
  'webgl',
  'webgpu',
  'webgl2Maximum',
  'webglInfo',
  'clientRect',
  'timezone',
  'locale',
  'geolocation',
  'cpu',
  'memory',
  'screen',
  'connectionDownlink',
  'connectionEffectiveType',
  'connectionRtt',
  'connectionSaveData',
  'platformName',
  'cpuArchitecture',
  'osVersion',
  'screenWidth',
  'screenHeight',
  'vendorSub',
  'productSub',
  'vendor',
  'product',
  'appCodeName',
  'mediaDevices',
  'userFields',
  'ports',
  'tabs'
]

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: 'A', а: 'a', Б: 'B', б: 'b', В: 'V', в: 'v', Г: 'G', г: 'g',
  Д: 'D', д: 'd', Е: 'E', е: 'e', Ё: 'E', ё: 'e', Ж: 'Zh', ж: 'zh',
  З: 'Z', з: 'z', И: 'I', и: 'i', Й: 'Y', й: 'y', К: 'K', к: 'k',
  Л: 'L', л: 'l', М: 'M', м: 'm', Н: 'N', н: 'n', О: 'O', о: 'o',
  П: 'P', п: 'p', Р: 'R', р: 'r', С: 'S', с: 's', Т: 'T', т: 't',
  У: 'U', у: 'u', Ф: 'F', ф: 'f', Х: 'Kh', х: 'kh', Ц: 'Ts', ц: 'ts',
  Ч: 'Ch', ч: 'ch', Ш: 'Sh', ш: 'sh', Щ: 'Shch', щ: 'shch', Ы: 'Y', ы: 'y',
  Э: 'E', э: 'e', Ю: 'Yu', ю: 'yu', Я: 'Ya', я: 'ya', Ь: '', ь: '',
  Ъ: '', ъ: ''
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase()
}

function createProvisioningError(
  message: string,
  code: string,
  details: Record<string, unknown> = {}
): Error & { code?: string; field?: string; fieldLabel?: string; requiredFields?: RequiredClientDataField[] } {
  return Object.assign(new Error(message), { code, ...details })
}

function profileIdFromCreateResponse(value: any): number {
  const id = Number(value?.data?.id ?? value?.id ?? value?.Id)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Dolphin did not return a created profile id.')
  }
  return id
}

function requiredLocalesForMarket(market: unknown): Locale[] {
  const normalized = normalizeKey(market)
  if (normalized === 'ru') return ['ru']
  if (normalized === 'en' || normalized === 'both') return ['ru', 'en']
  throw createProvisioningError(
    `Unsupported client market for Dolphin profile creation: ${String(market || 'empty')}`,
    'dolphin_profile_provisioning_blocked',
    { field: 'market', fieldLabel: 'market' }
  )
}

type RequiredClientDataField = {
  field: string
  fieldLabel: string
  message: string
}

function maybeNameParts(client: WebClient): { firstName: string; secondName: string } {
  const firstName = normalizeText(client.firstName || client.clientName.split(/\s+/)[0])
  const fioTokens = normalizeText(client.fio).split(/\s+/).filter(Boolean)
  const lastName = normalizeText(client.lastName)
  const secondName = lastName || fioTokens.find(token => normalizeKey(token) !== normalizeKey(firstName)) || ''
  return { firstName, secondName }
}

function nameParts(client: WebClient): { firstName: string; secondName: string } {
  const { firstName, secondName } = maybeNameParts(client)
  if (!firstName || !secondName) {
    throw createProvisioningError(
      'Fill first name and second name before using Dolphin profiles.',
      'missing_dolphin_profile_personal_data',
      {
        field: firstName ? 'lastName' : 'firstName',
        fieldLabel: firstName ? 'last name' : 'first name'
      }
    )
  }
  return { firstName, secondName }
}

function getRequiredClientDataIssues(client: WebClient, options: { requireCalendarEmail?: boolean } = {}): RequiredClientDataField[] {
  const issues: RequiredClientDataField[] = []
  const { firstName, secondName } = maybeNameParts(client)
  if (!firstName) {
    issues.push({
      field: 'firstName',
      fieldLabel: 'first name',
      message: 'Fill first name before using Dolphin profiles.'
    })
  }
  if (!secondName) {
    issues.push({
      field: 'lastName',
      fieldLabel: 'last name',
      message: 'Fill last name before using Dolphin profiles.'
    })
  }
  if (!normalizeText(client.primaryStack)) {
    issues.push({
      field: 'primaryStack',
      fieldLabel: 'stack',
      message: 'Fill client stack before using Dolphin profiles.'
    })
  }
  if (!normalizeText(client.commonChatId)) {
    issues.push({
      field: 'commonChatId',
      fieldLabel: 'common chat id',
      message: 'Fill common chat id before using Dolphin profiles.'
    })
  }
  if (!normalizeText(client.market)) {
    issues.push({
      field: 'market',
      fieldLabel: 'market',
      message: 'Fill client market before using Dolphin profiles.'
    })
  } else {
    try {
      requiredLocalesForMarket(client.market)
    } catch (error: any) {
      issues.push({
        field: 'market',
        fieldLabel: 'market',
        message: error instanceof Error ? error.message : 'Fill a supported market before using Dolphin profiles.'
      })
    }
  }
  if (options.requireCalendarEmail && !normalizeText(client.calendarEmail)) {
    issues.push({
      field: 'calendarEmail',
      fieldLabel: 'calendar email',
      message: 'Fill calendar email before using Dolphin profiles.'
    })
  }
  return issues
}

function assertRequiredClientData(client: WebClient, options: { requireCalendarEmail?: boolean } = {}): void {
  const issues = getRequiredClientDataIssues(client, options)
  if (!issues.length) return
  throw createProvisioningError(issues[0].message, 'missing_dolphin_profile_personal_data', {
    field: issues[0].field,
    fieldLabel: issues[0].fieldLabel,
    requiredFields: issues
  })
}

function marketLabel(locale: Locale): 'Ru' | 'En' {
  return locale === 'ru' ? 'Ru' : 'En'
}

function buildProfileName(client: WebClient, locale: Locale): string {
  const { firstName, secondName } = nameParts(client)
  return `${firstName} ${secondName} ${normalizeText(client.primaryStack)} ${marketLabel(locale)}`
}

function transliterate(value: string): string {
  return value
    .split('')
    .map(char => CYRILLIC_TO_LATIN[char] ?? char)
    .join('')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function buildProxyName(client: WebClient, enProfileId: number): string {
  const { firstName, secondName } = nameParts(client)
  const latinFirst = transliterate(firstName)
  const latinSecond = transliterate(secondName)
  if (!latinFirst || !latinSecond) {
    throw createProvisioningError(
      'Client first and second names must be transliteratable for proxy naming.',
      'missing_dolphin_profile_personal_data',
      { field: 'lastName', fieldLabel: 'last name' }
    )
  }
  return `${latinFirst} | ${enProfileId} | ${latinSecond} | ${normalizeText(client.commonChatId)} | ${normalizeText(client.primaryStack)} En`
}

function buildProxyNameExample(client: WebClient): string {
  return buildProxyName(client, '{profileId}' as any)
}

function buildProxyRenamePatch(proxy: DolphinProxySnapshot, name: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { name }
  for (const field of ['type', 'host', 'port', 'login', 'password', 'changeIpUrl', 'provider']) {
    const value = (proxy as Record<string, unknown>)[field]
    if (value !== undefined && value !== null && value !== '') patch[field] = value
  }
  return patch
}

function proxyUseCount(proxy: DolphinProxySnapshot): number {
  const count = Number(proxy.browser_profiles_count ?? proxy.browserProfilesCount ?? 0)
  return Number.isFinite(count) ? count : 0
}

function proxyId(proxy: DolphinProxySnapshot): number {
  return Number(proxy.id)
}

function containsNamePair(proxy: DolphinProxySnapshot, client: WebClient): boolean {
  const { firstName, secondName } = nameParts(client)
  const haystack = normalizeKey(proxy.name)
  const candidates = [
    [firstName, secondName],
    [transliterate(firstName), transliterate(secondName)]
  ]
  return candidates.some(([first, second]) =>
    Boolean(first && second && haystack.includes(normalizeKey(first)) && haystack.includes(normalizeKey(second)))
  )
}

function readySortValue(proxy: DolphinProxySnapshot): number {
  const match = normalizeText(proxy.name).match(/^Ready\s+(\d+)/i)
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY
}

function selectProxyForClient(
  client: WebClient,
  proxies: DolphinProxySnapshot[]
): { proxy: DolphinProxySnapshot | null; skippedSuspiciousProxies: DolphinProxySnapshot[]; extraNamedProxies: DolphinProxySnapshot[] } {
  const named = proxies.filter(proxy => proxy.id && containsNamePair(proxy, client))
  const unusedNamed = named
    .filter(proxy => proxyUseCount(proxy) === 0)
    .sort((a, b) => proxyId(a) - proxyId(b))
  if (unusedNamed.length) {
    return {
      proxy: unusedNamed[0],
      skippedSuspiciousProxies: named.filter(proxy => proxyUseCount(proxy) > 0),
      extraNamedProxies: unusedNamed.slice(1)
    }
  }

  const ready = proxies
    .filter(proxy => proxy.id && /^Ready\s+/i.test(normalizeText(proxy.name)) && proxyUseCount(proxy) === 0)
    .sort((a, b) => readySortValue(a) - readySortValue(b) || proxyId(a) - proxyId(b))

  return {
    proxy: ready[0] ?? null,
    skippedSuspiciousProxies: named.filter(proxy => proxyUseCount(proxy) > 0),
    extraNamedProxies: []
  }
}

function cloneTemplatePayload(template: Record<string, any>, name: string, tags: string[], proxy?: DolphinProxySnapshot | null): Record<string, any> {
  const payload: Record<string, any> = { name, tags }
  for (const field of CREATE_PROFILE_FIELDS) {
    if (template[field] !== undefined) payload[field] = template[field]
  }
  for (const field of ['tabs', 'webgpu']) {
    if (!Array.isArray(payload[field]) || payload[field].length === 0) {
      delete payload[field]
    }
  }
  delete payload.login
  delete payload.password
  if (proxy) {
    payload.proxy = { id: proxyId(proxy) }
  } else {
    delete payload.proxy
  }
  return payload
}

function createDefaultDolphinProvisioningApi(): DolphinProvisioningApi {
  async function listPaginated<T>(path: string): Promise<T[]> {
    const limit = 100
    const rows: T[] = []
    let page = 1
    let total = Number.POSITIVE_INFINITY
    while (rows.length < total) {
      const response = await requestDolphinCloudApi<{ data?: T[]; total?: number; last_page?: number }>(path, {
        query: { limit, page }
      })
      const data = response.data ?? []
      rows.push(...data)
      total = response.total ?? rows.length
      if (!data.length || page >= (response.last_page ?? page)) break
      page += 1
    }
    return rows
  }

  return {
    async getProfile(profileId: number): Promise<Record<string, any>> {
      const response = await requestDolphinCloudApi<{ data?: Record<string, any> }>(`/browser_profiles/${profileId}`)
      if (!response.data) throw new Error(`Dolphin template profile ${profileId} was not returned by API.`)
      return response.data
    },
    async createProfile(payload: Record<string, any>): Promise<Record<string, any>> {
      return await requestDolphinCloudApi('/browser_profiles', { method: 'POST', body: payload })
    },
    async listProfiles(): Promise<Record<string, any>[]> {
      return await listPaginated<Record<string, any>>('/browser_profiles')
    },
    async listProxies(): Promise<DolphinProxySnapshot[]> {
      return await listPaginated<DolphinProxySnapshot>('/proxy')
    },
    async updateProxy(proxyId: number, patch: Record<string, any>): Promise<unknown> {
      return await requestDolphinCloudApi(`/proxy/${proxyId}`, { method: 'PATCH', body: patch })
    },
    async updateProfileTags(profileId: number, tags: string[]): Promise<unknown> {
      return await requestDolphinCloudApi(`/browser_profiles/${profileId}`, { method: 'PATCH', body: { tags } })
    }
  }
}

function createDolphinProfileProvisioner(options: {
  repository: WebConsoleRepository
  api?: DolphinProvisioningApi
  templateProfileId?: number
}): DolphinProvisioner {
  const repository = options.repository
  const api = options.api ?? createDefaultDolphinProvisioningApi()

  return {
    async ensureClientProfiles(input: {
      client: WebClient
      existingProfiles: DolphinProfileRecord[]
      actorRole: 'client' | 'admin'
      ownProxy?: boolean
    }): Promise<DolphinProvisionResult> {
      const requiredLocales = requiredLocalesForMarket(input.client.market)
      const existingLocales = new Set(input.existingProfiles.map(profile => normalizeKey(profile.locale)))
      const missingLocales = requiredLocales.filter(locale => !existingLocales.has(locale))
      if (!missingLocales.length) {
        return { created: [], skippedSuspiciousProxies: [], extraNamedProxies: [] }
      }
      assertRequiredClientData(input.client, { requireCalendarEmail: input.actorRole === 'client' })
      const templateProfileId = Number(options.templateProfileId ?? process.env.DOLPHIN_TEMPLATE_PROFILE_ID)
      if (!Number.isFinite(templateProfileId) || templateProfileId <= 0) {
        const error = new Error('Missing required environment variable: DOLPHIN_TEMPLATE_PROFILE_ID') as Error & { code?: string }
        error.code = 'dolphin_profile_provisioning_blocked'
        throw error
      }

      const template = await api.getProfile(templateProfileId)
      const proxies = missingLocales.includes('en') && !input.ownProxy ? await api.listProxies() : []
      const dolphinProfiles = typeof api.listProfiles === 'function'
        ? await api.listProfiles()
        : []
      const canonicalTags = ['binded', `to ${input.client.clientName}`, `noco:${input.client.id}`]
      const created: DolphinProvisionResult['created'] = []
      let skippedSuspiciousProxies: DolphinProxySnapshot[] = []
      let extraNamedProxies: DolphinProxySnapshot[] = []

      for (const locale of missingLocales) {
        const profileName = buildProfileName(input.client, locale)
        const existingDolphinProfile = dolphinProfiles.find(profile => normalizeText(profile.name) === profileName)
        if (existingDolphinProfile?.id) {
          const existingProfileId = Number(existingDolphinProfile.id)
          let standardProxyName = ''
          if (locale === 'en') {
            const attachedProxyId = Number(existingDolphinProfile.proxyId ?? existingDolphinProfile.proxy?.id)
            const attachedProxy = proxies.find(proxy => proxyId(proxy) === attachedProxyId)
            if (attachedProxy) {
              standardProxyName = buildProxyName(input.client, existingProfileId)
              await api.updateProxy(proxyId(attachedProxy), buildProxyRenamePatch(attachedProxy, standardProxyName))
            }
          }
          await api.updateProfileTags(existingProfileId, canonicalTags)
          await repository.createDolphinProfileBinding({
            clientId: input.client.id,
            clientName: input.client.clientName,
            locale,
            dolphinProfileId: existingProfileId
          })
          created.push({
            locale,
            profileId: existingProfileId,
            profileName,
            proxyId: locale === 'en' ? Number(existingDolphinProfile.proxyId ?? existingDolphinProfile.proxy?.id) || undefined : undefined,
            proxyName: standardProxyName || undefined
          })
          continue
        }

        let selectedProxy: DolphinProxySnapshot | null = null
        if (locale === 'en' && !input.ownProxy) {
          const selection = selectProxyForClient(input.client, proxies)
          selectedProxy = selection.proxy
          skippedSuspiciousProxies = selection.skippedSuspiciousProxies
          extraNamedProxies = selection.extraNamedProxies
          if (!selectedProxy) {
            const error = new Error('No Ready proxy is available. Please write to @KiraSamsonova.') as Error & { code?: string }
            error.code = 'dolphin_profile_proxy_unavailable'
            throw error
          }
        }

        const createdProfile = await api.createProfile(cloneTemplatePayload(template, profileName, canonicalTags, selectedProxy))
        const createdProfileId = profileIdFromCreateResponse(createdProfile)
        let standardProxyName = ''
        if (locale === 'en' && selectedProxy) {
          standardProxyName = buildProxyName(input.client, createdProfileId)
          await api.updateProxy(proxyId(selectedProxy), buildProxyRenamePatch(selectedProxy, standardProxyName))
        }
        await api.updateProfileTags(createdProfileId, canonicalTags)
        await repository.createDolphinProfileBinding({
          clientId: input.client.id,
          clientName: input.client.clientName,
          locale,
          dolphinProfileId: createdProfileId
        })
        created.push({
          locale,
          profileId: createdProfileId,
          profileName,
          proxyId: selectedProxy ? proxyId(selectedProxy) : undefined,
          proxyName: standardProxyName || undefined
        })
      }

      return { created, skippedSuspiciousProxies, extraNamedProxies }
    }
  }
}

async function prepareJudosharkClientIfNeeded(
  repository: WebConsoleRepository,
  client: WebClient
): Promise<WebClient> {
  if (normalizeKey(client.calendarEmail) !== 'judoshark@gmail.com') return client
  const patch: Record<string, string> = {}
  if (!normalizeText(client.firstName)) patch.firstName = 'Test'
  if (!normalizeText(client.lastName)) patch.lastName = 'User'
  if (!normalizeText(client.fio)) patch.fio = 'Test User'
  if (!Object.keys(patch).length) return client
  await repository.updateClientProfile(client.id, patch)
  return await repository.getClientById(client.id)
}

module.exports = {
  buildProfileName,
  buildProxyNameExample,
  buildProxyRenamePatch,
  buildProxyName,
  cloneTemplatePayload,
  createDefaultDolphinProvisioningApi,
  createDolphinProfileProvisioner,
  getRequiredClientDataIssues,
  prepareJudosharkClientIfNeeded,
  requiredLocalesForMarket,
  selectProxyForClient,
  transliterate
}
