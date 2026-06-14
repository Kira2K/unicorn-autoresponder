const mockClients = [
  {
    Id: 1,
    client_name: 'Kira Test',
    calendar_email: 'client@example.com',
    telegram_general_chat_id: '5216637594',
    rel_clients_primary_stack: { Id: 10, name: 'FRONTEND' },
    market: 'Ru',
    client_status: { Id: 1, title: 'studying' }
  },
  {
    Id: 10,
    client_name: 'Latest Admin Client',
    calendar_email: 'latest@example.com',
    telegram_general_chat_id: '-100200300',
    rel_clients_primary_stack: { Id: 11, name: 'PYTHON' },
    market: 'En',
    client_status: 'on en market'
  },
  {
    Id: 2,
    client_name: 'Ильяс Тохтаран',
    calendar_email: 'provider-visible@example.com',
    telegram_general_chat_id: '-100200301',
    rel_clients_primary_stack: { Id: 12, name: 'DATA' },
    market: 'En',
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
    phone: '',
    email: '',
    password: '',
    rel_platformAccounts_client: { Id: 1 },
    rel_platformAccounts_platform: { Id: 16, name: 'linkedin', label: 'linkedin' }
  },
  {
    Id: 102,
    platform: 'telegram_ru',
    account_label: 'Kira Telegram Ru',
    login: '@kira_auto',
    phone: '',
    email: '',
    password: 'phone number from related HH',
    clients_id: 1
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
  }
]

const mockPlatforms = [
  { Id: 1, label: 'hh_ru', name: 'hh' },
  { Id: 2, label: 'telegram_ru', name: 'telegram' },
  { Id: 3, label: 'email_en', name: 'email' },
  { Id: 16, label: 'linkedin', name: 'linkedin' }
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

function createMockNocoClient() {
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
      if (tableId === 'mxza381054ldlza') return mockClients
      if (tableId === 'm8zej2vsv4iypl8') return mockPlatformAccounts
      if (tableId === 'mg3ovkendur1kpo') return mockPlatforms
      if (tableId === 'm4thvbutfyb15qz') return mockDolphinProfiles
      return []
    }
  }
}

module.exports = {
  createMockNocoClient,
  mockClients,
  mockDolphinProfiles,
  mockPlatformAccounts,
  mockPlatforms
}
