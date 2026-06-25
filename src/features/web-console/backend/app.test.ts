const assert = require('node:assert/strict')
const {
  buildProfileAccessInput,
  createWebConsoleApp,
  resolveClientDolphinCredentials
} = require('./app.ts') as {
  buildProfileAccessInput(repository: any, clientId: number): Promise<{ profileIds: number[]; knownProfileIds: number[] }>
  createWebConsoleApp(options?: any): import('express').Express
  resolveClientDolphinCredentials(client: { id: number; calendarEmail: string }): {
    username: string
    password: string
    sourceEmail: string
  }
}
const { createWebConsoleRepository } = require('./repository.ts') as {
  createWebConsoleRepository(options?: any): any
}
const {
  buildAccountPatch,
  buildChangedClientPatch,
  buildLinkedInEmailByClientId,
  buildClientPatch,
  isLinkedInPlatformAccount,
  LINKEDIN_PLATFORM_ID,
  profileClientId,
  profileId
} = require('./repository.ts') as {
  buildAccountPatch(input: any, options: { includeBlankSecrets: boolean }): Record<string, unknown>
  buildChangedClientPatch(current: any, input: any): Record<string, unknown>
  buildLinkedInEmailByClientId(accounts: Array<Record<string, unknown> & { Id: number }>): Map<number, string>
  buildClientPatch(input: any): Record<string, unknown>
  isLinkedInPlatformAccount(account: Record<string, unknown> & { Id: number }): boolean
  LINKEDIN_PLATFORM_ID: number
  profileClientId(profile: Record<string, unknown> & { Id: number }): number | null
  profileId(profile: Record<string, unknown> & { Id: number }): number | null
}
const { linkedStatusMatches } = require('./repository.ts') as {
  linkedStatusMatches(value: unknown, expectedLabel: string, options?: Array<Record<string, unknown>>): boolean
}
const { DEFAULT_DOLPHIN_SHARED_USER_EMAIL } = require('./dolphin-lease.ts') as {
  DEFAULT_DOLPHIN_SHARED_USER_EMAIL: string
}
const {
  buildProfileName,
  buildProxyName,
  cloneTemplatePayload,
  prepareJudosharkClientIfNeeded,
  requiredLocalesForMarket,
  selectProxyForClient
} = require('./dolphin-profile-provisioning.ts') as {
  buildProfileName(client: any, locale: 'ru' | 'en'): string
  buildProxyName(client: any, enProfileId: number): string
  cloneTemplatePayload(template: any, name: string, tags: string[], proxy?: any): any
  prepareJudosharkClientIfNeeded(repository: any, client: any): Promise<any>
  requiredLocalesForMarket(market: unknown): Array<'ru' | 'en'>
  selectProxyForClient(client: any, proxies: any[]): any
}

function createFixtureNocoClient() {
  const calls: string[] = []
  const clients: Array<Record<string, any> & { Id: number }> = [
    {
      Id: 1,
      client_name: 'Client One',
      first_name: 'Client',
      last_name: 'One',
      fio: 'Client One Legal',
      birth_date: '2000-01-01',
      education: 'Old school',
      calendar_email: 'client@example.com',
      telegram_personal_chat_id: '@client_one',
      telegram_general_chat_id: '1001',
      rel_clients_primary_stack: { Id: 9, name: 'FRONTEND' },
      market: 'Ru',
      english_levels_id: 3,
      'English level': { Id: 3, level: 'B1' },
      client_status: { Id: 1, title: 'studying' }
    },
    {
      Id: 10,
      client_name: 'Newest Client',
      first_name: 'Newest',
      last_name: 'Client',
      fio: 'Newest Client',
      calendar_email: 'newest@example.com',
      telegram_general_chat_id: '1003',
      rel_clients_primary_stack: { Id: 10, name: 'PYTHON' },
      market: 'En',
      client_status: 'on en market'
    },
    {
      Id: 3,
      client_name: 'Provider Match',
      first_name: 'Provider',
      last_name: 'Match',
      fio: 'Provider Match',
      calendar_email: 'provider-match@example.com',
      telegram_general_chat_id: '1004',
      rel_clients_primary_stack: { Id: 11, name: 'DATA' },
      market: 'En',
      client_status: { id: 'status-en', name: 'on en market' }
    },
    {
      Id: 4,
      client_name: 'Unknown Raw String Should Not Match',
      calendar_email: 'raw-status@example.com',
      telegram_general_chat_id: '1005',
      rel_clients_primary_stack: { Id: 12, name: 'GO' },
      market: 'En',
      client_status: 'raw status with same words maybe'
    },
    {
      Id: 5,
      client_name: 'No Profile Client',
      calendar_email: 'no-profile@example.com',
      telegram_general_chat_id: '1006',
      rel_clients_primary_stack: { Id: 13, name: 'QA' },
      market: 'Ru',
      client_status: { Id: 1, title: 'studying' }
    },
    {
      Id: 7,
      client_name: 'Auto Provision Client',
      first_name: 'Auto',
      last_name: 'Person',
      fio: 'Auto Person',
      calendar_email: 'auto-provision@example.com',
      telegram_general_chat_id: '1008',
      rel_clients_primary_stack: { Id: 15, name: 'REACT' },
      market: 'both',
      client_status: { Id: 1, title: 'studying' }
    },
    {
      Id: 8,
      client_name: 'Provider Missing Profile',
      first_name: 'Provider',
      last_name: 'Missing',
      fio: 'Provider Missing',
      calendar_email: 'provider-missing@example.com',
      telegram_general_chat_id: '1009',
      rel_clients_primary_stack: { Id: 16, name: 'REACT' },
      market: 'En',
      client_status: { id: 'status-en', name: 'on en market' }
    },
    {
      Id: 9,
      client_name: 'Judoshark Test',
      first_name: '',
      last_name: '',
      fio: '',
      calendar_email: 'judoshark@gmail.com',
      telegram_general_chat_id: '1010',
      rel_clients_primary_stack: { Id: 17, name: 'PYTHON' },
      market: 'Ru',
      client_status: { Id: 1, title: 'studying' }
    },
    {
      Id: 6,
      client_name: 'Numeric Email Client',
      first_name: 'Numeric',
      last_name: 'Client',
      fio: 'Numeric Client',
      calendar_email: '6186914@gmail.com',
      telegram_general_chat_id: '1007',
      rel_clients_primary_stack: { Id: 14, name: 'FRONTEND' },
      market: 'Ru',
      client_status: { Id: 1, title: 'studying' }
    }
  ]
  const platformAccounts: Array<Record<string, any> & { Id: number }> = [
    {
      Id: 10,
      platform: 'hh_ru',
      account_label: 'Client One HH',
      login: '7999',
      password: 'secret',
      rel_platformAccounts_client: { Id: 1 }
    },
    {
      Id: 12,
      account_label: 'Client One LinkedIn',
      login: 'client-one.linkedin@example.com',
      rel_platformAccounts_client: { Id: 1 },
      rel_platformAccounts_platform: { Id: 16, name: 'linkedin', label: 'linkedin' }
    },
    {
      Id: 11,
      platform: 'email_en',
      account_label: 'Newest Email',
      login: 'newest@example.com',
      password: 'mail-secret',
      clients_id: 10
    },
    {
      Id: 14,
      account_label: 'Newest LinkedIn newer',
      login: 'newest.linkedin.two@example.com',
      clients_id: 10,
      platforms_id: 16
    },
    {
      Id: 13,
      account_label: 'Newest LinkedIn older',
      login: 'newest.linkedin.one@example.com',
      clients_id: 10,
      platforms_id: 16
    },
    {
      Id: 15,
      account_label: 'Provider Match LinkedIn',
      login: 'provider-match.linkedin@example.com',
      clients_id: 3,
      rel_platformAccounts_platform: { Id: 16 }
    },
    {
      Id: 16,
      account_label: 'Wrong id LinkedIn name',
      login: 'wrong-id-should-not-match@example.com',
      clients_id: 3,
      rel_platformAccounts_platform: { Id: 99, name: 'linkedin', label: 'linkedin' }
    }
  ]
  const platforms: Array<Record<string, any> & { Id: number }> = [
    { Id: 1, label: 'hh_ru', name: 'hh' },
    { Id: 2, label: 'telegram_ru', name: 'telegram' },
    { Id: 16, label: 'linkedin', name: 'linkedin' }
  ]
  const englishLevels: Array<Record<string, any> & { Id: number }> = [
    { Id: 3, level: 'B1', rank: 3 },
    { Id: 4, level: 'B2', rank: 4 },
    { Id: 5, level: 'C1', rank: 5 }
  ]
  const dolphinProfiles: Array<Record<string, any> & { Id: number }> = [
    {
      Id: 20,
      locale: 'en',
      dolphin_profile_id: '111111112',
      clients_id: 1
    },
    {
      Id: 10,
      locale: 'ru',
      dolphin_profile_id: '111111111',
      rel_dolphinProfiles_client: { Id: 1 }
    },
    {
      Id: 30,
      locale: 'en',
      dolphin_profile_id: '333333333',
      rel_dolphinProfiles_client: { Id: 3 }
    },
    {
      Id: 35,
      locale: 'ru',
      dolphin_profile_id: '333333332',
      rel_dolphinProfiles_client: { Id: 3 }
    },
    {
      Id: 40,
      locale: 'ru',
      dolphin_profile_id: '101010101',
      clients_id: 10
    },
    {
      Id: 50,
      locale: 'ru',
      dolphin_profile_id: '444444444',
      clients_id: 4
    },
    {
      Id: 60,
      locale: 'ru',
      dolphin_profile_id: '618691401',
      clients_id: 6
    },
    {
      Id: 70,
      locale: 'en',
      dolphin_profile_id: '618691402',
      clients_id: 6
    }
  ]

  return {
    calls,
    async fetchTableMeta(tableId: string) {
      calls.push(`meta:${tableId}`)
      if (tableId !== 'mxza381054ldlza') return { columns: [] }
      return {
        columns: [
          {
            title: 'client_status',
            uidt: 'SingleSelect',
            colOptions: {
              options: [
                { id: 'status-study', title: 'studying' },
                { id: 'status-en', title: 'on en market' },
                { id: 'status-raw', title: 'raw status with same words maybe' }
              ]
            }
          }
        ]
      }
    },
    async fetchRecords(tableId: string) {
      calls.push(tableId)
      if (tableId === 'mxza381054ldlza') return clients
      if (tableId === 'm8zej2vsv4iypl8') return platformAccounts
      if (tableId === 'mg3ovkendur1kpo') return platforms
      if (tableId === 'mpteejwqy2kvmvm') return englishLevels
      if (tableId === 'm4thvbutfyb15qz') return dolphinProfiles
      return []
    },
    async createRecord(tableId: string, record: Record<string, any>) {
      calls.push(`create:${tableId}`)
      assert(['m8zej2vsv4iypl8', 'm4thvbutfyb15qz'].includes(tableId))
      if (tableId === 'm4thvbutfyb15qz') {
        const created: Record<string, any> & { Id: number } = {
          Id: Math.max(...dolphinProfiles.map(profile => Number(profile.Id))) + 1,
          ...record
        }
        if (created.clients_id) {
          const client = clients.find(candidate => Number(candidate.Id) === Number(created.clients_id))
          if (client) created.rel_dolphinProfiles_client = { Id: client.Id, client_name: client.client_name }
        }
        dolphinProfiles.push(created)
        return created
      }
      const created: Record<string, any> & { Id: number } = {
        Id: Math.max(...platformAccounts.map(account => Number(account.Id))) + 1,
        ...record
      }
      if (created.platforms_id) {
        const platform = platforms.find(candidate => Number(candidate.Id) === Number(created.platforms_id))
        if (platform) {
          created.platform = created.platform || platform.label
          created.rel_platformAccounts_platform = { Id: platform.Id, name: platform.name, label: platform.label }
        }
      }
      platformAccounts.push(created)
      return created
    },
    async patchRecord(tableId: string, recordId: number, patch: Record<string, any>) {
      calls.push(`patch:${tableId}:${recordId}`)
      const records = tableId === 'mxza381054ldlza' ? clients : tableId === 'm8zej2vsv4iypl8' ? platformAccounts : []
      const record = records.find(candidate => Number(candidate.Id) === Number(recordId))
      if (!record) throw new Error(`Record ${recordId} not found`)
      Object.assign(record, patch)
      if (tableId === 'mxza381054ldlza') {
        const englishLevel = englishLevels.find(level => Number(level.Id) === Number(record.english_levels_id))
        record['English level'] = englishLevel ? { Id: englishLevel.Id, level: englishLevel.level } : null
      }
      if (tableId === 'm8zej2vsv4iypl8' && record.platforms_id) {
        const platform = platforms.find(candidate => Number(candidate.Id) === Number(record.platforms_id))
        if (platform) record.rel_platformAccounts_platform = { Id: platform.Id, name: platform.name, label: platform.label }
      }
      return record
    },
    async deleteRecord(tableId: string, recordId: number) {
      calls.push(`delete:${tableId}:${recordId}`)
      assert.equal(tableId, 'm8zej2vsv4iypl8')
      const index = platformAccounts.findIndex(account => Number(account.Id) === Number(recordId))
      if (index !== -1) platformAccounts.splice(index, 1)
      return { ok: true }
    }
  }
}

async function listen(app: import('express').Express) {
  return await new Promise<{ baseUrl: string; close(): Promise<void> }>(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as import('node:net').AddressInfo
      assert(address)
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
      })
    })
  })
}

async function request(baseUrl: string, path: string, options: any = {}, cookie = '') {
  const headers = {
    ...(options.headers ?? {}),
    ...(cookie ? { Cookie: cookie } : {})
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  const setCookie = response.headers.get('set-cookie') ?? ''
  const body = await response.json().catch(() => ({}))
  return { response, body, cookie: setCookie.split(';')[0] }
}

async function runTests(): Promise<void> {
  const normalizedCredential = resolveClientDolphinCredentials({ id: 28, calendarEmail: 'NPotokin@gmail.com' })
  assert.deepEqual(normalizedCredential, {
    username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    password: normalizedCredential.password,
    sourceEmail: 'npotokin@gmail.com'
  })
  const firstGeneratedPassword = normalizedCredential.password
  const secondGeneratedPassword = resolveClientDolphinCredentials({ id: 28, calendarEmail: 'NPotokin@gmail.com' }).password
  assert.match(firstGeneratedPassword, /^[A-Za-z0-9_-]{12}$/)
  assert.notEqual(firstGeneratedPassword, 'npotokin@gmail.com')
  assert.notEqual(firstGeneratedPassword, secondGeneratedPassword)

  const statusOptions = [
    { id: 'status-study', title: 'studying' },
    { id: 'status-en', title: 'on en market' }
  ]
  assert.equal(linkedStatusMatches({ id: 'status-en', title: 'on en market' }, 'on en market', statusOptions), true)
  assert.equal(linkedStatusMatches([{ Id: 'status-en', label: 'on en market' }], 'on en market', statusOptions), true)
  assert.equal(linkedStatusMatches({ title: 'on en market' }, 'on en market', statusOptions), false)
  assert.equal(linkedStatusMatches({ Id: 'status-other', title: 'on en market' }, 'on en market', statusOptions), false)
  assert.equal(linkedStatusMatches('on en market', 'on en market', statusOptions), true)
  assert.equal(linkedStatusMatches('on en market', 'on en market'), false)
  assert.equal(LINKEDIN_PLATFORM_ID, 16)
  assert.equal(isLinkedInPlatformAccount({ Id: 1, platforms_id: 16 }), true)
  assert.equal(isLinkedInPlatformAccount({ Id: 1, rel_platformAccounts_platform: { Id: 16 } }), true)
  assert.equal(isLinkedInPlatformAccount({ Id: 1, rel_platformAccounts_platform: { Id: 99, name: 'linkedin' } }), false)
  assert.equal(profileClientId({ Id: 1, clients_id: 30 }), 30)
  assert.equal(profileClientId({ Id: 1, rel_dolphinProfiles_client: { Id: 31 }, clients_id: 30 }), 31)
  assert.equal(profileId({ Id: 1, dolphin_profile_id: '762000802.0' }), 762000802)
  assert.deepEqual(buildClientPatch({
    firstName: 'New',
    lastName: 'Name',
    fio: 'New Name',
    birthDate: '2001-02-03',
    education: 'University',
    englishLevelId: 4,
    telegramPersonalChatId: '@new',
    calendarEmail: 'new@example.com',
    client_status: 'forbidden'
  }), {
    first_name: 'New',
    last_name: 'Name',
    fio: 'New Name',
    birth_date: '2001-02-03',
    education: 'University',
    english_levels_id: 4,
    telegram_personal_chat_id: '@new',
    calendar_email: 'new@example.com'
  })
  assert.deepEqual(buildAccountPatch({
    platformId: 16,
    platform: 'linkedin',
    accountLabel: 'LinkedIn',
    login: 'new-login',
    password: '',
    emailPassword: 'new-mail-secret',
    ignored: 'nope'
  }, { includeBlankSecrets: false }), {
    platform: 'linkedin',
    account_label: 'LinkedIn',
    login: 'new-login',
    platforms_id: 16,
    email_password: 'new-mail-secret'
  })
  assert.deepEqual(buildChangedClientPatch({
    firstName: 'Client',
    lastName: 'One',
    fio: 'Client One Legal',
    birthDate: '2000-01-01',
    education: 'Old school',
    englishLevelId: 3,
    telegramPersonalChatId: '@client_one',
    calendarEmail: 'client@example.com'
  }, {
    firstName: 'Client',
    lastName: 'One',
    fio: 'Client One Legal',
    birthDate: '2000-01-01',
    education: 'New school',
    englishLevelId: 3,
    telegramPersonalChatId: '@client_one',
    calendarEmail: 'client@example.com'
  }), {
    education: 'New school'
  })
  const linkedInMap = buildLinkedInEmailByClientId([
    { Id: 30, clients_id: 8, platforms_id: 16, login: 'second@example.com' },
    { Id: 20, clients_id: 8, platforms_id: 16, login: 'first@example.com' },
    { Id: 10, clients_id: 8, rel_platformAccounts_platform: { Id: 99, name: 'linkedin' }, login: 'wrong@example.com' },
    { Id: 40, clients_id: 9, platforms_id: 16, login: '' }
  ])
  assert.equal(linkedInMap.get(8), 'first@example.com, second@example.com')
  assert.equal(linkedInMap.has(9), false)
  assert.deepEqual(requiredLocalesForMarket('ru'), ['ru'])
  assert.deepEqual(requiredLocalesForMarket('en'), ['ru', 'en'])
  assert.deepEqual(requiredLocalesForMarket('both'), ['ru', 'en'])
  const namingClient = {
    id: 84,
    clientName: 'Кирилл Шумаев',
    firstName: 'Kirill',
    lastName: 'Shumaev',
    fio: 'Kirill Shumaev',
    primaryStack: 'React',
    commonChatId: '-1003597241162',
    market: 'en'
  }
  assert.equal(buildProfileName(namingClient, 'en'), 'Kirill Shumaev React En')
  assert.equal(buildProfileName(namingClient, 'ru'), 'Kirill Shumaev React Ru')
  assert.equal(buildProxyName(namingClient, 795168658), 'Kirill | 795168658 | Shumaev | -1003597241162 | React En')
  const proxySelection = selectProxyForClient(namingClient, [
    { id: 5, name: 'Ready 1', browser_profiles_count: 0 },
    { id: 4, name: 'Kirill | 1 | Shumaev | old | React En', browser_profiles_count: 1 },
    { id: 3, name: 'Kirill Shumaev spare', browser_profiles_count: 0 },
    { id: 2, name: 'Kirill Shumaev spare older', browser_profiles_count: 0 }
  ])
  assert.equal(proxySelection.proxy.id, 2)
  assert.deepEqual(proxySelection.extraNamedProxies.map((proxy: any) => proxy.id), [3])
  assert.deepEqual(proxySelection.skippedSuspiciousProxies.map((proxy: any) => proxy.id), [4])
  assert.equal(selectProxyForClient(namingClient, [
    { id: 9, name: 'Ready 10', browser_profiles_count: 0 },
    { id: 8, name: 'Ready 2', browser_profiles_count: 0 }
  ]).proxy.id, 8)
  assert.deepEqual(cloneTemplatePayload({
    id: 1,
    name: 'Test of DNS',
    platform: 'windows',
    browserType: 'anty',
    platformVersion: '11',
    proxy: { id: 999 },
    login: 'proxy-user',
    password: 'proxy-pass',
    fingerprint: { screen: 'x' }
  }, 'New Profile', ['binded'], null), {
    name: 'New Profile',
    tags: ['binded'],
    platform: 'windows',
    browserType: 'anty',
    platformVersion: '11',
    fingerprint: { screen: 'x' }
  })

  const noco = createFixtureNocoClient()
  const repository = createWebConsoleRepository({ nocoClient: noco })
  const preparedJudoshark = await prepareJudosharkClientIfNeeded(repository, await repository.getClientById(9))
  assert.equal(preparedJudoshark.firstName, 'Test')
  assert.equal(preparedJudoshark.lastName, 'User')
  assert.equal(preparedJudoshark.fio, 'Test User')
  assert.deepEqual(await buildProfileAccessInput(repository, 1), {
    profileIds: [111111111, 111111112],
    knownProfileIds: [111111111, 333333332, 101010101, 444444444, 618691401, 111111112, 333333333, 618691402]
  })
  await assert.rejects(
    () => buildProfileAccessInput(repository, 5),
    (error: any) => {
      assert.equal(error.code, 'missing_dolphin_profiles')
      assert.match(error.message, /No Dolphin profiles are linked to client 5/)
      return true
    }
  )
  const leaseCalls: any[] = []
  let leaseConflict = false
  let rejectDolphinEmail = false
  let stableDolphinEmailUnavailable = false
  let verificationCodeMode: 'ok' | 'not_found' | 'setup_error' = 'ok'
  let nextCreatedDolphinProfileId = 900100001
  const createdDolphinProfiles: any[] = []
  const updatedProxies: any[] = []
  const fakeDolphinProvisioningApi = {
    async getProfile(profileId: number) {
      assert.equal(profileId, 123456789)
      return {
        name: 'Test of DNS',
        platform: 'windows',
        browserType: 'anty',
        platformVersion: '11',
        proxy: { id: 1 },
        login: 'do-not-copy',
        password: 'do-not-copy',
        fingerprint: { stable: true }
      }
    },
    async listProxies() {
      return [
        { id: 602, name: 'Auto Person old proxy', browser_profiles_count: 1 },
        { id: 601, name: 'Auto Person prepared proxy', browser_profiles_count: 0 },
        { id: 603, name: 'Ready 1', browser_profiles_count: 0 }
      ]
    },
    async createProfile(payload: any) {
      createdDolphinProfiles.push(payload)
      return { data: { id: nextCreatedDolphinProfileId++ } }
    },
    async updateProxy(proxyId: number, patch: any) {
      updatedProxies.push({ proxyId, patch })
      return { ok: true }
    },
    async updateProfileTags(profileId: number, tags: string[]) {
      createdDolphinProfiles.push({ tagUpdateFor: profileId, tags })
      return { ok: true }
    }
  }
  const app = createWebConsoleApp({
    repository,
    dolphinProvisioningApi: fakeDolphinProvisioningApi,
    dolphinTemplateProfileId: 123456789,
    dolphinLeaseService: {
      async acquire(request: any) {
        leaseCalls.push(request)
        if (leaseConflict) {
          const error = new Error('account in use sorry') as Error & { code?: string; activeUntil?: number; ownerLabel?: string }
          error.code = 'account_in_use'
          error.activeUntil = 123456
          error.ownerLabel = 'Other User'
          throw error
        }
        if (rejectDolphinEmail) {
          const error = new Error(JSON.stringify({
            text: 'You have problem in field email',
            type: 'E_TEAM',
            code: 'E_TEAM_USERNAME'
          })) as Error & { details?: any }
          error.details = {
            text: 'You have problem in field email',
            type: 'E_TEAM',
            code: 'E_TEAM_USERNAME'
          }
          throw error
        }
        if (stableDolphinEmailUnavailable) {
          const error = new Error(`Stable Dolphin login ${request.username} is not available in Dolphin.`) as Error & {
            code?: string
            stableUsername?: string
            targetUserId?: number
            dolphinError?: any
          }
          error.code = 'stable_dolphin_email_unavailable'
          error.stableUsername = request.username
          error.targetUserId = 5166733
          error.dolphinError = {
            text: 'You have problem in field email',
            type: 'E_TEAM',
            code: 'E_TEAM_USERNAME'
          }
          throw error
        }
        return {
          ok: true,
          username: request.username,
          password: request.password,
          sourceEmail: request.sourceEmail,
          profileIds: request.profileIds,
          profilesGranted: request.profileIds,
          profilesRevoked: request.knownProfileIds,
          expiresAt: 123456,
          leaseMs: 120000,
          ownerLabel: request.ownerLabel,
          targetClientName: request.targetClientName
        }
      }
    },
    verificationCodeService: {
      async getLatestCode() {
        if (verificationCodeMode === 'not_found') {
          const error = new Error('No fresh Dolphin verification code was found.') as Error & { code?: string }
          error.code = 'code_not_found'
          throw error
        }
        if (verificationCodeMode === 'setup_error') {
          const error = new Error('Dolphin verification Gmail credentials are not configured.') as Error & { code?: string }
          error.code = 'mailbox_setup_error'
          throw error
        }
        return {
          ok: true,
          code: '123456',
          receivedAt: '2026-06-17T09:39:00.000Z',
          ageMs: 30_000
        }
      }
    }
  })
  const server = await listen(app)

  try {
    let result = await request(server.baseUrl, '/api/auth/me')
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/client/me')
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/client/profile-options')
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/client/platform-accounts', { method: 'POST' })
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/admin/latest-client')
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/provider/clients')
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/dolphin/verification-code/latest')
    assert.equal(result.response.status, 401)

    result = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'client@example.com', password: 'bad' })
    })
    assert.equal(result.response.status, 401)

    const clientLogin = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'client@example.com', password: '1234' })
    })
    assert.equal(clientLogin.response.status, 200)
    assert.equal(clientLogin.body.role, 'client')
    assert.equal(clientLogin.body.clientId, 1)

    result = await request(server.baseUrl, '/api/client/me', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.client.clientName, 'Client One')
    assert.equal(result.body.client.firstName, 'Client')
    assert.equal(result.body.client.education, 'Old school')
    assert.equal(result.body.client.englishLevel, 'B1')
    assert.equal(result.body.linkedInEmail, 'client-one.linkedin@example.com')
    assert.equal(result.body.platformAccounts[0].password, '***')

    result = await request(server.baseUrl, '/api/client/profile-options', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.deepEqual(result.body.englishLevels.map((level: any) => level.label), ['B1', 'B2', 'C1'])
    assert(result.body.platforms.some((platform: any) => platform.label === 'linkedin'))

    result = await request(server.baseUrl, '/api/client/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Updated',
        lastName: 'Client',
        fio: 'Updated Client Legal',
        birthDate: '2001-02-03',
        education: 'Updated university',
        englishLevelId: 4,
        telegramPersonalChatId: '@updated_client',
        calendarEmail: 'updated-client@example.com',
        clientStatus: 'should not write'
      })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.client.firstName, 'Updated')
    assert.equal(result.body.client.lastName, 'Client')
    assert.equal(result.body.client.fio, 'Updated Client Legal')
    assert.equal(result.body.client.birthDate, '2001-02-03')
    assert.equal(result.body.client.education, 'Updated university')
    assert.equal(result.body.client.englishLevelId, 4)
    assert.equal(result.body.client.englishLevel, 'B2')
    assert.equal(result.body.client.telegramPersonalChatId, '@updated_client')
    assert.equal(result.body.client.calendarEmail, 'updated-client@example.com')
    assert.equal(result.body.client.clientStatus, 'studying')

    result = await request(server.baseUrl, '/api/client/platform-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platformId: 16,
        platform: 'linkedin',
        accountLabel: 'Updated LinkedIn',
        login: 'updated.linkedin@example.com',
        phone: '+1000',
        email: 'updated.linkedin@example.com',
        nickname: 'updated-li',
        linkedInUrl: 'https://linkedin.com/in/updated',
        foreignNumber: '+15550001111',
        recoveryCodes: 'code-1',
        password: 'new-secret',
        emailPassword: 'new-email-secret'
      })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 201, JSON.stringify(result.body))
    const createdAccount = result.body.platformAccounts.find((account: any) => account.accountLabel === 'Updated LinkedIn')
    assert(createdAccount)
    assert.equal(createdAccount.platform, 'linkedin')
    assert.equal(createdAccount.password, '***')
    assert.equal(createdAccount.emailPassword, '***')

    result = await request(server.baseUrl, `/api/client/platform-accounts/${createdAccount.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountLabel: 'Updated LinkedIn Edited',
        login: 'edited.linkedin@example.com',
        phone: '+2000',
        password: '',
        emailPassword: 'replacement-email-secret'
      })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    const editedAccount = result.body.platformAccounts.find((account: any) => account.id === createdAccount.id)
    assert.equal(editedAccount.accountLabel, 'Updated LinkedIn Edited')
    assert.equal(editedAccount.login, 'edited.linkedin@example.com')
    assert.equal(editedAccount.password, '***')
    assert.equal(editedAccount.emailPassword, '***')

    result = await request(server.baseUrl, '/api/client/platform-accounts/15', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountLabel: 'Not mine' })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 404)

    result = await request(server.baseUrl, `/api/client/platform-accounts/${createdAccount.id}`, {
      method: 'DELETE'
    }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.platformAccounts.some((account: any) => account.id === createdAccount.id), false)

    result = await request(server.baseUrl, '/api/admin/latest-client', {}, clientLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/provider/clients', {}, clientLogin.cookie)
    assert.equal(result.response.status, 403)

    result = await request(server.baseUrl, '/api/dolphin/profiles/status', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.action, 'open_existing')
    assert.deepEqual(result.body.requiredLocales, ['ru'])
    assert.deepEqual(result.body.missingLocales, [])
    assert.deepEqual(result.body.existingProfiles.map((profile: any) => profile.id), [111111111, 111111112])

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', { method: 'POST' }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.username, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
    assert.match(result.body.password, /^[A-Za-z0-9_-]{12}$/)
    assert.notEqual(result.body.password, 'client@example.com')
    assert.equal(result.body.sourceEmail, 'updated-client@example.com')
    assert.equal(result.body.targetClientName, 'Client One')
    assert.deepEqual(result.body.profileIds, [111111111, 111111112])
    assert.deepEqual(leaseCalls[0], {
      ownerKey: 'client:1',
      ownerLabel: 'Client One',
      role: 'client',
      targetClientId: 1,
      targetClientName: 'Client One',
      username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
      password: result.body.password,
      sourceEmail: 'updated-client@example.com',
      profileIds: [111111111, 111111112],
      knownProfileIds: [111111111, 333333332, 101010101, 444444444, 618691401, 111111112, 333333333, 618691402]
    })

    result = await request(server.baseUrl, '/api/dolphin/verification-code/latest', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.deepEqual(result.body, {
      ok: true,
      code: '123456',
      receivedAt: '2026-06-17T09:39:00.000Z',
      ageMs: 30_000
    })

    verificationCodeMode = 'not_found'
    result = await request(server.baseUrl, '/api/dolphin/verification-code/latest', {}, clientLogin.cookie)
    assert.equal(result.response.status, 404)
    assert.equal(result.body.error, 'code_not_found')
    verificationCodeMode = 'setup_error'
    result = await request(server.baseUrl, '/api/dolphin/verification-code/latest', {}, clientLogin.cookie)
    assert.equal(result.response.status, 503)
    assert.equal(result.body.error, 'mailbox_setup_error')
    verificationCodeMode = 'ok'

    result = await request(server.baseUrl, '/api/auth/logout', { method: 'POST' }, clientLogin.cookie)
    assert.equal(result.response.status, 200)
    result = await request(server.baseUrl, '/api/client/me', {}, clientLogin.cookie)
    assert.equal(result.response.status, 401)

    const numericEmailLogin = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '6186914@gmail.com', password: '1234' })
    })
    assert.equal(numericEmailLogin.response.status, 200)
    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', { method: 'POST' }, numericEmailLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.username, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
    assert.match(result.body.password, /^[A-Za-z0-9_-]{12}$/)
    assert.notEqual(result.body.password, '6186914@gmail.com')
    assert.deepEqual(result.body.profileIds, [618691401, 618691402])
    assert.deepEqual(leaseCalls.at(-1), {
      ownerKey: 'client:6',
      ownerLabel: 'Numeric Email Client',
      role: 'client',
      targetClientId: 6,
      targetClientName: 'Numeric Email Client',
      username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
      password: result.body.password,
      sourceEmail: '6186914@gmail.com',
      profileIds: [618691401, 618691402],
      knownProfileIds: [111111111, 333333332, 101010101, 444444444, 618691401, 111111112, 333333333, 618691402]
    })

    rejectDolphinEmail = true
    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', { method: 'POST' }, numericEmailLogin.cookie)
    assert.equal(result.response.status, 422)
    assert.equal(result.body.error, 'dolphin_email_rejected')
    assert.equal(result.body.attemptedUsername, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
    assert.equal(result.body.sharedUserId, 5166733)
    assert.equal(result.body.targetClientId, 6)
    assert.equal(result.body.targetClientName, 'Numeric Email Client')
    assert.equal(result.body.dolphin.code, 'E_TEAM_USERNAME')
    rejectDolphinEmail = false

    stableDolphinEmailUnavailable = true
    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', { method: 'POST' }, numericEmailLogin.cookie)
    assert.equal(result.response.status, 422)
    assert.equal(result.body.error, 'stable_dolphin_email_unavailable')
    assert.equal(
      result.body.message,
      `Stable Dolphin login ${DEFAULT_DOLPHIN_SHARED_USER_EMAIL} is not available in Dolphin. Choose another stable email or free this email in Dolphin.`
    )
    assert.equal(result.body.attemptedUsername, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
    assert.equal(result.body.sharedUserId, 5166733)
    assert.equal(result.body.targetClientId, 6)
    assert.equal(result.body.targetClientName, 'Numeric Email Client')
    assert.equal(result.body.dolphin.code, 'E_TEAM_USERNAME')
    stableDolphinEmailUnavailable = false

    result = await request(server.baseUrl, '/api/auth/logout', { method: 'POST' }, numericEmailLogin.cookie)
    assert.equal(result.response.status, 200)

    const noProfileLogin = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-profile@example.com', password: '1234' })
    })
    assert.equal(noProfileLogin.response.status, 200)
    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', { method: 'POST' }, noProfileLogin.cookie)
    assert.equal(result.response.status, 422)
    assert.equal(result.body.error, 'missing_dolphin_profile_personal_data')
    result = await request(server.baseUrl, '/api/auth/logout', { method: 'POST' }, noProfileLogin.cookie)
    assert.equal(result.response.status, 200)

    const oldAdminLogin = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'veryevilunicorn@gmail.com', password: '101010' })
    })
    assert.equal(oldAdminLogin.response.status, 401)

    const providerLogin = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Nariman', password: 'Nariman' })
    })
    assert.equal(providerLogin.response.status, 200)
    assert.equal(providerLogin.body.role, 'provider')

    result = await request(server.baseUrl, '/api/provider/clients', {}, providerLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.providerDolphinEmail, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
    assert.deepEqual(result.body.clients.map((client: any) => client.clientName), ['Provider Match', 'Provider Missing Profile', 'Newest Client'])
    assert.equal(result.body.clients.some((client: any) => client.clientName === 'Unknown Raw String Should Not Match'), false)
    assert.equal(result.body.clients.some((client: any) => client.clientName === 'Provider Missing Profile'), true)
    assert.equal(result.body.clients[0].linkedInEmail, 'provider-match.linkedin@example.com')
    assert.equal(
      result.body.clients.find((client: any) => client.clientName === 'Newest Client')?.linkedInEmail,
      'newest.linkedin.one@example.com, newest.linkedin.two@example.com'
    )
    assert.deepEqual(Object.keys(result.body.clients[0]).sort(), ['clientName', 'id', 'linkedInEmail', 'primaryStack'])
    assert.equal(JSON.stringify(result.body).includes('clientStatus'), false)

    result = await request(server.baseUrl, '/api/dolphin/verification-code/latest', {}, providerLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.code, '123456')

    result = await request(server.baseUrl, '/api/dolphin/profiles/status?targetClientId=3', {}, providerLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.action, 'open_existing')
    assert.deepEqual(result.body.missingLocales, [])

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 3, targetClientName: 'Provider Match' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.username, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
    assert.match(result.body.password, /^[A-Za-z0-9_-]{12}$/)
    assert.notEqual(result.body.password, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
    assert.deepEqual(result.body.profileIds, [333333332, 333333333])
    assert.equal(leaseCalls.at(-1).targetClientName, result.body.targetClientName)
    assert.equal(leaseCalls.at(-1).targetClientId, 3)
    assert.deepEqual(leaseCalls.at(-1).profileIds, [333333332, 333333333])
    assert.notEqual(leaseCalls.at(-1).targetClientName, 'Newest Client')
    assert.notEqual(leaseCalls.at(-1).targetClientName, 'Unknown Raw String Should Not Match')
    assert.equal(result.body.targetClientName, 'Provider Match')

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 8, targetClientName: 'Provider Missing Profile' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 404)
    assert.equal(result.body.error, 'missing_dolphin_profiles')

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientName: 'Unknown Raw String Should Not Match' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 400)
    assert.equal(result.body.error, 'missing_target_client')
    assert.deepEqual(leaseCalls.at(-1).profileIds, [333333332, 333333333])

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 4, targetClientName: 'Unknown Raw String Should Not Match' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 404)
    assert.equal(result.body.error, 'target_client_not_found')
    assert.deepEqual(leaseCalls.at(-1).profileIds, [333333332, 333333333])

    leaseConflict = true
    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 3, targetClientName: 'Provider Match' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 409)
    assert.equal(result.body.message, 'account in use sorry')
    assert.equal(result.body.activeUntil, 123456)
    leaseConflict = false

    result = await request(server.baseUrl, '/api/client/me', {}, providerLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/client/profile-options', {}, providerLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/client/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Provider' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/client/platform-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'linkedin' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/admin/latest-client', {}, providerLogin.cookie)
    assert.equal(result.response.status, 403)

    result = await request(server.baseUrl, '/api/auth/logout', { method: 'POST' }, providerLogin.cookie)
    assert.equal(result.response.status, 200)
    result = await request(server.baseUrl, '/api/provider/clients', {}, providerLogin.cookie)
    assert.equal(result.response.status, 401)

    const adminLogin = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unicornveryevil@gmail.com', password: '101010' })
    })
    assert.equal(adminLogin.response.status, 200)
    assert.equal(adminLogin.body.role, 'admin')

    result = await request(server.baseUrl, '/api/admin/latest-client', {}, adminLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.client.id, 10)
    assert.equal(result.body.linkedInEmail, 'newest.linkedin.one@example.com, newest.linkedin.two@example.com')
    assert.equal(result.body.platformAccounts[0].password, 'mail-secret')
    result = await request(server.baseUrl, '/api/dolphin/profiles/status?targetClientId=7', {}, adminLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.action, 'create_new')
    assert.deepEqual(result.body.requiredLocales, ['ru', 'en'])
    assert.deepEqual(result.body.missingLocales, ['ru', 'en'])
    assert.equal(result.body.expectedProfileNames[0].name, 'Auto Person REACT Ru')
    assert.equal(result.body.expectedProxyName, 'Auto | {profileId} | Person | 1008 | REACT En')
    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 7, mode: 'open_existing' })
    }, adminLogin.cookie)
    assert.equal(result.response.status, 404)
    assert.equal(result.body.error, 'missing_dolphin_profiles')
    assert.deepEqual(result.body.missingLocales, ['ru', 'en'])
    assert.equal(createdDolphinProfiles.length, 0)

    result = await request(server.baseUrl, '/api/provider/clients', {}, adminLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/client/profile-options', {}, adminLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/client/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Admin' })
    }, adminLogin.cookie)
    assert.equal(result.response.status, 403)

    result = await request(server.baseUrl, '/api/dolphin/verification-code/latest', {}, adminLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.code, '123456')

    result = await request(server.baseUrl, '/api/admin/hh-responses/start', { method: 'POST' }, adminLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.dryRun, true)
    assert.equal(result.body.plannedCommand.env.ORCHESTRATOR_CLIENT_NAMES, 'Newest Client')

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 7 })
    }, adminLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.deepEqual(result.body.profileIds, [900100001, 900100002])
    assert.equal(result.body.targetClientName, 'Auto Provision Client')
    assert.equal(createdDolphinProfiles[0].name, 'Auto Person REACT Ru')
    assert.equal(createdDolphinProfiles[0].proxy, undefined)
    assert.equal(createdDolphinProfiles[2].name, 'Auto Person REACT En')
    assert.deepEqual(createdDolphinProfiles[2].proxy, { id: 601 })
    assert.deepEqual(updatedProxies.at(-1), {
      proxyId: 601,
      patch: { name: 'Auto | 900100002 | Person | 1008 | REACT En' }
    })
    assert.equal(leaseCalls.at(-1).role, 'admin')
    assert.deepEqual(leaseCalls.at(-1).profileIds, [900100001, 900100002])

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 5 })
    }, adminLogin.cookie)
    assert.equal(result.response.status, 422)
    assert.equal(result.body.error, 'missing_dolphin_profile_personal_data')
    assert.equal(result.body.field, 'lastName')
    assert.equal(result.body.fieldLabel, 'last name')
    assert.equal(result.body.requiredFields[0].field, 'lastName')

    const updatedProxyCountBeforeOwnProxy = updatedProxies.length
    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 10, mode: 'create_new', ownProxy: true })
    }, adminLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.deepEqual(result.body.profileIds, [101010101, 900100003])
    assert.equal(result.body.ownProxyName, 'Newest | 900100003 | Client | 1003 | PYTHON En')
    assert.equal(createdDolphinProfiles[4].name, 'Newest Client PYTHON En')
    assert.equal(createdDolphinProfiles[4].proxy, undefined)
    assert.equal(updatedProxies.length, updatedProxyCountBeforeOwnProxy)

    result = await request(server.baseUrl, '/api/auth/logout', { method: 'POST' }, adminLogin.cookie)
    assert.equal(result.response.status, 200)
    result = await request(server.baseUrl, '/api/admin/latest-client', {}, adminLogin.cookie)
    assert.equal(result.response.status, 401)
  } finally {
    await server.close()
  }
}

runTests()
  .then(() => console.log('web console backend tests passed'))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
