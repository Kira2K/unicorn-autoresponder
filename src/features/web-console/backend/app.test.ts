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
  buildLinkedInEmailByClientId,
  isLinkedInPlatformAccount,
  LINKEDIN_PLATFORM_ID,
  profileClientId,
  profileId
} = require('./repository.ts') as {
  buildLinkedInEmailByClientId(accounts: Array<Record<string, unknown> & { Id: number }>): Map<number, string>
  isLinkedInPlatformAccount(account: Record<string, unknown> & { Id: number }): boolean
  LINKEDIN_PLATFORM_ID: number
  profileClientId(profile: Record<string, unknown> & { Id: number }): number | null
  profileId(profile: Record<string, unknown> & { Id: number }): number | null
}
const { linkedStatusMatches } = require('./repository.ts') as {
  linkedStatusMatches(value: unknown, expectedLabel: string, options?: Array<Record<string, unknown>>): boolean
}

function createFixtureNocoClient() {
  const calls: string[] = []
  const clients = [
    {
      Id: 1,
      client_name: 'Client One',
      calendar_email: 'client@example.com',
      telegram_general_chat_id: '1001',
      rel_clients_primary_stack: { Id: 9, name: 'FRONTEND' },
      market: 'Ru',
      client_status: { Id: 1, title: 'studying' }
    },
    {
      Id: 10,
      client_name: 'Newest Client',
      calendar_email: 'newest@example.com',
      telegram_general_chat_id: '1003',
      rel_clients_primary_stack: { Id: 10, name: 'PYTHON' },
      market: 'En',
      client_status: 'on en market'
    },
    {
      Id: 3,
      client_name: 'Provider Match',
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
    }
  ]
  const platformAccounts = [
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
  const dolphinProfiles = [
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
      if (tableId === 'm4thvbutfyb15qz') return dolphinProfiles
      return []
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
  assert.deepEqual(resolveClientDolphinCredentials({ id: 28, calendarEmail: 'NPotokin@gmail.com' }), {
    username: 'npotokin@gmail.com',
    password: 'npotokin@gmail.com',
    sourceEmail: 'npotokin@gmail.com'
  })

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
  const linkedInMap = buildLinkedInEmailByClientId([
    { Id: 30, clients_id: 8, platforms_id: 16, login: 'second@example.com' },
    { Id: 20, clients_id: 8, platforms_id: 16, login: 'first@example.com' },
    { Id: 10, clients_id: 8, rel_platformAccounts_platform: { Id: 99, name: 'linkedin' }, login: 'wrong@example.com' },
    { Id: 40, clients_id: 9, platforms_id: 16, login: '' }
  ])
  assert.equal(linkedInMap.get(8), 'first@example.com, second@example.com')
  assert.equal(linkedInMap.has(9), false)

  const noco = createFixtureNocoClient()
  const repository = createWebConsoleRepository({ nocoClient: noco })
  assert.deepEqual(await buildProfileAccessInput(repository, 1), {
    profileIds: [111111111, 111111112],
    knownProfileIds: [111111111, 101010101, 444444444, 111111112, 333333333]
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
  const app = createWebConsoleApp({
    repository,
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
    }
  })
  const server = await listen(app)

  try {
    let result = await request(server.baseUrl, '/api/auth/me')
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/client/me')
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/admin/latest-client')
    assert.equal(result.response.status, 401)
    result = await request(server.baseUrl, '/api/provider/clients')
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
    assert.equal(result.response.status, 200)
    assert.equal(result.body.client.clientName, 'Client One')
    assert.equal(result.body.linkedInEmail, 'client-one.linkedin@example.com')
    assert.equal(result.body.platformAccounts[0].password, '***')

    result = await request(server.baseUrl, '/api/admin/latest-client', {}, clientLogin.cookie)
    assert.equal(result.response.status, 403)
    result = await request(server.baseUrl, '/api/provider/clients', {}, clientLogin.cookie)
    assert.equal(result.response.status, 403)

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', { method: 'POST' }, clientLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.username, 'client@example.com')
    assert.equal(result.body.password, 'client@example.com')
    assert.equal(result.body.sourceEmail, 'client@example.com')
    assert.equal(result.body.targetClientName, 'Client One')
    assert.deepEqual(result.body.profileIds, [111111111, 111111112])
    assert.deepEqual(leaseCalls[0], {
      ownerKey: 'client:1',
      ownerLabel: 'Client One',
      role: 'client',
      targetClientId: 1,
      targetClientName: 'Client One',
      username: 'client@example.com',
      password: 'client@example.com',
      sourceEmail: 'client@example.com',
      profileIds: [111111111, 111111112],
      knownProfileIds: [111111111, 101010101, 444444444, 111111112, 333333333]
    })

    result = await request(server.baseUrl, '/api/auth/logout', { method: 'POST' }, clientLogin.cookie)
    assert.equal(result.response.status, 200)
    result = await request(server.baseUrl, '/api/client/me', {}, clientLogin.cookie)
    assert.equal(result.response.status, 401)

    const noProfileLogin = await request(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-profile@example.com', password: '1234' })
    })
    assert.equal(noProfileLogin.response.status, 200)
    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', { method: 'POST' }, noProfileLogin.cookie)
    assert.equal(result.response.status, 404)
    assert.equal(result.body.error, 'missing_dolphin_profiles')
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
    assert.equal(result.body.providerDolphinEmail, 'kitsunewebdeveloper@gmail.com')
    assert.deepEqual(result.body.clients.map((client: any) => client.clientName), ['Provider Match', 'Newest Client'])
    assert.equal(result.body.clients.some((client: any) => client.clientName === 'Unknown Raw String Should Not Match'), false)
    assert.equal(result.body.clients[0].linkedInEmail, 'provider-match.linkedin@example.com')
    assert.equal(result.body.clients[1].linkedInEmail, 'newest.linkedin.one@example.com, newest.linkedin.two@example.com')
    assert.deepEqual(Object.keys(result.body.clients[0]).sort(), ['clientName', 'id', 'linkedInEmail', 'primaryStack'])
    assert.equal(JSON.stringify(result.body).includes('clientStatus'), false)

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 3, targetClientName: 'Provider Match' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.username, 'kitsunewebdeveloper@gmail.com')
    assert.equal(result.body.password, 'kitsunewebdeveloper@gmail.com')
    assert.deepEqual(result.body.profileIds, [333333333])
    assert.equal(leaseCalls.at(-1).targetClientName, result.body.targetClientName)
    assert.equal(leaseCalls.at(-1).targetClientId, 3)
    assert.deepEqual(leaseCalls.at(-1).profileIds, [333333333])
    assert.notEqual(leaseCalls.at(-1).targetClientName, 'Newest Client')
    assert.notEqual(leaseCalls.at(-1).targetClientName, 'Unknown Raw String Should Not Match')
    assert.equal(result.body.targetClientName, 'Provider Match')

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientName: 'Unknown Raw String Should Not Match' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 400)
    assert.equal(result.body.error, 'missing_target_client')
    assert.deepEqual(leaseCalls.at(-1).profileIds, [333333333])

    result = await request(server.baseUrl, '/api/dolphin/lease/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetClientId: 4, targetClientName: 'Unknown Raw String Should Not Match' })
    }, providerLogin.cookie)
    assert.equal(result.response.status, 404)
    assert.equal(result.body.error, 'target_client_not_found')
    assert.deepEqual(leaseCalls.at(-1).profileIds, [333333333])

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
    result = await request(server.baseUrl, '/api/provider/clients', {}, adminLogin.cookie)
    assert.equal(result.response.status, 403)

    result = await request(server.baseUrl, '/api/admin/hh-responses/start', { method: 'POST' }, adminLogin.cookie)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.dryRun, true)
    assert.equal(result.body.plannedCommand.env.ORCHESTRATOR_CLIENT_NAMES, 'Newest Client')

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
