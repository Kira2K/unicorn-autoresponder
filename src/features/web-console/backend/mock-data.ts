const mockClients = [
  {
    Id: 1,
    client_name: 'Test',
    first_name: 'Test',
    last_name: 'Client',
    fio: 'Test Client',
    birth_date: '2000-01-01',
    education: 'Initial school',
    education_entries: JSON.stringify([
      {
        uni: 'Initial school',
        faculty: 'Computer Science',
        grade: 'Bachelor',
        yearOfEnd: '2022'
      }
    ]),
    real_age: 24,
    real_location: 'Tbilisi, Georgia',
    desired_location: 'Remote RU',
    google_folder: 'https://drive.google.com/drive/folders/mock-client',
    calendar_email: 'client@example.com',
    telegram_personal_chat_id: '@test_client',
    telegram_general_chat_id: '5216637594',
    rel_clients_primary_stack: { Id: 10, name: 'FRONTEND' },
    market: 'Ru',
    english_levels_id: 3,
    'English level': { Id: 3, level: 'B1' },
    client_status: { Id: 1, title: 'studying' }
  },
  {
    Id: 10,
    client_name: 'Latest Admin Client',
    first_name: 'Latest',
    last_name: 'Client',
    fio: 'Latest Client',
    calendar_email: 'latest@example.com',
    google_folder: 'https://drive.google.com/drive/folders/latest-client',
    telegram_general_chat_id: '-100200300',
    rel_clients_primary_stack: { Id: 11, name: 'PYTHON' },
    market: 'En',
    client_status: 'on en market'
  },
  {
    Id: 2,
    client_name: 'Ильяс Тохтаран',
    first_name: 'Ilyas',
    last_name: 'Tokhtaran',
    fio: 'Ilyas Tokhtaran',
    calendar_email: 'provider-visible@example.com',
    education: 'Provider University',
    education_entries: JSON.stringify([
      { uni: 'Provider University', faculty: 'Data', grade: 'Master', yearOfEnd: '2023' }
    ]),
    real_age: 26,
    real_location: 'Almaty, Kazakhstan',
    desired_location: 'Remote EN',
    telegram_general_chat_id: '-100200301',
    rel_clients_primary_stack: { Id: 12, name: 'DATA' },
    market: 'En',
    stop_list_company: 'Smartcat, Bank CenterCredit',
    client_status: { id: 'sxi0rjsc39ffpt5', name: 'on en market' }
  },
  {
    Id: 3,
    client_name: 'Provider Hidden Client',
    calendar_email: 'provider-hidden@example.com',
    telegram_general_chat_id: '-100200302',
    rel_clients_primary_stack: { Id: 13, name: 'GO' },
    market: 'En',
    client_status: { Id: 4, title: 'paused' }
  },
  {
    Id: 4,
    client_name: 'Mock Missing Profiles',
    first_name: 'Mock',
    last_name: 'Person',
    fio: 'Mock Person',
    calendar_email: 'missing-profiles@example.com',
    telegram_general_chat_id: '-100777001',
    rel_clients_primary_stack: { Id: 14, name: 'REACT' },
    market: 'both',
    client_status: { Id: 1, title: 'studying' }
  },
  {
    Id: 5,
    client_name: 'Mock Missing Name',
    first_name: 'Solo',
    last_name: '',
    fio: 'Solo',
    calendar_email: 'missing-name@example.com',
    telegram_general_chat_id: '-100777002',
    rel_clients_primary_stack: { Id: 15, name: 'PYTHON' },
    market: 'ru',
    client_status: { Id: 1, title: 'studying' }
  },
  {
    Id: 6,
    client_name: 'Provider Ru Visible',
    first_name: 'Provider',
    last_name: 'Ru',
    fio: 'Provider Ru Visible',
    calendar_email: 'provider-ru-visible@example.com',
    telegram_general_chat_id: '-100777003',
    rel_clients_primary_stack: { Id: 16, name: 'PYTHON' },
    market: 'ru',
    client_status: { id: 'sxi0rjsc39ffpt5', name: 'on en market' }
  }
]

const mockPlatformAccounts = [
  {
    Id: 101,
    platform: 'hh_ru',
    account_label: 'Kira HH Ru',
    login: '+79990001122',
    phone: '+79990001122',
    email: 'kira.hh@example.com',
    password: 'hh-secret',
    email_password: 'mail-secret',
    rel_platformAccounts_client: { Id: 1 }
  },
  {
    Id: 103,
    account_label: 'Kira LinkedIn',
    login: 'kira.linkedin@example.com',
    linkedin_url: 'https://linkedin.com/in/kira-test',
    phone: '',
    email: '',
    password: '',
    rel_platformAccounts_client: { Id: 1 },
    rel_platformAccounts_platform: { Id: 16, name: 'linkedin', label: 'linkedin' }
  },
  {
    Id: 106,
    platform: 'github',
    account_label: 'Kira GitHub',
    login: 'https://github.com/kira-test',
    phone: '',
    email: '',
    password: '',
    clients_id: 1,
    platforms_id: 17,
    rel_platformAccounts_platform: { Id: 17, name: 'github', label: 'github' }
  },
  {
    Id: 102,
    platform: 'telegram_ru',
    account_label: 'Kira Telegram Ru',
    login: '@kira_auto',
    phone: '',
    email: '',
    password: 'phone number from related HH',
    clients_id: 1,
    platforms_id: 2,
    rel_platformAccounts_platform: { Id: 2, name: 'telegram', label: 'telegram_ru' }
  },
  {
    Id: 104,
    platform: 'telegram_en',
    account_label: 'Kira Telegram En',
    login: '@kira_auto_en',
    phone: '+79990002233',
    email: '',
    password: 'phone number from related HH',
    clients_id: 1,
    platforms_id: 4,
    rel_platformAccounts_platform: { Id: 4, name: 'telegram', label: 'telegram_en' }
  },
  {
    Id: 105,
    platform: 'phone',
    account_label: 'phone_en',
    login: '',
    phone: '+79990002233',
    email: '',
    password: 'not-a-telegram-account',
    clients_id: 1,
    platforms_id: 7,
    rel_platformAccounts_platform: { Id: 7, name: 'phone', label: 'phone_en' }
  },
  {
    Id: 201,
    platform: 'email_en',
    account_label: 'Latest Email En',
    login: 'latest@example.com',
    phone: '',
    email: 'latest@example.com',
    password: 'latest-mail-secret',
    clients_id: 10
  },
  {
    Id: 202,
    account_label: 'Latest LinkedIn older',
    login: 'latest.linkedin.one@example.com',
    phone: '',
    email: '',
    password: '',
    clients_id: 10,
    platforms_id: 16
  },
  {
    Id: 203,
    account_label: 'Latest LinkedIn newer',
    login: 'latest.linkedin.two@example.com',
    phone: '',
    email: '',
    password: '',
    clients_id: 10,
    platforms_id: 16
  },
  {
    Id: 204,
    account_label: 'Fake LinkedIn by name',
    login: 'fake-name-should-not-match@example.com',
    phone: '',
    email: '',
    password: '',
    clients_id: 10,
    rel_platformAccounts_platform: { Id: 99, name: 'linkedin', label: 'linkedin' }
  },
  {
    Id: 205,
    account_label: 'Ilyas LinkedIn',
    login: 'ilyas.linkedin@example.com',
    linkedin_url: 'https://linkedin.com/in/ilyas-provider',
    clients_id: 2,
    platforms_id: 16,
    rel_platformAccounts_platform: { Id: 16, name: 'linkedin', label: 'linkedin' }
  },
  {
    Id: 206,
    platform: 'github',
    account_label: 'Ilyas GitHub',
    login: 'https://github.com/ilyas-provider-client',
    clients_id: 2,
    platforms_id: 17,
    rel_platformAccounts_platform: { Id: 17, name: 'github', label: 'github' }
  },
  {
    Id: 207,
    platform: 'telegram_ru',
    account_label: 'Ilyas Telegram RU',
    login: '@ilyas_ru',
    clients_id: 2,
    platforms_id: 2,
    rel_platformAccounts_platform: { Id: 2, name: 'telegram', label: 'telegram_ru' }
  },
  {
    Id: 208,
    platform: 'telegram_en',
    account_label: 'Ilyas Telegram EN',
    nickname: '@ilyas_en',
    clients_id: 2,
    platforms_id: 4,
    rel_platformAccounts_platform: { Id: 4, name: 'telegram', label: 'telegram_en' }
  },
  {
    Id: 209,
    platform: 'hh_en',
    account_label: 'Ilyas HH En',
    email: 'ilyas.hh-en@example.com',
    password: 'ilyas-hh-en-secret',
    clients_id: 2,
    platforms_id: 10
  },
  {
    Id: 210,
    platform: 'hh_ru',
    account_label: 'Ilyas HH Ru',
    email: 'ilyas.hh-ru@example.com',
    password: 'ilyas-hh-ru-secret',
    clients_id: 2,
    platforms_id: 11
  },
  {
    Id: 211,
    platform: 'hh_ru',
    account_label: 'Provider Ru Visible HH Ru',
    email: 'provider.ru.hh-ru@example.com',
    password: 'provider-ru-visible-secret',
    clients_id: 6,
    platforms_id: 11
  },
  {
    Id: 212,
    platform: 'phone_en',
    account_label: 'Ilyas Phone En',
    phone: '+995 555 111 222',
    clients_id: 2,
    platforms_id: 28
  }
]

const mockPlatforms = [
  { Id: 1, label: 'hh_ru', name: 'hh' },
  { Id: 2, label: 'telegram_ru' },
  { Id: 4, label: 'telegram_en' },
  { Id: 7, label: 'phone_en', name: 'phone' },
  { Id: 3, label: 'email_en', name: 'email' },
  { Id: 16, label: 'linkedin', name: 'linkedin' },
  { Id: 17, label: 'github', name: 'github' }
]

const mockEnglishLevels = [
  { Id: 1, level: 'A1', rank: 1 },
  { Id: 2, level: 'A2', rank: 2 },
  { Id: 3, level: 'B1', rank: 3 },
  { Id: 4, level: 'B2', rank: 4 },
  { Id: 5, level: 'C1', rank: 5 }
]

const mockDolphinProfiles = [
  {
    Id: 301,
    locale: 'ru',
    dolphin_profile_id: '770032142',
    rel_dolphinProfiles_client: { Id: 1, client_name: 'Kira Test' },
    clients_id: 1
  },
  {
    Id: 302,
    locale: 'en',
    dolphin_profile_id: '770032143',
    rel_dolphinProfiles_client: { Id: 1, client_name: 'Kira Test' },
    clients_id: 1
  },
  {
    Id: 303,
    locale: 'en',
    dolphin_profile_id: '800760592',
    rel_dolphinProfiles_client: { Id: 2, client_name: 'Ð˜Ð»ÑŒÑÑ Ð¢Ð¾Ñ…Ñ‚Ð°Ñ€Ð°Ð½' },
    clients_id: 2
  },
  {
    Id: 304,
    locale: 'ru',
    dolphin_profile_id: '800760591',
    rel_dolphinProfiles_client: { Id: 2, client_name: 'Ð˜Ð»ÑŒÑÑ Ð¢Ð¾Ñ…Ñ‚Ð°Ñ€Ð°Ð½' },
    clients_id: 2
  },
  {
    Id: 305,
    locale: 'ru',
    dolphin_profile_id: '900000001',
    rel_dolphinProfiles_client: { Id: 3, client_name: 'Provider Hidden Client' },
    clients_id: 3
  }
]

const mockProviderResponses = [
  {
    Id: 401,
    clients_id: 2,
    client: { Id: 2, client_name: 'Ильяс Тохтаран' },
    record_key: 'Ilyas EN',
    respond_ru: false,
    respond_en: true,
    salary_expectations: 2500,
    comment: 'Ready for provider review.',
    Github: 'https://github.com/ilyas-provider',
    'Stack preferenses / possibilities': 'Data, Backend-heavy FullStack',
    'Blacklisted companies': 'Wrong response blacklist',
    hh_en_account: { Id: 301, account_label: 'Ilyas hh_en' },
    hh_ru_account: { Id: 302, account_label: 'Ilyas hh_ru' },
    linkedin_account: { Id: 303, account_label: 'Ilyas LinkedIn' },
    main_CV: 'https://drive.google.com/main-cv',
    additional_CV: 'https://drive.google.com/additional-cv'
  }
]

function createMockNocoClient() {
  const clients: Array<Record<string, any> & { Id: number }> = mockClients.map(record => ({ ...record }))
  const platformAccounts: Array<Record<string, any> & { Id: number }> = mockPlatformAccounts.map(record => ({ ...record }))
  const platforms: Array<Record<string, any> & { Id: number }> = mockPlatforms.map(record => ({ ...record }))
  const englishLevels: Array<Record<string, any> & { Id: number }> = mockEnglishLevels.map(record => ({ ...record }))
  const dolphinProfiles: Array<Record<string, any> & { Id: number }> = mockDolphinProfiles.map(record => ({ ...record }))
  const providerResponses: Array<Record<string, any> & { Id: number }> = mockProviderResponses.map(record => ({ ...record }))

  function nextId(records: Array<{ Id: number }>): number {
    return Math.max(0, ...records.map(record => Number(record.Id))) + 1
  }

  function syncClientRelations(record: Record<string, any>): void {
    if (record.english_levels_id === null) {
      record['English level'] = null
      return
    }
    const englishLevelId = Number(record.english_levels_id)
    if (Number.isFinite(englishLevelId) && englishLevelId > 0) {
      const englishLevel = englishLevels.find(level => Number(level.Id) === englishLevelId)
      record['English level'] = englishLevel ? { Id: englishLevel.Id, level: englishLevel.level } : null
    }
  }

  function syncPlatformRelation(record: Record<string, any>): void {
    const platformId = Number(record.platforms_id)
    if (Number.isFinite(platformId) && platformId > 0) {
      const platform = platforms.find(candidate => Number(candidate.Id) === platformId)
      record.rel_platformAccounts_platform = platform
        ? { Id: platform.Id, name: platform.name, label: platform.label }
        : undefined
      if (!record.platform && platform?.label) record.platform = platform.label
    }
  }

  return {
    async fetchTableMeta(tableId: string) {
      if (tableId !== 'mxza381054ldlza') return { columns: [] }
      return {
        columns: [
          {
            title: 'client_status',
            uidt: 'SingleSelect',
            colOptions: {
              options: [
                { id: 'spq21hjkwng2yxt', title: 'studying' },
                { id: 'sxi0rjsc39ffpt5', title: 'on en market' },
                { id: 's9wt2yvj4t47jbb', title: 'paused' }
              ]
            }
          }
        ]
      }
    },
    async fetchRecords(tableId: string) {
      if (tableId === 'mxza381054ldlza') return clients
      if (tableId === 'm8zej2vsv4iypl8') return platformAccounts
      if (tableId === 'mg3ovkendur1kpo') return platforms
      if (tableId === 'mpteejwqy2kvmvm') return englishLevels
      if (tableId === 'm4thvbutfyb15qz') return dolphinProfiles
      if (tableId === 'mr5q0wij94utk1q') return providerResponses
      return []
    },
    async createRecord(tableId: string, record: Record<string, any>) {
      const target: Array<Record<string, any> & { Id: number }> | null = tableId === 'm8zej2vsv4iypl8'
        ? platformAccounts
        : tableId === 'm4thvbutfyb15qz'
          ? dolphinProfiles
          : null
      if (!target) return {}
      const created: Record<string, any> & { Id: number } = {
        Id: nextId(target),
        ...record
      }
      if (tableId === 'm8zej2vsv4iypl8') syncPlatformRelation(created)
      if (tableId === 'm4thvbutfyb15qz') {
        const client = clients.find(candidate => Number(candidate.Id) === Number(created.clients_id))
        if (client) created.rel_dolphinProfiles_client = { Id: client.Id, client_name: client.client_name }
      }
      target.push(created)
      return created
    },
    async patchRecord(tableId: string, recordId: number, patch: Record<string, any>) {
      const records = tableId === 'mxza381054ldlza'
        ? clients
        : tableId === 'm8zej2vsv4iypl8'
          ? platformAccounts
          : []
      const record = records.find(candidate => Number(candidate.Id) === Number(recordId))
      if (!record) throw new Error(`Record ${recordId} not found`)
      Object.assign(record, patch)
      if (tableId === 'mxza381054ldlza') syncClientRelations(record)
      if (tableId === 'm8zej2vsv4iypl8') syncPlatformRelation(record)
      return record
    },
    async deleteRecord(tableId: string, recordId: number) {
      if (tableId !== 'm8zej2vsv4iypl8') return {}
      const index = platformAccounts.findIndex(record => Number(record.Id) === Number(recordId))
      if (index !== -1) platformAccounts.splice(index, 1)
      return { ok: true }
    }
  }
}

module.exports = {
  createMockNocoClient,
  mockClients,
  mockDolphinProfiles,
  mockEnglishLevels,
  mockProviderResponses,
  mockPlatformAccounts,
  mockPlatforms
}
