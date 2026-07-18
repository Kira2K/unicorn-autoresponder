const assert = require('node:assert/strict')
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
}

runTests()
  .then(() => console.log('telegram service tests passed'))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
