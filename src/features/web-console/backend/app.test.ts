const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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
  buildResumeWorkflowPatch,
  cvProcessingClientId,
  isLinkedInPlatformAccount,
  LINKEDIN_PLATFORM_ID,
  profileClientId,
  profileId
} = require('./repository.ts') as {
  buildAccountPatch(input: any, options: { includeBlankSecrets: boolean }): Record<string, unknown>
  buildChangedClientPatch(current: any, input: any): Record<string, unknown>
  buildLinkedInEmailByClientId(accounts: Array<Record<string, unknown> & { Id: number }>): Map<number, string>
  buildClientPatch(input: any): Record<string, unknown>
  buildResumeWorkflowPatch(input: any): Record<string, unknown>
  cvProcessingClientId(record: Record<string, unknown> & { Id: number }): number | null
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
const { createFakeTdlibAdapter } = require('../../../integrations/telegram/tdlib-client.ts') as {
  createFakeTdlibAdapter(): any
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
      real_age: 24,
      stop_list_company: 'BadCorp,EvilInc',
      google_folder: 'https://drive.google.com/drive/folders/client-one',
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
      telegram_personal_chat_id: '@newest_student',
      telegram_general_chat_id: '1003',
      rel_clients_primary_stack: { Id: 10, name: 'PYTHON' },
      market: 'En',
      client_status: 'on en market'
    },
    {
      Id: 2,
      client_name: 'No Chat Client',
      first_name: 'No',
      last_name: 'Chat',
      fio: 'No Chat',
      calendar_email: 'no-chat@example.com',
      telegram_general_chat_id: '',
      rel_clients_primary_stack: { Id: 18, name: 'QA' },
      market: 'Ru',
      client_status: { Id: 1, title: 'studying' }
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
      Id: 17,
      platform: 'telegram_ru',
      account_label: 'Client One Telegram',
      login: '@client_one_tg',
      phone: '+79990001122',
      password: 'tg-cloud-pass',
      rel_platformAccounts_client: { Id: 1 },
      rel_platformAccounts_platform: { Id: 2, name: 'telegram', label: 'telegram_ru' }
    },
    {
      Id: 18,
      platform: 'phone_en',
      account_label: 'phone_en telegram-looking label',
      phone: '+79990003344',
      telegram_session_status: 'active',
      telegram_tdlib_db_path: 'stale-phone-session',
      rel_platformAccounts_client: { Id: 1 },
      rel_platformAccounts_platform: { Id: 7, name: 'phone', label: 'phone_en' }
    },
    {
      Id: 19,
      platform: 'telegram_en',
      account_label: 'Completely custom label',
      phone: '+79990005566',
      rel_platformAccounts_client: { Id: 1 },
      rel_platformAccounts_platform: { Id: 4, name: 'telegram', label: 'telegram_en' }
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
    { Id: 2, label: 'telegram_ru' },
    { Id: 4, label: 'telegram_en' },
    { Id: 7, label: 'phone_en', name: 'phone' },
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
  const cvProcessing: Array<Record<string, any> & { Id: number }> = [
    {
      Id: 98,
      record_key: 'Client One',
      clients_id: 1,
      status: "collection student's data",
      student_data_folder_url: '',
      cv_draft_url: '',
      en_version_url: '',
      ru_version_url: '',
      additional_versions: '',
      kiras_comments: '',
      last_responsible: 'student',
      last_workflow_error: '',
      workflow_trace: ''
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
      if (tableId === 'mhiysd8l0f33bny') return cvProcessing
      return []
    },
    async createRecord(tableId: string, record: Record<string, any>) {
      calls.push(`create:${tableId}`)
      assert(['m8zej2vsv4iypl8', 'm4thvbutfyb15qz', 'mhiysd8l0f33bny'].includes(tableId))
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
      if (tableId === 'mhiysd8l0f33bny') {
        const created: Record<string, any> & { Id: number } = {
          Id: Math.max(...cvProcessing.map(row => Number(row.Id))) + 1,
          ...record
        }
        cvProcessing.push(created)
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
      const records = tableId === 'mxza381054ldlza'
        ? clients
        : tableId === 'm8zej2vsv4iypl8'
          ? platformAccounts
          : tableId === 'mhiysd8l0f33bny'
            ? cvProcessing
            : []
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
  assert.equal(cvProcessingClientId({ Id: 1, clients_id: 30 }), 30)
  assert.equal(cvProcessingClientId({ Id: 1, client: { Id: 31 }, clients_id: 30 }), 31)
  assert.deepEqual(buildClientPatch({
    firstName: 'New',
    lastName: 'Name',
    fio: 'New Name',
    birthDate: '2001-02-03',
    education: 'University',
    realAge: 29,
    stopListCompany: 'Acme,Globex',
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
    real_age: 29,
    stop_list_company: 'Acme,Globex',
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
    realAge: 24,
    stopListCompany: 'BadCorp,EvilInc',
    googleFolder: 'https://drive.google.com/drive/folders/client-one',
    englishLevelId: 3,
    telegramPersonalChatId: '@client_one',
    calendarEmail: 'client@example.com'
  }, {
    firstName: 'Client',
    lastName: 'One',
    fio: 'Client One Legal',
    birthDate: '2000-01-01',
    education: 'New school',
    realAge: 24,
    stopListCompany: 'BadCorp,EvilInc',
    googleFolder: 'https://drive.google.com/drive/folders/client-one',
    englishLevelId: 3,
    telegramPersonalChatId: '@client_one',
    calendarEmail: 'client@example.com'
  }), {
    education: 'New school'
  })
  assert.deepEqual(buildResumeWorkflowPatch({
    status: 'filled',
    studentDataFolderUrl: 'https://drive.google.com/drive/folders/source',
    cvDraftUrl: 'https://docs.google.com/document/d/draft',
    enVersionUrl: 'https://docs.google.com/document/d/en',
    ruVersionUrl: 'https://docs.google.com/document/d/ru',
    kirasComments: 'ok',
    lastResponsible: 'done',
    lastWorkflowError: '',
    workflowTrace: 'trace',
    ignored: 'nope'
  }), {
    status: 'filled',
    student_data_folder_url: 'https://drive.google.com/drive/folders/source',
    cv_draft_url: 'https://docs.google.com/document/d/draft',
    en_version_url: 'https://docs.google.com/document/d/en',
    ru_version_url: 'https://docs.google.com/document/d/ru',
    kiras_comments: 'ok',
    last_responsible: 'done',
    last_workflow_error: '',
    workflow_trace: 'trace'
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
  const telegramAccounts = await repository.getTelegramPlatformAccountsForClient(1)
  assert.deepEqual(telegramAccounts.map((account: any) => account.id), [17, 19])
  assert.equal(telegramAccounts.every((account: any) => account.isTelegramAccount), true)
  const clientDashboard = await repository.getClientDashboard(1, { fullAccess: true })
  assert.equal(clientDashboard.platformAccounts.find((account: any) => account.id === 18)?.isTelegramAccount, false)
  assert.equal(clientDashboard.platformAccounts.find((account: any) => account.id === 19)?.isTelegramAccount, true)
  assert.equal((await repository.listActiveTelegramSenders()).some((sender: any) => sender.accountId === 18), false)
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
  let verificationCodeMode: 'ok' | 'not_found' | 'setup_error' | 'invalid_grant' = 'ok'
  let nextCreatedDolphinProfileId = 900100001
  const createdDolphinProfiles: any[] = []
  const updatedProxies: any[] = []
  const telegramBotMessages: any[] = []
  let cvTailoringShouldFail = false
  let cvTailoringResponseMode: 'plain' | 'json_object' = 'plain'
  const cvTailoringCalls: any[] = []
  const fixtureDir = path.resolve(__dirname, '..', 'test-fixtures', 'ai-tailoring')
  const cvTailoringFixturePdf = fs.readFileSync(path.join(fixtureDir, 'Kira Samsonova React.pdf'))
  const cvTailoringFixtureRequirements = fs.readFileSync(path.join(fixtureDir, 'AI-tailor-test-text.txt'), 'utf8')
  const previousCvTailoringApiKey = process.env.CV_TAILORING_API_KEY
  process.env.WEB_CONSOLE_BOT_API_TOKEN = 'test-bot-token'
  process.env.CV_TAILORING_API_KEY = 'test-cv-tailoring-key'
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
    telegramAdapter: createFakeTdlibAdapter(),
    cvTailoringFetch: async (url: string, init: any) => {
      const formData = init.body
      const cv = formData.get('cv')
      const cvBytes = Buffer.from(await cv.arrayBuffer())
      cvTailoringCalls.push({
        url,
        method: init.method,
        apiKey: init.headers?.['x-api-key'],
        cvFileName: cv.name,
        cvType: cv.type,
        cvBytes,
        jobRequirements: formData.get('jobRequirements')
      })
      if (cvTailoringShouldFail) {
        return new Response('Tailoring unavailable', { status: 503 })
      }
      if (cvTailoringResponseMode === 'json_object') {
        return new Response(JSON.stringify({ url: 'https://tailered-cv.example/result/from-json-object' }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      }
      return new Response('https://tailered-cv.example/result/kira-samsonova-react', {
        status: 200,
        headers: {
          'content-type': 'text/plain'
        }
      })
    },
    telegramBotApi: {
      async sendMessage(input: any) {
        if (input.text === 'fail telegram') {
          throw Object.assign(new Error('Telegram exploded'), { code: 'telegram_bot_api_failed' })
        }
        telegramBotMessages.push(input)
        return { message_id: telegramBotMessages.length, chat: { id: input.chatId }, text: input.text }
      }
    },
    telegramProxyResolver: async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 }),
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
        if (verificationCodeMode === 'invalid_grant') {
          const error = new Error('Gmail authorization expired or was revoked.') as Error & { code?: string; reason?: string }
          error.code = 'mailbox_setup_error'
          error.reason = 'gmail_oauth_invalid_grant'
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
    assert.equal(result.body.client.realAge, 24)
    assert.equal(result.body.client.stopListCompany, 'BadCorp,EvilInc')
    assert.equal(result.body.client.googleFolder, 'https://drive.google.com/drive/folders/client-one')
    assert.equal(result.body.client.englishLevel, 'B1')
    assert.equal(result.body.linkedInEmail, 'client-one.linkedin@example.com')
    assert.equal(result.body.platformAccounts[0].password, '***')

    result = await request(server.baseUrl, '/api/bot/status', {
      headers: { 'X-Bot-Api-Token': 'test-bot-token' }
    })
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.ok, true)
    assert.equal(result.body.service, 'web-console-backend')

    result = await request(server.baseUrl, '/api/bot/telegram/chats/1001/client', {
      headers: { 'X-Bot-Api-Token': 'test-bot-token' }
    })
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.found, true)
    assert.equal(result.body.client.name, 'Client One')
    assert.equal(result.body.client.chatId, '1001')
    assert.equal(result.body.client.googleFolder, 'https://drive.google.com/drive/folders/client-one')

    result = await request(server.baseUrl, '/api/bot/telegram/chats/9999/client', {
      headers: { 'X-Bot-Api-Token': 'test-bot-token' }
    })
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.found, false)

    result = await request(server.baseUrl, '/api/bot/telegram/chats/1001/client', {
      headers: { 'X-Bot-Api-Token': 'wrong-token' }
    })
    assert.equal(result.response.status, 401, JSON.stringify(result.body))

    const configuredBotToken = process.env.WEB_CONSOLE_BOT_API_TOKEN
    delete process.env.WEB_CONSOLE_BOT_API_TOKEN
    result = await request(server.baseUrl, '/api/bot/telegram/chats/1001/client', {
      headers: { 'X-Bot-Api-Token': 'test-bot-token' }
    })
    assert.equal(result.response.status, 503, JSON.stringify(result.body))
    assert.equal(result.body.error, 'bot_api_token_not_configured')
    process.env.WEB_CONSOLE_BOT_API_TOKEN = configuredBotToken

    result = await request(server.baseUrl, '/api/bot/telegram/chats/1001/google-folder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Token': 'test-bot-token' },
      body: JSON.stringify({ googleFolder: 'https://drive.google.com/drive/folders/updated' })
    })
    assert.equal(result.response.status, 410, JSON.stringify(result.body))
    assert.equal(result.body.error, 'google_folder_telegram_edit_disabled')
    assert.equal(noco.calls.some((call: string) => call.startsWith('patch:mhiysd8l0f33bny')), false)

    result = await request(server.baseUrl, '/api/bot/telegram/chats/1001/resume/status', {
      headers: { 'X-Bot-Api-Token': 'test-bot-token' }
    })
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.found, true)
    assert.equal(result.body.client.name, 'Client One')
    assert.equal(result.body.workflow.status, "collection student's data")
    assert.match(result.body.message, /Ответственный: ученик/)

    result = await request(server.baseUrl, '/api/bot/telegram/chats/1003/resume/status', {
      headers: { 'X-Bot-Api-Token': 'test-bot-token' }
    })
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.client.name, 'Newest Client')
    assert.equal(result.body.workflow.status, "collection student's data")
    assert.equal(noco.calls.includes('create:mhiysd8l0f33bny'), true)

    result = await request(server.baseUrl, '/api/bot/telegram/chats/9999/resume/status', {
      headers: { 'X-Bot-Api-Token': 'test-bot-token' }
    })
    assert.equal(result.response.status, 404, JSON.stringify(result.body))
    assert.equal(result.body.found, false)

    result = await request(server.baseUrl, '/api/bot/telegram/chats/1001/resume/reset-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Token': 'test-bot-token' },
      body: JSON.stringify({})
    })
    assert.equal(result.response.status, 403, JSON.stringify(result.body))
    assert.equal(result.body.error, 'resume_reset_test_disabled')

    const previousResumeTestMode = process.env.RESUME_WORKFLOW_TEST_MODE
    const previousProviderRefs = process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS
    const previousProviderUserIds = process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS
    const previousProviderNotifyChatId = process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID
    const previousKiraUserIds = process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS
    const previousKiraNotifyChatId = process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID
    const previousFakeDataMode = process.env.RESUME_WORKFLOW_FAKE_DATA_MODE
    process.env.RESUME_WORKFLOW_TEST_MODE = 'true'
    process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS = '1:12'
    process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS = '8222949251,315110920'
    process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID = '8222949251'
    process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS = '343610488'
    process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID = '343610488'
    process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = 'true'
    try {
      const botHeaders = { 'Content-Type': 'application/json', 'X-Bot-Api-Token': 'test-bot-token' }
      const studentHeaders = {
        ...botHeaders,
        'X-Telegram-User-Id': '100',
        'X-Telegram-Username': 'client_one',
        'X-Telegram-Chat-Id': '1001',
        'X-Telegram-Chat-Type': 'supergroup'
      }
      const newestStudentHeaders = {
        ...botHeaders,
        'X-Telegram-User-Id': '101',
        'X-Telegram-Username': 'newest_student',
        'X-Telegram-Chat-Id': '1003',
        'X-Telegram-Chat-Type': 'supergroup'
      }
      const kiraHeaders = {
        ...botHeaders,
        'X-Telegram-User-Id': '343610488',
        'X-Telegram-Username': 'kira_manual',
        'X-Telegram-Chat-Id': '343610488',
        'X-Telegram-Chat-Type': 'private'
      }
      const providerHeaders = {
        ...botHeaders,
        'X-Telegram-User-Id': '8222949251',
        'X-Telegram-Username': 'veu_support',
        'X-Telegram-Chat-Id': '8222949251',
        'X-Telegram-Chat-Type': 'private'
      }
      const resumeByChat = async (headers: Record<string, string>, chatId = '1001', body: Record<string, unknown> = {}) => request(server.baseUrl, `/api/bot/telegram/chats/${chatId}/resume`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })

      process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = 'false'
      await noco.patchRecord('mhiysd8l0f33bny', 98, {
        status: 'English version in progress',
        student_data_folder_url: '',
        cv_draft_url: '',
        kiras_comments: '',
        en_version_url: 'https://drive.google.com/drive/folders/seeded-en',
        ru_version_url: ''
      })
      result = await resumeByChat(providerHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'English version in approve by Kira')
      assert.equal(result.body.workflow.enVersionUrl, 'https://drive.google.com/drive/folders/seeded-en')
      assert.deepEqual(result.body.transitions, ['English version in progress -> English version in approve by Kira'])
      assert.doesNotMatch(result.body.message, /самопрезентацией|комментарии Киры|черновик/)
      await noco.patchRecord('mhiysd8l0f33bny', 98, {
        status: "collection student's data",
        student_data_folder_url: '',
        cv_draft_url: '',
        en_version_url: '',
        ru_version_url: '',
        kiras_comments: '',
        last_responsible: 'student',
        last_workflow_error: '',
        workflow_trace: ''
      })
      process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = 'true'

      result = await resumeByChat(newestStudentHeaders, '1003')
      assert.equal(result.response.status, 422, JSON.stringify(result.body))
      assert.equal(result.body.error, 'resume_required_data_missing')
      assert.deepEqual(result.body.missingFields, ['Education', 'English level'])

      result = await resumeByChat(studentHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, "collection student's data")
      assert.equal(result.body.workflow.studentDataFolderUrl, '')
      assert.deepEqual(result.body.transitions, [])
      assert.match(result.body.message, /самопрезентацией\/исходными данными/)

      result = await resumeByChat(studentHeaders, '1001', {
        studentDataFolderUrl: 'https://drive.google.com/drive/folders/student-source'
      })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, "collection Kira's comments")
      assert.equal(result.body.workflow.studentDataFolderUrl, 'https://drive.google.com/drive/folders/student-source')
      assert.equal(result.body.transitions.at(-1), "collection student's data -> collection Kira's comments")
      assert.equal(result.body.notifications.at(-1).kind, 'private_kira')
      assert.equal(telegramBotMessages.at(-1).chatId, '343610488')

      result = await resumeByChat(providerHeaders)
      assert.equal(result.response.status, 403, JSON.stringify(result.body))
      assert.equal(result.body.error, 'forbidden')

      result = await resumeByChat(kiraHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'Draft in process')
      assert.equal(result.body.notifications.at(-1).kind, 'private_provider')
      assert.deepEqual(result.body.notifications.at(-1).chatIds, ['8222949251', '315110920'])
      assert.deepEqual(telegramBotMessages.slice(-2).map((message: any) => message.chatId), ['8222949251', '315110920'])

      result = await request(server.baseUrl, '/api/bot/telegram/resume/provider/tasks', {
        headers: providerHeaders
      })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.deepEqual(result.body.tasks.map((task: any) => task.clientName), ['Client One'])
      assert.equal(result.body.tasks[0].expectedStatus, 'Draft in process')
      const workflowId = result.body.tasks[0].id

      result = await request(server.baseUrl, '/api/bot/telegram/resume/provider/tasks', {
        headers: studentHeaders
      })
      assert.equal(result.response.status, 403, JSON.stringify(result.body))
      assert.equal(result.body.error, 'forbidden')

      result = await request(server.baseUrl, `/api/bot/telegram/resume/workflows/${workflowId}/advance`, {
        method: 'POST',
        headers: providerHeaders,
        body: JSON.stringify({ expectedStatus: 'Draft in process' })
      })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'Draft in approve by Kira')
      assert.equal(result.body.workflow.cvDraftUrl, 'https://docs.google.com/document/d/test-draft')

      result = await request(server.baseUrl, '/api/bot/telegram/resume/provider/tasks', {
        headers: kiraHeaders
      })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.deepEqual(result.body.tasks.map((task: any) => task.clientName), ['Client One'])
      assert.equal(result.body.tasks[0].expectedStatus, 'Draft in approve by Kira')
      assert.match(result.body.message, /^Задачи Киры по резюме:/)

      result = await request(server.baseUrl, `/api/bot/telegram/resume/workflows/${workflowId}`, {
        headers: kiraHeaders
      })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'Draft in approve by Kira')

      result = await request(server.baseUrl, `/api/bot/telegram/resume/workflows/${workflowId}/advance`, {
        method: 'POST',
        headers: providerHeaders,
        body: JSON.stringify({ expectedStatus: 'Draft in process' })
      })
      assert.equal(result.response.status, 409, JSON.stringify(result.body))
      assert.equal(result.body.error, 'resume_workflow_stale_status')

      result = await resumeByChat(kiraHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'Draft in approve by student')
      assert.equal(result.body.notifications.at(-1).kind, 'common_chat')
      assert.match(telegramBotMessages.at(-1).text, /@client_one/)

      result = await resumeByChat(studentHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'English version in progress')

      result = await resumeByChat(providerHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'English version in approve by Kira')
      assert.equal(result.body.workflow.enVersionUrl, 'https://docs.google.com/document/d/test-english-version')

      result = await resumeByChat(kiraHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'English version in approve by student')

      result = await resumeByChat(studentHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'Russian version in process')

      result = await resumeByChat(providerHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'Russian version in approve by Kira')
      assert.equal(result.body.workflow.ruVersionUrl, 'https://docs.google.com/document/d/test-russian-version')

      result = await resumeByChat(kiraHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, 'Russian version in approve by student')

      result = await resumeByChat(studentHeaders)
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.completed, false)
      assert.equal(result.body.workflow.status, 'moved to filling')
      assert.equal(result.body.transitions.at(-1), 'Russian version in approve by student -> moved to filling')
      assert(result.body.notifications.some((notification: any) => notification.kind === 'private_kira'))
      assert.match(result.body.message, /передано на заполнение/)

      result = await request(server.baseUrl, '/api/bot/telegram/chats/1001/resume/reset-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Token': 'test-bot-token' },
        body: JSON.stringify({})
      })
      assert.equal(result.response.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.workflow.status, "collection student's data")
      assert.equal(result.body.workflow.cvDraftUrl, '')
      assert.equal(result.body.workflow.enVersionUrl, '')
      assert.equal(result.body.workflow.ruVersionUrl, '')
    } finally {
      if (previousResumeTestMode === undefined) {
        delete process.env.RESUME_WORKFLOW_TEST_MODE
      } else {
        process.env.RESUME_WORKFLOW_TEST_MODE = previousResumeTestMode
      }
      if (previousProviderRefs === undefined) {
        delete process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS
      } else {
        process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS = previousProviderRefs
      }
      if (previousProviderUserIds === undefined) {
        delete process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS
      } else {
        process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS = previousProviderUserIds
      }
      if (previousProviderNotifyChatId === undefined) {
        delete process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID
      } else {
        process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID = previousProviderNotifyChatId
      }
      if (previousKiraUserIds === undefined) {
        delete process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS
      } else {
        process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS = previousKiraUserIds
      }
      if (previousKiraNotifyChatId === undefined) {
        delete process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID
      } else {
        process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID = previousKiraNotifyChatId
      }
      if (previousFakeDataMode === undefined) {
        delete process.env.RESUME_WORKFLOW_FAKE_DATA_MODE
      } else {
        process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = previousFakeDataMode
      }
    }

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
        realAge: 25,
        stopListCompany: 'Meta,Google',
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
    assert.equal(result.body.client.realAge, 25)
    assert.equal(result.body.client.stopListCompany, 'Meta,Google')
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
    verificationCodeMode = 'invalid_grant'
    result = await request(server.baseUrl, '/api/dolphin/verification-code/latest', {}, clientLogin.cookie)
    assert.equal(result.response.status, 503)
    assert.equal(result.body.error, 'mailbox_setup_error')
    assert.equal(result.body.reason, 'gmail_oauth_invalid_grant')
    verificationCodeMode = 'ok'

    result = await request(server.baseUrl, '/api/telegram/status?platformAccountId=17', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.accountId, 17)
    assert.equal(result.body.status, 'disconnected')

    result = await request(server.baseUrl, '/api/telegram/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformAccountId: 17 })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.status, 'needs_code')

    result = await request(server.baseUrl, '/api/telegram/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformAccountId: 17, code: '12345' })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.status, 'active')

    const adminForTelegramLogin = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unicornveryevil@gmail.com', password: '101010' })
    })
    assert.equal(adminForTelegramLogin.response.status, 200)
    result = await request(server.baseUrl, '/api/admin/telegram/senders', {}, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.senders.some((sender: any) => sender.clientId === 1 && sender.accountId === 17), true)
    result = await request(server.baseUrl, '/api/admin/telegram/dialogs/scan?targetClientId=1&platformAccountId=17&days=1', {}, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.accountResult.outcome, 'complete')
    assert.equal(result.body.accountResult.lists.main.complete, true)
    assert.equal(result.body.accountResult.lists.archive.complete, true)
    assert.equal(result.body.rows.some((row: any) => row.chatId === 'reporting-chat'), true)
    result = await request(server.baseUrl, '/api/admin/telegram/dialogs/scan?targetClientId=1&platformAccountId=17&days=0', {}, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 400, JSON.stringify(result.body))
    assert.equal(result.body.error, 'invalid_admin_telegram_dialog_days')
    result = await request(server.baseUrl, '/api/admin/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetClientId: 1,
        platformAccountId: 17,
        username: '@client_partner',
        text: 'Admin route smoke test',
        attachments: [{ fileName: 'feature.md', mimeType: 'text/markdown', dataBase64: Buffer.from('# Feature').toString('base64') }]
      })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.messages.length, 2)
    result = await request(server.baseUrl, '/api/admin/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetClientId: 1,
        platformAccountId: 17,
        username: 'client_partner',
        text: 'Bad username'
      })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 400, JSON.stringify(result.body))
    assert.equal(result.body.error, 'telegram_invalid_username')

    result = await request(server.baseUrl, '/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Kira Samsonova React.pdf',
        mimeType: 'application/pdf',
        dataBase64: cvTailoringFixturePdf.toString('base64'),
        jobRequirements: cvTailoringFixtureRequirements
      })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.url, 'https://tailered-cv.example/result/kira-samsonova-react')
    assert.equal(cvTailoringCalls.at(-1).url, 'https://tailered-cv.onrender.com/cv-from-pdf')
    assert.equal(cvTailoringCalls.at(-1).method, 'POST')
    assert.equal(cvTailoringCalls.at(-1).apiKey, 'test-cv-tailoring-key')
    assert.equal(cvTailoringCalls.at(-1).cvFileName, 'Kira Samsonova React.pdf')
    assert.equal(cvTailoringCalls.at(-1).cvType, 'application/pdf')
    assert.equal(cvTailoringCalls.at(-1).cvBytes.length > 0, true)
    assert.deepEqual(cvTailoringCalls.at(-1).cvBytes.subarray(0, 4), Buffer.from('%PDF'))
    assert.equal(cvTailoringCalls.at(-1).jobRequirements, cvTailoringFixtureRequirements)

    cvTailoringResponseMode = 'json_object'
    result = await request(server.baseUrl, '/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Kira Samsonova React.pdf',
        mimeType: 'application/pdf',
        dataBase64: cvTailoringFixturePdf.toString('base64'),
        jobRequirements: cvTailoringFixtureRequirements
      })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.url, 'https://tailered-cv.example/result/from-json-object')
    cvTailoringResponseMode = 'plain'

    const configuredCvTailoringApiKey = process.env.CV_TAILORING_API_KEY
    delete process.env.CV_TAILORING_API_KEY
    result = await request(server.baseUrl, '/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Kira Samsonova React.pdf',
        mimeType: 'application/pdf',
        dataBase64: cvTailoringFixturePdf.toString('base64'),
        jobRequirements: cvTailoringFixtureRequirements
      })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 503, JSON.stringify(result.body))
    assert.equal(result.body.error, 'cv_tailoring_not_configured')
    process.env.CV_TAILORING_API_KEY = configuredCvTailoringApiKey

    result = await request(server.baseUrl, '/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Kira Samsonova React.pdf',
        mimeType: 'application/pdf',
        dataBase64: cvTailoringFixturePdf.toString('base64'),
        jobRequirements: ''
      })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 400, JSON.stringify(result.body))
    assert.equal(result.body.error, 'cv_tailoring_missing_job_requirements')

    result = await request(server.baseUrl, '/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        dataBase64: Buffer.from('not a pdf').toString('base64'),
        jobRequirements: cvTailoringFixtureRequirements
      })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 400, JSON.stringify(result.body))
    assert.equal(result.body.error, 'cv_tailoring_invalid_pdf')

    cvTailoringShouldFail = true
    result = await request(server.baseUrl, '/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Kira Samsonova React.pdf',
        mimeType: 'application/pdf',
        dataBase64: cvTailoringFixturePdf.toString('base64'),
        jobRequirements: cvTailoringFixtureRequirements
      })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 502, JSON.stringify(result.body))
    assert.equal(result.body.error, 'cv_tailoring_api_failed')
    assert.equal(result.body.status, 503)
    cvTailoringShouldFail = false

    result = await request(server.baseUrl, '/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Kira Samsonova React.pdf',
        mimeType: 'application/pdf',
        dataBase64: cvTailoringFixturePdf.toString('base64'),
        jobRequirements: cvTailoringFixtureRequirements
      })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 403)

    result = await request(server.baseUrl, '/api/admin/clients/1/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello linked chat' })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.success, true)
    assert.equal(result.body.sentTo.chatId, '1001')
    assert.deepEqual(telegramBotMessages.at(-1), { chatId: '1001', text: 'Hello linked chat' })

    result = await request(server.baseUrl, '/api/admin/clients/1/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 400, JSON.stringify(result.body))
    assert.equal(result.body.error, 'telegram_empty_message')

    result = await request(server.baseUrl, '/api/admin/clients/2/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'No chat' })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 400, JSON.stringify(result.body))
    assert.equal(result.body.error, 'CLIENT_HAS_NO_TELEGRAM_CHAT_ID')

    result = await request(server.baseUrl, '/api/admin/clients/1/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'fail telegram' })
    }, adminForTelegramLogin.cookie)
    assert.equal(result.response.status, 502, JSON.stringify(result.body))
    assert.equal(result.body.error, 'TELEGRAM_SEND_FAILED')

    result = await request(server.baseUrl, '/api/telegram/dialogs?platformAccountId=17', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.dialogs.some((dialog: any) => dialog.id === 'reporting-chat'), true)
    assert.equal(result.body.dialogs.every((dialog: any) => Boolean(dialog.lastMessageAt)), true)

    result = await request(server.baseUrl, '/api/telegram/folders?platformAccountId=17', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.folders.some((folder: any) => folder.id === 'archive'), true)

    result = await request(server.baseUrl, '/api/telegram/dialogs?platformAccountId=17&list=archive', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.dialogs.some((dialog: any) => dialog.id === 'archived-chat'), true)

    result = await request(server.baseUrl, '/api/telegram/dialogs?platformAccountId=17&query=client', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.dialogs.some((dialog: any) => dialog.id === 'client-chat'), true)
    assert.equal(result.body.dialogs.find((dialog: any) => dialog.id === 'client-chat')?.username, '@client_partner')

    result = await request(server.baseUrl, '/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformAccountId: 17, chatId: 'reporting-chat', text: 'TDLib route smoke test' })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 400, JSON.stringify(result.body))
    assert.equal(result.body.error, 'telegram_readonly')

    result = await request(server.baseUrl, '/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformAccountId: 17, chatId: 'reporting-chat', text: 'TDLib route smoke test', allowWrite: true })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.message.text, 'TDLib route smoke test')

    result = await request(server.baseUrl, '/api/telegram/rename-contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformAccountId: 17, chatId: 'client-chat', firstName: 'Safe', lastName: 'Lead' })
    }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.dialog.title, 'Safe Lead')

    result = await request(server.baseUrl, '/api/telegram/messages?platformAccountId=17&chatId=reporting-chat', {}, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.messages.some((message: any) => message.text === 'TDLib route smoke test'), true)

    result = await request(server.baseUrl, '/api/telegram/disconnect?platformAccountId=17', { method: 'DELETE' }, clientLogin.cookie)
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.status, 'needs_reauth')

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
    result = await request(server.baseUrl, '/api/admin/telegram/senders', {}, providerLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/admin/telegram/dialogs/scan?targetClientId=1&platformAccountId=17&days=1', {}, providerLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/admin/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 1, platformAccountId: 17, username: '@client_partner', text: 'blocked' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/admin/cv-tailor/from-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Kira Samsonova React.pdf',
        mimeType: 'application/pdf',
        dataBase64: cvTailoringFixturePdf.toString('base64'),
        jobRequirements: cvTailoringFixtureRequirements
      })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/admin/clients/1/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'blocked' })
    }, providerLogin.cookie)
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
    if (previousCvTailoringApiKey === undefined) {
      delete process.env.CV_TAILORING_API_KEY
    } else {
      process.env.CV_TAILORING_API_KEY = previousCvTailoringApiKey
    }
  }
}

runTests()
  .then(() => console.log('web console backend tests passed'))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
