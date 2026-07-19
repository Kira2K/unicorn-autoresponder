const assert = require('node:assert/strict')
const http = require('node:http')
const {
  configuredTelegramService,
  constantTimeTokenEquals,
  createRemoteTelegramService,
  createTelegramGatewayController,
  parseAccountRefs,
  sanitizeGatewayValue,
  validatedRemoteConfiguration
} = require('./telegram-gateway.ts') as any
const { ADMIN_EMAIL, ADMIN_PASSWORD, createWebConsoleApp } = require('./app.ts') as any

const TOKEN = 'test-render-tdlib-gateway-token-1234567890'

function fakeTelegramService(overrides: Record<string, any> = {}) {
  return {
    async connect(clientId: number, input: any) { return { clientId, accountId: input.accountId, status: 'active', dbPath: '/render/private/db' } },
    async status(clientId: number, accountId: number) { return { clientId, accountId, status: 'active', dbPath: '/render/private/db', eventLog: 'private' } },
    async folders() { return { folders: [{ id: 'main', title: 'All chats', type: 'main' }] } },
    async dialogs(clientId: number, input: any) { return { clientId, accountId: input.accountId, dialogs: [{ id: '10', title: 'Safe dialog' }], dbPath: '/render/private/db' } },
    async scanAdminDialogs(clientId: number, input: any) { return { clientId, accountId: input.accountId, outcome: 'complete', dialogs: [] } },
    async messages(clientId: number, input: any) { return { clientId, accountId: input.accountId, messages: [{ id: '20', chatId: input.chatId, text: 'safe message' }] } },
    async send(clientId: number, input: any) { return { clientId, accountId: input.accountId, message: { id: '30', text: input.text } } },
    async listAdminSenders() {
      return {
        senders: [
          { clientId: 102, clientName: 'Test', accountId: 473, accountLabel: 'telegram_en', platform: 'telegram_en', market: 'en', stack: 'PYTHON', status: 'active', phone: '+100000000', dbPath: '/render/test' },
          { clientId: 93, clientName: 'Other', accountId: 399, accountLabel: 'telegram_ru', platform: 'telegram_ru', market: 'ru', stack: 'JAVA', status: 'active', phone: '+200000000', dbPath: '/render/other' }
        ]
      }
    },
    async sendToUsername(clientId: number, input: any) { return { clientId, accountId: input.accountId, attachments: input.attachments, messages: [] } },
    async renameContact(clientId: number, input: any) { return { clientId, accountId: input.accountId, dialog: { id: input.chatId, title: input.firstName } } },
    async reauth(clientId: number, accountId: number) { return { clientId, accountId, status: 'needs_reauth', dbPath: '/render/private/db' } },
    async disconnect(clientId: number, accountId: number) { return { clientId, accountId, status: 'disconnected', dbPath: '/render/private/db' } },
    ...overrides
  }
}

function gatewayEnv(extra: Record<string, string> = {}) {
  return {
    WEB_CONSOLE_TDLIB_GATEWAY_TOKEN: TOKEN,
    WEB_CONSOLE_TDLIB_GATEWAY_ACCOUNT_REFS: '102:473',
    WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_WRITES: 'false',
    WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_AUTH_MUTATIONS: 'false',
    WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_DISCONNECT: 'false',
    ...extra
  }
}

async function listen(app: any): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not resolve test server address.')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()))
  }
}

async function request(baseUrl: string, path: string, options: any = {}) {
  const response = await fetch(`${baseUrl}${path}`, options)
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
    cookie: response.headers.get('set-cookie') || ''
  }
}

async function run(): Promise<void> {
  assert.deepEqual([...parseAccountRefs('102:473, 93:399')], ['102:473', '93:399'])
  assert.throws(() => parseAccountRefs('102:473,invalid'), /gateway/i)
  assert.equal(constantTimeTokenEquals(TOKEN, TOKEN), true)
  assert.equal(constantTimeTokenEquals(TOKEN, `${TOKEN}x`), false)
  assert.deepEqual(
    sanitizeGatewayValue({ dbPath: '/private', phone: '+1', nested: { proxy: { host: 'secret' }, title: 'safe' } }),
    { nested: { title: 'safe' } }
  )

  const events: any[] = []
  const service = fakeTelegramService()
  const controller = createTelegramGatewayController({ service, env: gatewayEnv(), logger: (event: any) => events.push(event) })
  assert.equal(controller.authenticate('').statusCode, 401)
  assert.equal(controller.authenticate('Bearer wrong').statusCode, 401)
  assert.deepEqual(controller.authenticate(`Bearer ${TOKEN}`), { ok: true })
  assert.deepEqual(controller.health(), {
    ok: true,
    service: 'telegram-gateway',
    allowedAccounts: 1,
    capabilities: { reads: true, writes: false, authMutations: false, disconnect: false }
  })

  const catalog = await controller.execute({ operation: 'list_admin_senders' }, { requestId: 'catalog-test' })
  assert.equal(catalog.senders.length, 1)
  assert.equal(catalog.senders[0].clientId, 102)
  assert.equal('phone' in catalog.senders[0], false)
  assert.equal('dbPath' in catalog.senders[0], false)

  const dialogs = await controller.execute({ operation: 'dialogs', clientId: 102, accountId: 473, input: { list: 'main' } })
  assert.equal(dialogs.dialogs[0].title, 'Safe dialog')
  assert.equal('dbPath' in dialogs, false)
  await assert.rejects(
    controller.execute({ operation: 'dialogs', clientId: 93, accountId: 399 }),
    (error: any) => error.code === 'telegram_gateway_account_forbidden'
  )
  await assert.rejects(
    controller.execute({ operation: 'send', clientId: 102, accountId: 473, input: { chatId: '1', text: 'blocked' } }),
    (error: any) => error.code === 'telegram_gateway_operation_forbidden'
  )
  await assert.rejects(
    controller.execute({ operation: 'connect', clientId: 102, accountId: 473, input: { code: 'secret' } }),
    (error: any) => error.code === 'telegram_gateway_operation_forbidden'
  )
  await assert.rejects(
    controller.execute({ operation: 'disconnect', clientId: 102, accountId: 473 }),
    (error: any) => error.code === 'telegram_gateway_operation_forbidden'
  )

  let attachmentInput: any
  let sendAttempts = 0
  const writableController = createTelegramGatewayController({
    service: fakeTelegramService({
      async sendToUsername(_clientId: number, input: any) {
        sendAttempts += 1
        attachmentInput = input
        throw Object.assign(new Error('send failed with private details'), { code: 'telegram_file_send_failed' })
      }
    }),
    env: gatewayEnv({ WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_WRITES: 'true' }),
    logger() {}
  })
  await assert.rejects(
    writableController.execute({
      operation: 'send_to_username',
      clientId: 102,
      accountId: 473,
      input: { username: '@tester', text: '', attachments: [{ fileName: 'proof.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERg==' }] }
    }),
    (error: any) => error.code === 'telegram_file_send_failed'
  )
  assert.equal(sendAttempts, 1)
  assert.equal(attachmentInput.attachments[0].fileName, 'proof.pdf')
  assert.equal(attachmentInput.allowWrite, true)

  let readStarted = false
  const cancellableController = createTelegramGatewayController({
    service: fakeTelegramService({
      async dialogs() {
        readStarted = true
        return await new Promise(() => {})
      }
    }),
    env: gatewayEnv(),
    logger() {}
  })
  const abortController = new AbortController()
  const cancelled = cancellableController.execute(
    { operation: 'dialogs', clientId: 102, accountId: 473 },
    { signal: abortController.signal }
  )
  while (!readStarted) await new Promise(resolve => setTimeout(resolve, 1))
  abortController.abort()
  await assert.rejects(cancelled, (error: any) => error.code === 'telegram_gateway_cancelled')

  assert.deepEqual(validatedRemoteConfiguration({ WEB_CONSOLE_TELEGRAM_MODE: 'local' }), { mode: 'local' })
  assert.throws(
    () => validatedRemoteConfiguration({ WEB_CONSOLE_TELEGRAM_MODE: 'remote', WEB_CONSOLE_TDLIB_GATEWAY_URL: 'https://example.com' }),
    /configured/i
  )
  assert.throws(
    () => validatedRemoteConfiguration({ WEB_CONSOLE_TELEGRAM_MODE: 'remote', WEB_CONSOLE_TDLIB_GATEWAY_URL: 'http://example.com', WEB_CONSOLE_TDLIB_GATEWAY_TOKEN: TOKEN }),
    /HTTPS/i
  )

  const forwarded: any[] = []
  const remote = createRemoteTelegramService({
    baseUrl: 'https://render.example',
    token: TOKEN,
    fetchImpl: async (_url: string, options: any) => {
      forwarded.push(JSON.parse(options.body))
      return new Response(JSON.stringify({ ok: true, result: { accountId: 473, dialogs: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  })
  await remote.dialogs(102, { accountId: 473, list: 'archive', limit: 50 })
  assert.deepEqual(forwarded[0], {
    operation: 'dialogs',
    clientId: 102,
    accountId: 473,
    input: { accountId: 473, list: 'archive', limit: 50 }
  })

  let remoteSendAttempts = 0
  const failingRemote = createRemoteTelegramService({
    baseUrl: 'https://render.example',
    token: TOKEN,
    fetchImpl: async () => {
      remoteSendAttempts += 1
      return new Response(JSON.stringify({ error: 'telegram_file_send_failed', message: 'safe' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  })
  await assert.rejects(
    failingRemote.sendToUsername(102, { accountId: 473, username: '@tester', text: 'once' }),
    (error: any) => error.code === 'telegram_file_send_failed'
  )
  assert.equal(remoteSendAttempts, 1)

  const unauthorizedRemote = createRemoteTelegramService({
    baseUrl: 'https://render.example',
    token: TOKEN,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  })
  await assert.rejects(
    unauthorizedRemote.dialogs(102, { accountId: 473 }),
    (error: any) => error.code === 'telegram_gateway_unavailable' && error.statusCode === 502
  )

  const timeoutRemote = createRemoteTelegramService({
    baseUrl: 'https://render.example',
    token: TOKEN,
    timeoutMs: 5,
    fetchImpl: async (_url: string, options: any) => await new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    })
  })
  await assert.rejects(
    timeoutRemote.dialogs(102, { accountId: 473 }),
    (error: any) => error.code === 'telegram_gateway_timeout'
  )

  assert.equal(configuredTelegramService(service, { env: { WEB_CONSOLE_TELEGRAM_MODE: 'local' } }), service)

  const sourceApp = createWebConsoleApp({
    useMockData: true,
    telegramGatewayService: service,
    telegramGatewayEnv: gatewayEnv(),
    telegramGatewayLogger() {}
  })
  const sourceServer = await listen(sourceApp)
  const localApp = createWebConsoleApp({
    useMockData: true,
    telegramGatewayEnv: {
      WEB_CONSOLE_TELEGRAM_MODE: 'remote',
      WEB_CONSOLE_TDLIB_GATEWAY_URL: sourceServer.baseUrl,
      WEB_CONSOLE_TDLIB_GATEWAY_TOKEN: TOKEN,
      WEB_CONSOLE_TDLIB_GATEWAY_TIMEOUT_MS: '5000'
    },
    telegramGatewayFetch: fetch,
    telegramGatewayLogger() {}
  })
  const localServer = await listen(localApp)
  try {
    const unauthenticatedHealth = await request(sourceServer.baseUrl, '/api/internal/telegram-gateway/health')
    assert.equal(unauthenticatedHealth.status, 401)
    const health = await request(sourceServer.baseUrl, '/api/internal/telegram-gateway/health', {
      headers: { Authorization: `Bearer ${TOKEN}` }
    })
    assert.equal(health.status, 200)
    assert.equal(health.body.allowedAccounts, 1)

    const login = await request(localServer.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    })
    assert.equal(login.status, 200)
    const catalogResponse = await request(localServer.baseUrl, '/api/admin/telegram/senders', {
      headers: { Cookie: login.cookie.split(';')[0] }
    })
    assert.equal(catalogResponse.status, 200)
    assert.equal(catalogResponse.body.senders.length, 1)
    assert.equal(catalogResponse.body.senders[0].accountId, 473)
    assert.equal('dbPath' in catalogResponse.body.senders[0], false)
    assert.equal('phone' in catalogResponse.body.senders[0], false)
  } finally {
    await localServer.close()
    await sourceServer.close()
  }

  assert.equal(events.some(event => JSON.stringify(event).includes('/render/')), false)
  assert.equal(events.some(event => JSON.stringify(event).includes('+100000000')), false)
  console.log('telegram gateway tests passed')
}

run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
