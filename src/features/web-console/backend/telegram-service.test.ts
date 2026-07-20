const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createFakeTdlibAdapter } = require('../../../integrations/telegram/tdlib-client.ts') as {
  createFakeTdlibAdapter(): any
}
const { createTelegramService } = require('./telegram-service.ts') as {
  createTelegramService(options: any): any
}

async function runTests(): Promise<void> {
  const patches: Array<Record<string, unknown>> = []
  const account = {
    id: 102,
    clientId: 1,
    platform: 'telegram_ru',
    platformId: 2,
    isTelegramAccount: true,
    accountLabel: 'Kira Telegram',
    login: '@kira',
    phone: '+79990001122',
    password: 'cloud-pass',
    telegramSessionStatus: '',
    telegramTdlibDbPath: '',
    telegramLastActive: '',
    telegramEventLog: ''
  }
  const repository = {
    async getClientById(clientId: number) {
      assert.equal(clientId, 1)
      return { id: 1, clientName: 'Kira', market: 'Ru', primaryStack: 'Frontend' }
    },
    async getTelegramPlatformAccountsForClient(clientId: number) {
      assert.equal(clientId, 1)
      return [account]
    },
    async updateTelegramPlatformAccount(_clientId: number, _accountId: number, patch: Record<string, unknown>) {
      patches.push(patch)
      Object.assign(account, {
        telegramSessionStatus: patch.telegram_session_status ?? account.telegramSessionStatus,
        telegramTdlibDbPath: patch.telegram_tdlib_db_path ?? account.telegramTdlibDbPath,
        telegramLastActive: patch.telegram_last_active ?? account.telegramLastActive,
        telegramEventLog: patch.telegram_event_log ?? account.telegramEventLog
      })
      return account
    },
    async getDolphinProfilesForClient() {
      return []
    },
    async listActiveTelegramSenders() {
      return [{
        clientId: 1,
        clientName: 'Kira',
        market: 'Ru',
        stack: 'Frontend',
        accountId: account.id,
        accountLabel: account.accountLabel,
        platform: account.platform,
        phone: account.phone,
        status: account.telegramSessionStatus,
        dbPath: account.telegramTdlibDbPath
      }]
    }
  }
  const service = createTelegramService({
    repository,
    adapter: createFakeTdlibAdapter(),
    proxyResolver: async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 })
  })

  let result = await service.connect(1, { accountId: 102 })
  assert.equal(result.status, 'needs_code')
  assert.match(result.dbPath, /storage[\\/]tdlib[\\/]1[\\/]102/)

  result = await service.connect(1, { accountId: 102, code: '12345' })
  assert.equal(result.status, 'active')
  assert.equal(patches.some(patch => patch.telegram_session_status === 'active'), true)

  const dialogs = await service.dialogs(1, 102)
  assert.equal(dialogs.dialogs.some((dialog: any) => dialog.id === 'reporting-chat'), true)

  const folders = await service.folders(1, 102)
  assert.equal(folders.folders.some((folder: any) => folder.id === 'archive'), true)

  const archivedDialogs = await service.dialogs(1, { accountId: 102, list: 'archive' })
  assert.equal(archivedDialogs.dialogs.some((dialog: any) => dialog.id === 'archived-chat'), true)

  const searchedDialogs = await service.dialogs(1, { accountId: 102, query: 'client' })
  assert.equal(searchedDialogs.dialogs.some((dialog: any) => dialog.id === 'client-chat'), true)
  assert.equal(searchedDialogs.dialogs.find((dialog: any) => dialog.id === 'client-chat')?.username, '@client_partner')

  const mixedDialogs = [
    { id: 'private-human', title: 'Private human', isPrivate: true, lastMessageAt: new Date().toISOString() },
    { id: 'private-bot', title: 'Private bot', isPrivate: true, lastMessageAt: new Date().toISOString() },
    { id: 'basic-group', title: 'Basic group', isPrivate: false, lastMessageAt: new Date().toISOString() },
    { id: 'supergroup', title: 'Supergroup', isPrivate: false, lastMessageAt: new Date().toISOString() },
    { id: 'channel', title: 'Channel', isPrivate: false, lastMessageAt: new Date().toISOString() },
    { id: 'secret', title: 'Secret chat', isPrivate: false, lastMessageAt: new Date().toISOString() },
    { id: 'unknown', title: 'Unknown chat', lastMessageAt: new Date().toISOString() }
  ]
  const mixedAdapter = {
    ...createFakeTdlibAdapter(),
    async dialogs() { return mixedDialogs },
    async scanDialogs() {
      return {
        dialogs: mixedDialogs,
        outcome: 'complete',
        stage: 'complete',
        discoveredCount: mixedDialogs.length,
        matchedCount: mixedDialogs.length,
        durationMs: 1,
        lists: {
          main: { complete: true, discovered: 6 },
          archive: { complete: true, discovered: 1 }
        }
      }
    }
  }
  const mixedService = createTelegramService({
    repository,
    adapter: mixedAdapter,
    proxyResolver: async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 })
  })
  const compatibleMixedDialogs = await mixedService.dialogs(1, { accountId: 102 })
  assert.deepEqual(compatibleMixedDialogs.dialogs.map((dialog: any) => dialog.id), mixedDialogs.map(dialog => dialog.id))
  const privateSnapshot = await mixedService.dialogs(1, { accountId: 102, privateOnly: true })
  assert.deepEqual(privateSnapshot.dialogs.map((dialog: any) => dialog.id), ['private-human', 'private-bot'])
  const privateScan = await mixedService.scanAdminDialogs(1, { accountId: 102, days: 1 })
  assert.deepEqual(privateScan.rows.map((row: any) => row.chatId), ['private-human', 'private-bot'])
  assert.equal(privateScan.rows.every((row: any) => row.isPrivate === true), true)
  assert.equal(privateScan.accountResult.matchedCount, 2)
  assert.equal(privateScan.accountResult.discoveredCount, mixedDialogs.length)

  await assert.rejects(
    () => service.send(1, { accountId: 102, chatId: 'reporting-chat', text: 'TDLib smoke test' }),
    (error: any) => {
      assert.equal(error.code, 'telegram_readonly')
      return true
    }
  )

  const sent = await service.send(1, { accountId: 102, chatId: 'reporting-chat', text: 'TDLib smoke test', allowWrite: true })
  assert.equal(sent.message.text, 'TDLib smoke test')

  const adminSenders = await service.listAdminSenders()
  assert.equal(adminSenders.senders.length, 1)

  const patchesBeforeScan = patches.length
  const scanned = await service.scanAdminDialogs(1, { accountId: 102, days: 1 })
  assert.equal(scanned.accountResult.outcome, 'complete')
  assert.equal(scanned.accountResult.lists.main.complete, true)
  assert.equal(scanned.accountResult.lists.archive.complete, true)
  assert.deepEqual(scanned.rows.map((row: any) => row.chatId), ['client-chat', 'archived-chat'])
  assert.equal(scanned.rows.every((row: any) => row.isPrivate === true), true)
  assert.equal(scanned.accountResult.matchedCount, 2)
  assert.equal(scanned.rows.every((row: any) => row.clientId === 1 && row.accountId === 102), true)
  assert.equal(patches.length, patchesBeforeScan, 'read-only admin scanning must not update stored account status')

  const adminSent = await service.sendToUsername(1, {
    accountId: 102,
    username: '@client_partner',
    text: 'Admin feature smoke test',
    allowWrite: true,
    attachments: [{ fileName: 'feature.md', mimeType: 'text/markdown', dataBase64: Buffer.from('# Feature').toString('base64') }]
  })
  assert.equal(adminSent.messages.length, 2)
  const adminEvents = JSON.parse(account.telegramEventLog)
  const adminEvent = adminEvents.find((event: any) => event.event === 'admin_message_sent')
  assert.equal(adminEvent.details.username, '@client_partner')
  assert.equal(adminEvent.details.attachmentCount, 1)
  assert.equal(adminEvent.details.attachmentNames[0], 'feature.md')
  assert.equal(adminEvent.details.messageCount, 2)

  await assert.rejects(
    () => service.sendToUsername(1, { accountId: 102, username: 'client_partner', text: 'bad', allowWrite: true }),
    (error: any) => {
      assert.equal(error.code, 'telegram_invalid_username')
      return true
    }
  )

  const messages = await service.messages(1, { accountId: 102, chatId: 'reporting-chat' })
  assert.equal(messages.messages.some((message: any) => message.text === 'TDLib smoke test'), true)

  const renamed = await service.renameContact(1, { accountId: 102, chatId: 'client-chat', firstName: 'Safe', lastName: 'Lead' })
  assert.equal(renamed.dialog.title, 'Safe Lead')

  result = await service.disconnect(1, 102)
  assert.equal(result.status, 'needs_reauth')

  const noProxyService = createTelegramService({
    repository,
    adapter: createFakeTdlibAdapter(),
    proxyResolver: async () => null
  })
  result = await noProxyService.connect(1, { accountId: 102, code: '12345' })
  assert.equal(result.status, 'proxy_missing')

  const phoneOnlyAccount = {
    ...account,
    id: 103,
    platform: 'phone_en',
    accountLabel: 'Kira phone_en',
    platformId: 7,
    isTelegramAccount: false,
    phone: '',
    foreignNumber: '+995500000004',
    telegramSessionStatus: '',
    telegramTdlibDbPath: '',
    telegramLastActive: '',
    telegramEventLog: ''
  }
  const phoneOnlyRepository = {
    ...repository,
    async getTelegramPlatformAccountsForClient(clientId: number) {
      assert.equal(clientId, 1)
      return [phoneOnlyAccount]
    },
    async updateTelegramPlatformAccount(_clientId: number, _accountId: number, patch: Record<string, unknown>) {
      Object.assign(phoneOnlyAccount, {
        telegramSessionStatus: patch.telegram_session_status ?? phoneOnlyAccount.telegramSessionStatus,
        telegramTdlibDbPath: patch.telegram_tdlib_db_path ?? phoneOnlyAccount.telegramTdlibDbPath,
        telegramLastActive: patch.telegram_last_active ?? phoneOnlyAccount.telegramLastActive,
        telegramEventLog: patch.telegram_event_log ?? phoneOnlyAccount.telegramEventLog
      })
      return phoneOnlyAccount
    }
  }
  const phoneOnlyService = createTelegramService({
    repository: phoneOnlyRepository,
    adapter: createFakeTdlibAdapter(),
    proxyResolver: async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 })
  })
  await assert.rejects(
    () => phoneOnlyService.connect(1, { accountId: 103 }),
    (error: any) => {
      assert.equal(error.code, 'telegram_account_not_found')
      return true
    }
  )

  const multiAccounts = [
    {
      ...account,
      id: 201,
      accountLabel: 'Kira Telegram Ru',
      phone: '+79990001111',
      telegramSessionStatus: '',
      telegramTdlibDbPath: '',
      telegramLastActive: '',
      telegramEventLog: ''
    },
    {
      ...account,
      id: 202,
      accountLabel: 'Kira Telegram En',
      phone: '+79990002222',
      telegramSessionStatus: '',
      telegramTdlibDbPath: '',
      telegramLastActive: '',
      telegramEventLog: ''
    }
  ]
  const multiRepository = {
    ...repository,
    async getTelegramPlatformAccountsForClient(clientId: number) {
      assert.equal(clientId, 1)
      return multiAccounts
    },
    async updateTelegramPlatformAccount(_clientId: number, accountId: number, patch: Record<string, unknown>) {
      const target = multiAccounts.find(candidate => Number(candidate.id) === Number(accountId))
      if (!target) throw new Error(`Missing Telegram account ${accountId}`)
      Object.assign(target, {
        telegramSessionStatus: patch.telegram_session_status ?? target.telegramSessionStatus,
        telegramTdlibDbPath: patch.telegram_tdlib_db_path ?? target.telegramTdlibDbPath,
        telegramLastActive: patch.telegram_last_active ?? target.telegramLastActive,
        telegramEventLog: patch.telegram_event_log ?? target.telegramEventLog
      })
      return target
    }
  }
  const multiService = createTelegramService({
    repository: multiRepository,
    adapter: createFakeTdlibAdapter(),
    proxyResolver: async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 })
  })
  const firstConnected = await multiService.connect(1, { accountId: 201, code: '12345' })
  const secondNeedsCode = await multiService.connect(1, { accountId: 202 })
  assert.equal(firstConnected.status, 'active')
  assert.equal(secondNeedsCode.status, 'needs_code')
  assert.match(multiAccounts[0].telegramTdlibDbPath, /storage[\\/]tdlib[\\/]1[\\/]201/)
  assert.match(multiAccounts[1].telegramTdlibDbPath, /storage[\\/]tdlib[\\/]1[\\/]202/)
  assert.notEqual(multiAccounts[0].telegramTdlibDbPath, multiAccounts[1].telegramTdlibDbPath)
  assert.equal(multiAccounts[0].telegramSessionStatus, 'active')
  assert.equal(multiAccounts[1].telegramSessionStatus, 'needs_code')

  const scanRoots = Array.from({ length: 4 }, () => fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-service-scan-')))
  const scanAccounts = scanRoots.map((dbPath, index) => ({
    ...account,
    id: 301 + index,
    accountLabel: `Scan ${index + 1}`,
    telegramSessionStatus: 'active',
    telegramTdlibDbPath: dbPath
  }))
  let activeScans = 0
  let maxActiveScans = 0
  let releaseScans!: () => void
  const scanGate = new Promise<void>(resolve => { releaseScans = resolve })
  const scanAdapter = {
    ...createFakeTdlibAdapter(),
    async scanDialogs() {
      activeScans += 1
      maxActiveScans = Math.max(maxActiveScans, activeScans)
      await scanGate
      activeScans -= 1
      return {
        dialogs: [], outcome: 'complete', stage: 'complete', discoveredCount: 0, matchedCount: 0, durationMs: 1,
        lists: { main: { complete: true, discovered: 0 }, archive: { complete: true, discovered: 0 } }
      }
    }
  }
  const scanService = createTelegramService({
    repository: {
      ...repository,
      async getTelegramPlatformAccountsForClient() { return scanAccounts },
      async getClientById() { return { id: 1, clientName: 'Concurrency', market: 'En', primaryStack: 'Backend' } }
    },
    adapter: scanAdapter,
    proxyResolver: async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 })
  })
  try {
    const scans = scanAccounts.map(candidate => scanService.scanAdminDialogs(1, { accountId: candidate.id, days: 1 }))
    const deadline = Date.now() + 1000
    while (maxActiveScans < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(maxActiveScans, 3, 'exhaustive scans must be limited to three globally per service')
    releaseScans()
    const results = await Promise.all(scans)
    assert.equal(results.every((item: any) => item.accountResult.outcome === 'complete'), true)
  } finally {
    releaseScans()
    for (const scanRoot of scanRoots) fs.rmSync(scanRoot, { recursive: true, force: true })
  }

  const failedScanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-service-scan-failure-'))
  try {
    const failedAccount = { ...account, id: 401, telegramSessionStatus: 'active', telegramTdlibDbPath: failedScanRoot }
    const failedService = createTelegramService({
      repository: {
        ...repository,
        async getTelegramPlatformAccountsForClient() { return [failedAccount] },
        async getClientById() { return { id: 1, clientName: 'Failure' } }
      },
      adapter: {
        ...createFakeTdlibAdapter(),
        async scanDialogs() { throw new Error('secret proxy host and database path') }
      },
      proxyResolver: async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 })
    })
    const failure = await failedService.scanAdminDialogs(1, { accountId: 401, days: 1 })
    assert.equal(failure.accountResult.outcome, 'failed')
    assert.equal(failure.accountResult.error.code, 'telegram_proxy_unavailable')
    assert.equal(String(failure.accountResult.error.message).includes('secret'), false)

    const resolverFailureService = createTelegramService({
      repository: {
        ...repository,
        async getTelegramPlatformAccountsForClient() { return [failedAccount] },
        async getClientById() { return { id: 1, clientName: 'Resolver failure' } }
      },
      adapter: createFakeTdlibAdapter(),
      proxyResolver: async () => { throw new Error('external profile lookup failed') }
    })
    const resolverFailure = await resolverFailureService.scanAdminDialogs(1, { accountId: 401, days: 1 })
    assert.equal(resolverFailure.accountResult.error.code, 'telegram_proxy_unavailable')
    assert.equal(resolverFailure.accountResult.stage, 'proxy_resolve')
  } finally {
    fs.rmSync(failedScanRoot, { recursive: true, force: true })
  }
}

runTests()
  .then(() => console.log('telegram service tests passed'))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
