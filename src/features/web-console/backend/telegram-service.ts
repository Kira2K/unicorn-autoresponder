const { getDolphinProfile } = require('../../../integrations/dolphin/profiles.ts') as {
  getDolphinProfile(profileId: number): Promise<any>
}
const fs = require('node:fs')
const path = require('node:path')
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
  dialogs(input: any): Promise<Array<{ id: string; title: string; unreadCount?: number; chatList?: string; username?: string; userId?: string; isPrivate?: boolean; lastMessageAt?: string }>>
  scanDialogs(input: any): Promise<{
    dialogs: Array<{ id: string; title: string; unreadCount?: number; chatList?: string; isPrivate?: boolean; lastMessageAt?: string }>
    outcome: 'complete' | 'partial'
    stage: string
    discoveredCount: number
    matchedCount: number
    durationMs: number
    lists: Record<'main' | 'archive', { complete: boolean; discovered: number; stalled?: boolean; truncated?: boolean }>
    error?: { code: string; message: string; stage: string }
  }>
  messages(input: any): Promise<Array<{ id: string; chatId: string; text: string; outgoing: boolean; date?: string }>>
  send(input: any): Promise<{ id: string; chatId: string; text: string; outgoing: boolean; date?: string }>
  sendToUsername(input: any): Promise<{ chatId: string; messages: Array<{ id: string; chatId: string; text: string; outgoing: boolean; date?: string }> }>
  renameContact(input: any): Promise<{ id: string; title: string; unreadCount?: number; chatList?: string; username?: string; userId?: string; isPrivate?: boolean }>
  disconnect(input: any): Promise<{ status: TelegramSessionStatus; dbPath: string; message?: string }>
}
type WebConsoleRepository = import('./types.ts').WebConsoleRepository
type WebPlatformAccount = import('./types.ts').WebPlatformAccount

type TelegramService = ReturnType<typeof createTelegramService>
type AdminTelegramAttachmentInput = {
  fileName: string
  mimeType?: string
  dataBase64: string
}

function isTelegramAccount(account: WebPlatformAccount): boolean {
  return account.isTelegramAccount === true
}

function createError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

function appendEvent(account: WebPlatformAccount, event: string, details: unknown = ''): string {
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

function normalizeUsername(value: unknown): string {
  const username = String(value ?? '').trim()
  if (!/^@[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw createError('telegram_invalid_username', 'Telegram username must start with @ and contain 5-32 letters, digits, or underscores.')
  }
  return username
}

function attachmentTempDir(): string {
  const dir = path.join(process.cwd(), 'storage', 'telegram-admin-outbox')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeFileName(value: string): string {
  return String(value || 'attachment')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 120) || 'attachment'
}

function materializeAttachments(attachments: AdminTelegramAttachmentInput[] = []) {
  return attachments.map((attachment, index) => {
    const fileName = safeFileName(attachment.fileName || `attachment-${index + 1}`)
    const filePath = path.join(attachmentTempDir(), `${Date.now()}-${index}-${fileName}`)
    fs.writeFileSync(filePath, Buffer.from(String(attachment.dataBase64 || ''), 'base64'))
    return {
      path: filePath,
      fileName,
      mimeType: attachment.mimeType
    }
  })
}

function cleanupAttachments(attachments: Array<{ path: string }>) {
  for (const attachment of attachments) {
    try {
      fs.unlinkSync(attachment.path)
    } catch {
      // Temporary send artifacts are best-effort cleanup.
    }
  }
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

function createSemaphore(limit: number) {
  let active = 0
  const queue: Array<{
    resolve: (release: () => void) => void
    reject: (error: unknown) => void
    signal?: AbortSignal
    onAbort?: () => void
  }> = []

  function drain() {
    while (active < limit && queue.length) {
      const waiter = queue.shift()!
      if (waiter.signal?.aborted) {
        if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
        waiter.reject(createError('telegram_dialog_scan_cancelled', 'Telegram dialog scan was cancelled.'))
        continue
      }
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
      active += 1
      let released = false
      waiter.resolve(() => {
        if (released) return
        released = true
        active -= 1
        drain()
      })
    }
  }

  return {
    async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      const release = await new Promise<() => void>((resolve, reject) => {
        const waiter: {
          resolve: (release: () => void) => void
          reject: (error: unknown) => void
          signal?: AbortSignal
          onAbort?: () => void
        } = { resolve, reject, signal }
        if (signal) {
          waiter.onAbort = () => {
            const index = queue.indexOf(waiter)
            if (index >= 0) queue.splice(index, 1)
            reject(createError('telegram_dialog_scan_cancelled', 'Telegram dialog scan was cancelled.'))
          }
          signal.addEventListener('abort', waiter.onAbort, { once: true })
        }
        queue.push(waiter)
        drain()
      })
      try {
        return await operation()
      } finally {
        release()
      }
    }
  }
}

const SAFE_SCAN_MESSAGES: Record<string, string> = {
  telegram_dialog_scan_cancelled: 'Telegram dialog scan was cancelled.',
  telegram_dialog_scan_timeout: 'Telegram dialog scan exceeded its configured deadline.',
  telegram_dialog_scan_stalled: 'TDLib stopped adding chats before reporting list completion.',
  telegram_dialog_chat_limit: 'The 5,000-chat safety limit was reached.',
  telegram_dialog_hydration_failed: 'Some Telegram dialog metadata could not be loaded.',
  telegram_dialog_chat_list_failed: 'A Telegram chat list could not be loaded completely.',
  telegram_dialog_account_unavailable: 'The selected active Telegram account has no usable local TDLib storage.',
  telegram_auth_code_required: 'The stored Telegram session requires a new authorization code.',
  telegram_password_required: 'The stored Telegram session requires its cloud password.',
  telegram_authorization_failed: 'The stored Telegram session could not restore authorization.',
  telegram_tdlib_database_locked: 'The local TDLib database is already in use.',
  telegram_proxy_unavailable: 'The assigned Telegram proxy is unavailable.',
  telegram_connecting: 'The stored Telegram session is still initializing.',
  telegram_dialog_scan_failed: 'Telegram dialog scanning failed for this account.'
}

function safeScanError(error: any, fallbackStage = 'authorization') {
  const rawMessage = String(error?.message || '')
  let code = String(error?.code || '')
  if (!SAFE_SCAN_MESSAGES[code]) {
    if (/auth(?:orization)? code|required code/i.test(rawMessage)) code = 'telegram_auth_code_required'
    else if (/cloud password|password is required/i.test(rawMessage)) code = 'telegram_password_required'
    else if (/proxy/i.test(rawMessage)) code = 'telegram_proxy_unavailable'
    else if (/initializing|connecting/i.test(rawMessage)) code = 'telegram_connecting'
    else if (/timed out|deadline/i.test(rawMessage)) code = 'telegram_dialog_scan_timeout'
    else code = 'telegram_dialog_scan_failed'
  }
  return {
    code,
    message: SAFE_SCAN_MESSAGES[code],
    stage: String(error?.stage || fallbackStage)
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
  scanAdminDialogs(clientId: number, input: { accountId: number; days: number; signal?: AbortSignal }): Promise<unknown>
  messages(clientId: number, input: { accountId?: number; chatId: string; limit?: number }): Promise<unknown>
  send(clientId: number, input: { accountId?: number; chatId: string; text: string; allowWrite?: boolean }): Promise<unknown>
  listAdminSenders(): Promise<unknown>
  sendToUsername(clientId: number, input: { accountId?: number; username: string; text: string; attachments?: AdminTelegramAttachmentInput[]; allowWrite?: boolean }): Promise<unknown>
  renameContact(clientId: number, input: { accountId?: number; chatId: string; firstName: string; lastName?: string }): Promise<unknown>
  reauth(clientId: number, accountId?: number): Promise<unknown>
  disconnect(clientId: number, accountId?: number): Promise<unknown>
} {
  const repository = options.repository
  let adapter = options.adapter
  const proxyResolver = options.proxyResolver ?? createDefaultProxyResolver(repository)
  const dialogScanSemaphore = createSemaphore(3)

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
    const defaultDbPath = tdlibDbPath({ clientId: account.clientId!, accountId: account.id })
    const storedDbPath = account.telegramTdlibDbPath
    const dbPath = storedDbPath && fs.existsSync(storedDbPath) ? storedDbPath : defaultDbPath
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
    async scanAdminDialogs(clientId, input) {
      const startedAt = Date.now()
      let account: WebPlatformAccount | undefined
      let client: any
      try {
        account = await getAccount(clientId, input.accountId)
        client = await repository.getClientById(clientId)
        const ref = await baseRef(account)
        if (account.telegramSessionStatus !== 'active' || !ref.dbPath || !fs.existsSync(ref.dbPath)) {
          throw Object.assign(
            new Error('The selected active Telegram account has no usable local TDLib storage.'),
            { code: 'telegram_dialog_account_unavailable', stage: 'account' }
          )
        }
        const cutoffAt = new Date(Date.now() - input.days * 86_400_000).toISOString()
        const scan = await dialogScanSemaphore.run(async () => {
          let proxy: TelegramProxy | null
          try {
            proxy = await proxyResolver(clientId)
          } catch {
            throw Object.assign(new Error('The assigned Telegram proxy could not be resolved.'), {
              code: 'telegram_proxy_unavailable',
              stage: 'proxy_resolve'
            })
          }
          return await getAdapter().scanDialogs({
            ...ref,
            proxy,
            cutoffAt,
            signal: input.signal,
            maxChats: 5000,
            hydrationConcurrency: 8
          })
        }, input.signal)
        const rows = (scan.dialogs || []).map(dialog => ({
          clientId,
          clientName: client?.clientName || `Client ${clientId}`,
          accountId: account!.id,
          accountLabel: account!.accountLabel || account!.platform || `Account ${account!.id}`,
          market: client?.market,
          stack: client?.primaryStack,
          chatId: String(dialog.id),
          dialogTitle: String(dialog.title || dialog.id),
          lastMessageAt: dialog.lastMessageAt
        }))
        return {
          rows,
          accountResult: {
            clientId,
            clientName: client?.clientName || `Client ${clientId}`,
            accountId: account.id,
            accountLabel: account.accountLabel || account.platform || `Account ${account.id}`,
            market: client?.market,
            stack: client?.primaryStack,
            outcome: scan.outcome,
            stage: scan.stage,
            durationMs: scan.durationMs,
            discoveredCount: scan.discoveredCount,
            matchedCount: scan.matchedCount,
            lists: scan.lists,
            ...(scan.error ? { error: safeScanError(scan.error, scan.stage) } : {})
          }
        }
      } catch (error: any) {
        const safeError = safeScanError(error)
        return {
          rows: [],
          accountResult: {
            clientId,
            clientName: client?.clientName || `Client ${clientId}`,
            accountId: account?.id || input.accountId,
            accountLabel: account?.accountLabel || account?.platform || `Account ${input.accountId}`,
            market: client?.market,
            stack: client?.primaryStack,
            outcome: 'failed',
            stage: safeError.stage,
            durationMs: Date.now() - startedAt,
            discoveredCount: 0,
            matchedCount: 0,
            lists: {
              main: { complete: false, discovered: 0 },
              archive: { complete: false, discovered: 0 }
            },
            error: safeError
          }
        }
      }
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
      if (!input.allowWrite) throw createError('telegram_readonly', 'Telegram is in read-only mode. Enable writing before sending messages.')
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
    async listAdminSenders() {
      const senders = await repository.listActiveTelegramSenders()
      return {
        senders: senders
          .map((sender: any) => {
            const defaultDbPath = tdlibDbPath({ clientId: Number(sender.clientId), accountId: Number(sender.accountId) })
            const dbPath = sender.dbPath && fs.existsSync(sender.dbPath) ? sender.dbPath : defaultDbPath
            return { ...sender, dbPath }
          })
          .filter((sender: any) => sender.status === 'active' && sender.dbPath && fs.existsSync(sender.dbPath))
      }
    },
    async sendToUsername(clientId, input) {
      if (!input.allowWrite) throw createError('telegram_readonly', 'Telegram is in read-only mode. Enable writing before sending messages.')
      const username = normalizeUsername(input.username)
      const text = String(input.text || '').trim()
      const attachmentInputs = input.attachments || []
      if (!text && !attachmentInputs.length) throw createError('telegram_empty_message', 'Message text or attachment is required.')
      const account = await getAccount(clientId, input.accountId)
      if (account.telegramSessionStatus !== 'active') throw createError('telegram_sender_inactive', 'Selected Telegram account is not active.')
      const attachments = materializeAttachments(attachmentInputs)
      try {
        const result = await getAdapter().sendToUsername({
          ...(await baseRef(account)),
          proxy: await proxyResolver(clientId),
          username,
          text,
          attachments
        })
        await patch(account, {
          telegram_event_log: appendEvent(account, 'admin_message_sent', {
            username,
            textLength: text.length,
            attachmentCount: attachments.length,
            attachmentNames: attachments.map(attachment => attachment.fileName),
            messageCount: result.messages.length
          })
        })
        return { accountId: account.id, ...result }
      } finally {
        cleanupAttachments(attachments)
      }
    },
    async renameContact(clientId, input) {
      const account = await getAccount(clientId, input.accountId)
      const dialog = await getAdapter().renameContact({
        ...(await baseRef(account)),
        proxy: await proxyResolver(clientId),
        chatId: input.chatId,
        firstName: input.firstName,
        lastName: input.lastName
      })
      await patch(account, { telegram_event_log: appendEvent(account, 'contact_renamed', input.chatId) })
      return { accountId: account.id, dialog }
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
