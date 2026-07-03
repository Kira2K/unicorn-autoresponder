const { getDolphinProfile } = require('../../../integrations/dolphin/profiles.ts') as {
  getDolphinProfile(profileId: number): Promise<any>
}
const { createDefaultTdlibAdapter, createFakeTdlibAdapter, tdlibDbPath } = require('../../../integrations/telegram/tdlib-client.ts') as {
  createDefaultTdlibAdapter(): TelegramAdapter
  createFakeTdlibAdapter(): TelegramAdapter
  tdlibDbPath(input: { clientId: number; accountId: number }): string
}

type TelegramSessionStatus = 'disconnected' | 'connecting' | 'needs_code' | 'needs_password' | 'active' | 'expired' | 'needs_reauth' | 'proxy_missing' | 'error'
type TelegramProxy = { type: 'socks5'; host: string; port: number; username?: string; password?: string }
type TelegramAdapter = {
  connect(input: any): Promise<{ status: TelegramSessionStatus; dbPath: string; message?: string }>
  status(input: any): Promise<{ status: TelegramSessionStatus; dbPath: string; message?: string }>
  folders(input: any): Promise<Array<{ id: string; title: string; type: string }>>
  dialogs(input: any): Promise<Array<{ id: string; title: string; unreadCount?: number; chatList?: string; username?: string }>>
  messages(input: any): Promise<Array<{ id: string; chatId: string; text: string; outgoing: boolean; date?: string }>>
  send(input: any): Promise<{ id: string; chatId: string; text: string; outgoing: boolean; date?: string }>
  disconnect(input: any): Promise<{ status: TelegramSessionStatus; dbPath: string; message?: string }>
}
type WebConsoleRepository = import('./types.ts').WebConsoleRepository
type WebPlatformAccount = import('./types.ts').WebPlatformAccount

type TelegramService = ReturnType<typeof createTelegramService>

function isTelegramAccount(account: WebPlatformAccount): boolean {
  const value = `${account.platform || ''} ${account.accountLabel || ''}`.toLowerCase()
  return (
    value.includes('telegram') ||
    value.includes('tg_') ||
    value.includes('telegram_') ||
    value.includes('phone_en')
  )
}

function createError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

function appendEvent(account: WebPlatformAccount, event: string, details = ''): string {
  let items: Array<Record<string, unknown>> = []
  try {
    const parsed = JSON.parse(account.telegramEventLog || '[]')
    if (Array.isArray(parsed)) items = parsed
  } catch {
    items = []
  }
  items.push({ at: new Date().toISOString(), event, details })
  return JSON.stringify(items.slice(-50))
}

function proxyFromProfile(profile: any): TelegramProxy | null {
  const proxy = profile?.proxy
  if (!proxy || String(proxy.type || '').toLowerCase() !== 'socks5') return null
  const host = String(proxy.host || proxy.server || proxy.ip || '').trim()
  const port = Number(proxy.port)
  if (!host || !Number.isFinite(port) || port <= 0) return null
  return {
    type: 'socks5',
    host,
    port,
    username: String(proxy.login || proxy.username || '').trim() || undefined,
    password: String(proxy.password || '').trim() || undefined
  }
}

function createDefaultProxyResolver(repository: WebConsoleRepository) {
  return async (clientId: number): Promise<TelegramProxy | null> => {
    const profiles = await repository.getDolphinProfilesForClient(clientId)
    for (const profile of profiles) {
      const snapshot = await getDolphinProfile(profile.id)
      const proxy = proxyFromProfile(snapshot)
      if (proxy) return proxy
    }
    return null
  }
}

function createTelegramService(options: {
  repository: WebConsoleRepository
  adapter?: TelegramAdapter
  proxyResolver?: (clientId: number) => Promise<TelegramProxy | null>
}): {
  getAccount(clientId: number, accountId?: number): Promise<WebPlatformAccount>
  connect(clientId: number, input: { accountId?: number; phone?: string; code?: string; password?: string }): Promise<unknown>
  status(clientId: number, accountId?: number): Promise<unknown>
  folders(clientId: number, accountId?: number): Promise<unknown>
  dialogs(clientId: number, input?: { accountId?: number; list?: string; folderId?: number; query?: string; limit?: number }): Promise<unknown>
  messages(clientId: number, input: { accountId?: number; chatId: string; limit?: number }): Promise<unknown>
  send(clientId: number, input: { accountId?: number; chatId: string; text: string }): Promise<unknown>
  reauth(clientId: number, accountId?: number): Promise<unknown>
  disconnect(clientId: number, accountId?: number): Promise<unknown>
} {
  const repository = options.repository
  let adapter = options.adapter
  const proxyResolver = options.proxyResolver ?? createDefaultProxyResolver(repository)

  function getAdapter(): TelegramAdapter {
    if (!adapter) adapter = createDefaultTdlibAdapter()
    return adapter
  }

  async function patch(account: WebPlatformAccount, data: Record<string, unknown>) {
    return await repository.updateTelegramPlatformAccount(account.clientId!, account.id, data)
  }

  async function getAccount(clientId: number, accountId?: number): Promise<WebPlatformAccount> {
    const accounts = (await repository.getTelegramPlatformAccountsForClient(clientId)).filter(isTelegramAccount)
    const account = accountId
      ? accounts.find(candidate => Number(candidate.id) === Number(accountId))
      : accounts[0]
    if (!account) throw createError('telegram_account_not_found', 'Telegram platform account was not found.')
    return account
  }

  async function baseRef(account: WebPlatformAccount) {
    const dbPath = account.telegramTdlibDbPath || tdlibDbPath({ clientId: account.clientId!, accountId: account.id })
    const phone = account.phone || account.foreignNumber
    return {
      clientId: account.clientId,
      accountId: account.id,
      phone,
      password: account.password === '***' ? undefined : account.password,
      dbPath
    }
  }

  async function saveStatus(account: WebPlatformAccount, status: TelegramSessionStatus, dbPath: string, event: string, details = '') {
    await patch(account, {
      telegram_session_status: status,
      telegram_tdlib_db_path: dbPath,
      telegram_last_active: status === 'active' ? new Date().toISOString() : account.telegramLastActive,
      telegram_event_log: appendEvent(account, event, details)
    })
    return {
      accountId: account.id,
      status,
      dbPath,
      eventLog: appendEvent(account, event, details)
    }
  }

  return {
    getAccount,
    async connect(clientId, input) {
      const account = await getAccount(clientId, input.accountId)
      if (input.phone && input.phone !== account.phone) {
        await patch(account, { phone: input.phone })
        account.phone = input.phone
      }
      const ref = await baseRef({
        ...account,
        phone: input.phone || account.phone
      })
      const proxy = await proxyResolver(clientId)
      const result = await getAdapter().connect({
        ...ref,
        phone: input.phone || ref.phone,
        code: input.code,
        password: input.password || ref.password,
        proxy
      })
      return await saveStatus(account, result.status, result.dbPath, 'connect', result.message || '')
    },
    async status(clientId, accountId) {
      const account = await getAccount(clientId, accountId)
      const result = await getAdapter().status({
        ...(await baseRef(account)),
        proxy: await proxyResolver(clientId)
      })
      return await saveStatus(account, result.status, result.dbPath, 'status_refresh', result.message || '')
    },
    async folders(clientId, accountId) {
      const account = await getAccount(clientId, accountId)
      return { accountId: account.id, folders: await getAdapter().folders({
        ...(await baseRef(account)),
        proxy: await proxyResolver(clientId)
      }) }
    },
    async dialogs(clientId, input = {}) {
      const account = await getAccount(clientId, input.accountId)
      return { accountId: account.id, dialogs: await getAdapter().dialogs({
        ...(await baseRef(account)),
        proxy: await proxyResolver(clientId),
        list: input.list,
        folderId: input.folderId,
        query: input.query,
        limit: input.limit
      }) }
    },
    async messages(clientId, input) {
      const account = await getAccount(clientId, input.accountId)
      return { accountId: account.id, messages: await getAdapter().messages({
        ...(await baseRef(account)),
        proxy: await proxyResolver(clientId),
        chatId: input.chatId,
        limit: input.limit
      }) }
    },
    async send(clientId, input) {
      const account = await getAccount(clientId, input.accountId)
      const message = await getAdapter().send({
        ...(await baseRef(account)),
        proxy: await proxyResolver(clientId),
        chatId: input.chatId,
        text: input.text
      })
      await patch(account, { telegram_event_log: appendEvent(account, 'message_sent', input.chatId) })
      return { accountId: account.id, message }
    },
    async reauth(clientId, accountId) {
      const account = await getAccount(clientId, accountId)
      return await saveStatus(account, 'needs_reauth', account.telegramTdlibDbPath || tdlibDbPath({ clientId, accountId: account.id }), 'reauth_requested')
    },
    async disconnect(clientId, accountId) {
      const account = await getAccount(clientId, accountId)
      const result = await getAdapter().disconnect(await baseRef(account))
      return await saveStatus(account, result.status, result.dbPath, 'disconnect', result.message || '')
    }
  }
}

module.exports = {
  appendEvent,
  createDefaultProxyResolver,
  createFakeTdlibAdapter,
  createTelegramService,
  isTelegramAccount,
  proxyFromProfile
}
