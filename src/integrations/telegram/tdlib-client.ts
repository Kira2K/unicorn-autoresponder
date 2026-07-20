const fs = require('node:fs')
const path = require('node:path')

type TelegramSessionStatus = 'disconnected' | 'connecting' | 'needs_code' | 'needs_password' | 'active' | 'expired' | 'needs_reauth' | 'proxy_missing' | 'error'

type TelegramAccountRef = {
  clientId: number
  accountId: number
  phone?: string
  password?: string
  dbPath?: string
  proxy?: TelegramProxy | null
}

type TelegramProxy = {
  type: 'socks5'
  host: string
  port: number
  username?: string
  password?: string
}

type TelegramDialog = {
  id: string
  title: string
  unreadCount?: number
  chatList?: string
  username?: string
  userId?: string
  isPrivate?: boolean
  lastMessageAt?: string
}

type TelegramDialogScanStage = 'authorization' | 'chat_load_main' | 'chat_load_archive' | 'chat_hydrate' | 'complete'

type TelegramDialogScanListResult = {
  complete: boolean
  discovered: number
  stalled?: boolean
  truncated?: boolean
}

type TelegramDialogScanResult = {
  dialogs: TelegramDialog[]
  outcome: 'complete' | 'partial'
  stage: TelegramDialogScanStage
  discoveredCount: number
  matchedCount: number
  durationMs: number
  lists: {
    main: TelegramDialogScanListResult
    archive: TelegramDialogScanListResult
  }
  error?: {
    code: string
    message: string
    stage: TelegramDialogScanStage
  }
}

type TelegramMessage = {
  id: string
  chatId: string
  text: string
  outgoing: boolean
  date?: string
}

type TelegramAttachment = {
  path: string
  fileName: string
  mimeType?: string
}

type TelegramConnectInput = TelegramAccountRef & {
  code?: string
  proxy?: TelegramProxy | null
}

type TelegramConnectResult = {
  status: TelegramSessionStatus
  dbPath: string
  message?: string
}

type TelegramAdapter = {
  connect(input: TelegramConnectInput): Promise<TelegramConnectResult>
  status(input: TelegramAccountRef): Promise<TelegramConnectResult>
  folders(input: TelegramAccountRef): Promise<Array<{ id: string; title: string; type: string }>>
  dialogs(input: TelegramAccountRef & { list?: string; folderId?: number; query?: string; limit?: number }): Promise<TelegramDialog[]>
  scanDialogs(input: TelegramAccountRef & { cutoffAt: string; signal?: AbortSignal; maxChats?: number; hydrationConcurrency?: number }): Promise<TelegramDialogScanResult>
  messages(input: TelegramAccountRef & { chatId: string; limit?: number }): Promise<TelegramMessage[]>
  send(input: TelegramAccountRef & { chatId: string; text: string }): Promise<TelegramMessage>
  sendToUsername(input: TelegramAccountRef & { username: string; text: string; attachments?: TelegramAttachment[] }): Promise<{ chatId: string; messages: TelegramMessage[] }>
  renameContact(input: TelegramAccountRef & { chatId: string; firstName: string; lastName?: string }): Promise<TelegramDialog>
  close(input: TelegramAccountRef): Promise<TelegramConnectResult>
  disconnect(input: TelegramAccountRef): Promise<TelegramConnectResult>
}

function resolveTdlibRoot(): string {
  return path.resolve(process.env.TELEGRAM_TDLIB_ROOT || path.join(process.cwd(), 'storage', 'tdlib'))
}

function tdlibDbPath(input: { clientId: number; accountId: number }): string {
  return path.join(resolveTdlibRoot(), String(input.clientId), String(input.accountId))
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function removeDir(dir: string): void {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

function tdlibAuthTimeoutMs(): number {
  const value = Number(process.env.TELEGRAM_TDLIB_AUTH_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : 30000
}

function tdlibSendTimeoutMs(): number {
  const value = Number(process.env.TELEGRAM_TDLIB_SEND_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : 120000
}

function tdlibDialogScanTimeoutMs(): number {
  const value = Number(process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : 60000
}

function createMissingProxyResult(input: TelegramAccountRef): TelegramConnectResult {
  return {
    status: 'proxy_missing',
    dbPath: input.dbPath || tdlibDbPath(input),
    message: 'Assigned SOCKS5 proxy credentials are not available.'
  }
}

function createFakeTdlibAdapter(): TelegramAdapter {
  const states = new Map<string, TelegramSessionStatus>()
  const sentMessages = new Map<string, TelegramMessage[]>()
  const key = (input: TelegramAccountRef) => `${input.clientId}:${input.accountId}`

  return {
    async connect(input) {
      const dbPath = input.dbPath || tdlibDbPath(input)
      ensureDir(dbPath)
      if (!input.proxy) return createMissingProxyResult({ ...input, dbPath })
      if (!input.phone) {
        states.set(key(input), 'needs_reauth')
        return { status: 'needs_reauth', dbPath, message: 'Telegram phone is required.' }
      }
      if (!input.code) {
        states.set(key(input), 'needs_code')
        return { status: 'needs_code', dbPath }
      }
      states.set(key(input), 'active')
      return { status: 'active', dbPath }
    },
    async status(input) {
      const dbPath = input.dbPath || tdlibDbPath(input)
      return { status: states.get(key(input)) || 'disconnected', dbPath }
    },
    async folders() {
      return [
        { id: 'main', title: 'All chats', type: 'main' },
        { id: 'archive', title: 'Archive', type: 'archive' },
        { id: 'folder:1', title: 'Work', type: 'folder' }
      ]
    },
    async dialogs(input) {
      const now = Date.now()
      const dialogs = [
        { id: 'reporting-chat', title: 'Current reporting chat', unreadCount: 0, chatList: 'main', isPrivate: false, lastMessageAt: new Date(now).toISOString() },
        { id: 'client-chat', title: 'Client messages', unreadCount: 2, chatList: 'main', username: '@client_partner', userId: '901', isPrivate: true, lastMessageAt: new Date(now - 1000).toISOString() },
        { id: 'archived-chat', title: 'Archived lead', unreadCount: 0, chatList: 'archive', isPrivate: true, lastMessageAt: new Date(now - 2000).toISOString() }
      ]
      const list = input.list || 'main'
      const query = String(input.query || '').trim().toLowerCase()
      return dialogs
        .filter(dialog => query || list === 'folder' || dialog.chatList === list)
        .filter(dialog => !query || dialog.title.toLowerCase().includes(query))
        .slice(0, input.limit || 50)
    },
    async scanDialogs(input) {
      const startedAt = Date.now()
      const cutoffMs = Date.parse(input.cutoffAt)
      const dialogs = [
        { id: 'reporting-chat', title: 'Current reporting chat', unreadCount: 0, chatList: 'main', isPrivate: false, lastMessageAt: new Date().toISOString() },
        { id: 'client-chat', title: 'Client messages', unreadCount: 2, chatList: 'main', isPrivate: true, lastMessageAt: new Date(Date.now() - 1000).toISOString() },
        { id: 'archived-chat', title: 'Archived lead', unreadCount: 0, chatList: 'archive', isPrivate: true, lastMessageAt: new Date(Date.now() - 2000).toISOString() }
      ].filter(dialog => !Number.isFinite(cutoffMs) || Date.parse(dialog.lastMessageAt) >= cutoffMs)
      if (input.signal?.aborted) {
        return {
          dialogs: [],
          outcome: 'partial',
          stage: 'authorization',
          discoveredCount: 0,
          matchedCount: 0,
          durationMs: Date.now() - startedAt,
          lists: {
            main: { complete: false, discovered: 0 },
            archive: { complete: false, discovered: 0 }
          },
          error: { code: 'telegram_dialog_scan_cancelled', message: 'Telegram dialog scan was cancelled.', stage: 'authorization' }
        }
      }
      return {
        dialogs,
        outcome: 'complete',
        stage: 'complete',
        discoveredCount: 3,
        matchedCount: dialogs.length,
        durationMs: Date.now() - startedAt,
        lists: {
          main: { complete: true, discovered: 2 },
          archive: { complete: true, discovered: 1 }
        }
      }
    },
    async messages(input) {
      const messages = sentMessages.get(input.chatId) || []
      return [
        { id: 'welcome', chatId: input.chatId, text: 'Telegram session is ready.', outgoing: false, date: new Date(0).toISOString() },
        ...messages
      ].slice(-(input.limit || 50))
    },
    async send(input) {
      const message = {
        id: `m_${Date.now()}`,
        chatId: input.chatId,
        text: input.text,
        outgoing: true,
        date: new Date().toISOString()
      }
      sentMessages.set(input.chatId, [...(sentMessages.get(input.chatId) || []), message])
      return message
    },
    async sendToUsername(input) {
      const chatId = input.username.replace(/^@/, '') || 'username-chat'
      const messages = []
      if (input.text) {
        const message = {
          id: `m_${Date.now()}`,
          chatId,
          text: input.text,
          outgoing: true,
          date: new Date().toISOString()
        }
        messages.push(message)
      }
      for (const attachment of input.attachments || []) {
        messages.push({
          id: `m_${Date.now()}_${messages.length}`,
          chatId,
          text: attachment.fileName,
          outgoing: true,
          date: new Date().toISOString()
        })
      }
      sentMessages.set(chatId, [...(sentMessages.get(chatId) || []), ...messages])
      return { chatId, messages }
    },
    async renameContact(input) {
      if (input.chatId !== 'client-chat') throw Object.assign(new Error('Only private chats can be renamed.'), { code: 'telegram_rename_not_supported' })
      return {
        id: 'client-chat',
        title: [input.firstName, input.lastName].filter(Boolean).join(' '),
        unreadCount: 2,
        chatList: 'main',
        username: '@client_partner',
        userId: '901',
        isPrivate: true
      }
    },
    async close(input) {
      const dbPath = input.dbPath || tdlibDbPath(input)
      return { status: states.get(key(input)) || 'active', dbPath }
    },
    async disconnect(input) {
      const dbPath = input.dbPath || tdlibDbPath(input)
      removeDir(dbPath)
      states.set(key(input), 'needs_reauth')
      return { status: 'needs_reauth', dbPath }
    }
  }
}

function messageText(content: any): string {
  if (!content) return ''
  if (content._ === 'messageText') return String(content.text?.text || '')
  if (content.text?.text) return String(content.text.text)
  if (content.caption?.text) return String(content.caption.text)
  return String(content._ || '')
}

function createRealTdlibAdapter(dependencies: { tdl?: any; getTdjson?: () => any } = {}): TelegramAdapter {
  const tdl = dependencies.tdl || require('tdl')
  const { getTdjson: installedGetTdjson } = require('prebuilt-tdlib')
  const getTdjson = dependencies.getTdjson || installedGetTdjson
  tdl.configure({ tdjson: getTdjson() })
  const clients = new Map<string, any>()
  const authStates = new Map<string, TelegramSessionStatus>()
  const loginPromises = new Map<string, Promise<void>>()
  const proxyApplied = new Set<string>()
  const key = (input: TelegramAccountRef) => `${input.clientId}:${input.accountId}`

  async function getClient(input: TelegramAccountRef) {
    const accountKey = key(input)
    if (clients.has(accountKey)) return clients.get(accountKey)
    const dbPath = input.dbPath || tdlibDbPath(input)
    ensureDir(dbPath)
    const apiId = Number(process.env.telegram_responses_api_id || process.env.TELEGRAM_API_ID)
    const apiHash = String(process.env.telegram_responses_api_hash || process.env.TELEGRAM_API_HASH || '').trim()
    if (!Number.isFinite(apiId) || !apiHash) {
      throw new Error('Telegram API id/hash are not configured.')
    }
    const client = tdl.createClient({
      apiId,
      apiHash,
      databaseDirectory: path.join(dbPath, 'db'),
      filesDirectory: path.join(dbPath, 'files'),
      tdlibParameters: {
        use_file_database: true,
        use_message_database: true,
        use_secret_chats: false,
        system_language_code: 'en',
        application_version: '1.0',
        device_model: 'Web Console',
        system_version: process.platform
      }
    })
    client.on('update', (update: any) => {
      if (update?._ !== 'updateAuthorizationState') return
      const state = update.authorization_state?._
      if (state === 'authorizationStateReady') authStates.set(accountKey, 'active')
      else if (state === 'authorizationStateWaitCode') authStates.set(accountKey, 'needs_code')
      else if (state === 'authorizationStateWaitPassword') authStates.set(accountKey, 'needs_password')
      else if (state === 'authorizationStateClosed') authStates.set(accountKey, 'expired')
      else authStates.set(accountKey, 'connecting')
    })
    client.on('error', () => authStates.set(accountKey, 'error'))
    clients.set(accountKey, client)
    return client
  }

  async function applyProxy(client: any, proxy?: TelegramProxy | null) {
    if (!proxy) return
    const added = await invokeWithTimeout(client, {
      _: 'addProxy',
      proxy: {
        _: 'proxy',
        server: proxy.host,
        port: proxy.port,
        type: {
          _: 'proxyTypeSocks5',
          username: proxy.username || '',
          password: proxy.password || ''
        }
      },
      enable: true,
      comment: 'Dolphin assigned proxy'
    }, 20000, 'Telegram add proxy')
    if (added?.id) {
      await invokeWithTimeout(client, { _: 'enableProxy', proxy_id: added.id }, 20000, 'Telegram enable proxy')
    }
  }

  async function applyProxyOnce(client: any, input: TelegramAccountRef) {
    const accountKey = key(input)
    if (proxyApplied.has(accountKey)) return
    await applyProxy(client, input.proxy)
    proxyApplied.add(accountKey)
  }

  async function invokeWithTimeout(client: any, payload: any, timeoutMs: number, label: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), { code: 'telegram_tdlib_timeout' })), timeoutMs)
    })
    try {
      return await Promise.race([client.invoke(payload), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function sendMessageWithDelivery(client: any, payload: any, timeoutMs = tdlibSendTimeoutMs()): Promise<any> {
    return await new Promise(async (resolve, reject) => {
      let settled = false
      let localMessageId: number | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      const earlyUpdates: any[] = []
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        client.off?.('update', onUpdate)
        client.removeListener?.('update', onUpdate)
      }
      const settle = (fn: (value?: unknown) => void, value?: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        fn(value)
      }
      const handleDeliveryUpdate = (update: any) => {
        if (localMessageId === null) {
          earlyUpdates.push(update)
          return
        }
        if (Number(update?.old_message_id) !== localMessageId) return
        if (update?._ === 'updateMessageSendSucceeded') {
          settle(resolve, update.message || { id: localMessageId })
          return
        }
        if (update?._ === 'updateMessageSendFailed') {
          const error = update.error || {}
          settle(
            reject,
            Object.assign(new Error(error.message || 'Telegram message send failed.'), {
              code: 'telegram_message_send_failed',
              details: error
            })
          )
        }
      }
      const onUpdate = (update: any) => {
        if (update?._ !== 'updateMessageSendSucceeded' && update?._ !== 'updateMessageSendFailed') return
        handleDeliveryUpdate(update)
      }
      client.on('update', onUpdate)
      try {
        const sent = await client.invoke(payload)
        localMessageId = Number(sent.id)
        if (!sent?.sending_state || !Number.isFinite(localMessageId)) {
          settle(resolve, sent)
          return
        }
        for (const update of earlyUpdates) handleDeliveryUpdate(update)
        if (settled) return
        timer = setTimeout(() => {
          settle(
            reject,
            Object.assign(new Error(`Telegram message is still pending after ${timeoutMs}ms.`), {
              code: 'telegram_message_send_pending',
              messageId: String(localMessageId)
            })
          )
        }, timeoutMs)
      } catch (error) {
        settle(reject, error)
      }
    })
  }

  function chatListFromInput(input: { list?: string; folderId?: number }) {
    if (input.list === 'archive') return { _: 'chatListArchive' }
    if (input.list === 'folder' && Number.isFinite(Number(input.folderId))) {
      return { _: 'chatListFolder', chat_folder_id: Number(input.folderId) }
    }
    return { _: 'chatListMain' }
  }

  function usernameFromUser(user: any): string {
    const username = String(
      user?.usernames?.editable_username ||
      user?.usernames?.active_usernames?.[0] ||
      user?.username ||
      ''
    ).trim()
    return username ? `@${username.replace(/^@/, '')}` : ''
  }

  async function dialogFromChat(client: any, chatId: number, chatList: string): Promise<TelegramDialog> {
    const chat = await client.invoke({ _: 'getChat', chat_id: chatId })
    let username = ''
    let userId = ''
    if (chat?.type?._ === 'chatTypePrivate' && chat.type.user_id) {
      try {
        userId = String(chat.type.user_id)
        username = usernameFromUser(await client.invoke({ _: 'getUser', user_id: chat.type.user_id }))
      } catch {
        username = ''
      }
    }
    return {
      id: String(chat.id),
      title: String(chat.title || chat.id),
      unreadCount: chat.unread_count || 0,
      chatList,
      username: username || undefined,
      userId: userId || undefined,
      isPrivate: chat?.type?._ === 'chatTypePrivate',
      lastMessageAt: chat?.last_message?.date
        ? new Date(Number(chat.last_message.date) * 1000).toISOString()
        : undefined
    }
  }

  function splitContactName(firstName: string, lastName = '') {
    const first = String(firstName || '').trim()
    const last = String(lastName || '').trim()
    if (first) return { firstName: first, lastName: last }
    const parts = last.split(/\s+/).filter(Boolean)
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') }
  }

  function attachmentInputFile(attachment: TelegramAttachment) {
    const absolutePath = path.resolve(attachment.path)
    if (!fs.existsSync(absolutePath)) {
      throw Object.assign(new Error(`Telegram attachment file does not exist: ${attachment.fileName}`), { code: 'telegram_attachment_missing' })
    }
    const stats = fs.statSync(absolutePath)
    if (!stats.isFile() || stats.size <= 0) {
      throw Object.assign(new Error(`Telegram attachment file is empty or invalid: ${attachment.fileName}`), { code: 'telegram_attachment_invalid' })
    }
    return { _: 'inputFileLocal', path: absolutePath }
  }

  async function attachmentContent(client: any, attachment: TelegramAttachment, caption = '') {
    const formattedCaption = { _: 'formattedText', text: caption, entities: [] }
    if (String(attachment.mimeType || '').toLowerCase().startsWith('image/')) {
      const inputFile = attachmentInputFile(attachment)
      return {
        _: 'inputMessagePhoto',
        photo: {
          _: 'inputPhoto',
          photo: inputFile,
          added_sticker_file_ids: [],
          width: 0,
          height: 0
        },
        caption: formattedCaption,
        has_spoiler: false
      }
    }
    const inputFile = attachmentInputFile(attachment)
    return {
      _: 'inputMessageDocument',
      document: {
        _: 'inputDocument',
        document: inputFile,
        disable_content_type_detection: false
      },
      caption: formattedCaption
    }
  }

  async function loginWithSuppliedValues(client: any, input: TelegramConnectInput & { dbPath: string }): Promise<void> {
    const accountKey = key(input)
    if (loginPromises.has(accountKey)) return await loginPromises.get(accountKey)
    let loginProxyApplied = false
    async function applyRequiredProxy(): Promise<void> {
      if (loginProxyApplied) return
      if (!input.proxy) {
        authStates.set(accountKey, 'proxy_missing')
        throw new Error('Assigned SOCKS5 proxy credentials are not available.')
      }
      await applyProxy(client, input.proxy)
      proxyApplied.add(accountKey)
      loginProxyApplied = true
    }
    const loginPromise = client.login({
      getPhoneNumber: async () => {
        await applyRequiredProxy()
        if (!input.phone) {
          authStates.set(accountKey, 'needs_reauth')
          throw new Error('Telegram phone is required.')
        }
        return input.phone
      },
      getAuthCode: async () => {
        if (!input.code) {
          authStates.set(accountKey, 'needs_code')
          throw new Error('Telegram auth code is required.')
        }
        return input.code
      },
      getPassword: async () => {
        if (!input.password) {
          authStates.set(accountKey, 'needs_password')
          throw new Error('Telegram cloud password is required.')
        }
        return input.password
      }
    })
      .then(() => {
        authStates.set(accountKey, 'active')
      })
      .catch((error: unknown) => {
        if (!authStates.get(accountKey)) authStates.set(accountKey, 'error')
        throw error
      })
      .finally(() => {
        loginPromises.delete(accountKey)
      })
    loginPromises.set(accountKey, loginPromise)
    return await loginPromise
  }

  async function loginWithTimeout(client: any, input: TelegramConnectInput & { dbPath: string }): Promise<{ timedOut: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), tdlibAuthTimeoutMs())
    })
    const result = await Promise.race([
      loginWithSuppliedValues(client, input).then(() => 'ready' as const),
      timeout
    ])
    if (timer) clearTimeout(timer)
    if (result === 'timeout') {
      loginPromises.delete(key(input))
      return { timedOut: true }
    }
    return { timedOut: false }
  }

  function scanFailure(code: string, message: string, stage: TelegramDialogScanStage): Error {
    return Object.assign(new Error(message), { code, stage })
  }

  function isChatListEnd(error: any): boolean {
    return Number(error?.code) === 404 || /\b404\b|not found|all chats/i.test(String(error?.message || ''))
  }

  async function withScanBoundary<T>(
    operation: Promise<T>,
    deadlineAt: number,
    signal: AbortSignal | undefined,
    stage: TelegramDialogScanStage
  ): Promise<T> {
    if (signal?.aborted) throw scanFailure('telegram_dialog_scan_cancelled', 'Telegram dialog scan was cancelled.', stage)
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) throw scanFailure('telegram_dialog_scan_timeout', 'Telegram dialog scan exceeded its deadline.', stage)
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortHandler: (() => void) | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(scanFailure('telegram_dialog_scan_timeout', 'Telegram dialog scan exceeded its deadline.', stage)), remainingMs)
    })
    const cancelled = new Promise<never>((_, reject) => {
      if (!signal) return
      abortHandler = () => reject(scanFailure('telegram_dialog_scan_cancelled', 'Telegram dialog scan was cancelled.', stage))
      signal.addEventListener('abort', abortHandler, { once: true })
    })
    try {
      return await Promise.race([operation, timeout, cancelled])
    } finally {
      if (timer) clearTimeout(timer)
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
    }
  }

  function tdlibListName(value: any): 'main' | 'archive' | null {
    const type = value?._
    if (type === 'chatListMain') return 'main'
    if (type === 'chatListArchive') return 'archive'
    return null
  }

  function positionListName(position: any): 'main' | 'archive' | null {
    return tdlibListName(position?.list || position?.chat_list)
  }

  function positionIsVisible(position: any): boolean {
    const order = position?.order
    return order !== undefined && order !== null && String(order) !== '0'
  }

  function scanDialogFromChat(chat: any, chatList: 'main' | 'archive'): TelegramDialog {
    return {
      id: String(chat.id),
      title: String(chat.title || chat.id),
      unreadCount: Number(chat.unread_count) || 0,
      chatList,
      isPrivate: chat?.type?._ === 'chatTypePrivate',
      lastMessageAt: chat?.last_message?.date
        ? new Date(Number(chat.last_message.date) * 1000).toISOString()
        : undefined
    }
  }

  async function hydrateScannedDialogs(
    client: any,
    memberships: Array<[number, 'main' | 'archive']>,
    chatCache: Map<number, any>,
    concurrency: number,
    deadlineAt: number,
    signal: AbortSignal | undefined
  ): Promise<{ dialogs: TelegramDialog[]; error?: TelegramDialogScanResult['error'] }> {
    const dialogs: TelegramDialog[] = []
    let cursor = 0
    let firstError: TelegramDialogScanResult['error'] | undefined
    async function worker(): Promise<void> {
      while (true) {
        const index = cursor++
        if (index >= memberships.length) return
        const [chatId, list] = memberships[index]
        try {
          if (signal?.aborted) throw scanFailure('telegram_dialog_scan_cancelled', 'Telegram dialog scan was cancelled.', 'chat_hydrate')
          const cached = chatCache.get(chatId)
          const chat = cached?.id && cached?.title
            ? cached
            : await withScanBoundary(
                client.invoke({ _: 'getChat', chat_id: chatId }),
                deadlineAt,
                signal,
                'chat_hydrate'
              )
          if (!chat?.id) throw scanFailure('telegram_dialog_hydration_failed', 'TDLib returned incomplete chat metadata.', 'chat_hydrate')
          dialogs.push(scanDialogFromChat(chat, list))
        } catch (error: any) {
          if (!firstError) {
            firstError = {
              code: String(error?.code || 'telegram_dialog_hydration_failed'),
              message: error?.code === 'telegram_dialog_scan_cancelled'
                ? 'Telegram dialog scan was cancelled.'
                : error?.code === 'telegram_dialog_scan_timeout'
                  ? 'Telegram dialog metadata hydration exceeded its deadline.'
                  : 'Some Telegram dialog metadata could not be loaded.',
              stage: 'chat_hydrate'
            }
          }
          if (error?.code === 'telegram_dialog_scan_cancelled' || error?.code === 'telegram_dialog_scan_timeout') return
        }
      }
    }
    const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 8, memberships.length || 1))
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return { dialogs, error: firstError }
  }

  async function loadScannedChatList(
    client: any,
    list: 'main' | 'archive',
    ids: Set<number>,
    capacity: number,
    deadlineAt: number,
    signal: AbortSignal | undefined
  ): Promise<{ result: TelegramDialogScanListResult; error?: TelegramDialogScanResult['error'] }> {
    const stage: TelegramDialogScanStage = list === 'main' ? 'chat_load_main' : 'chat_load_archive'
    if (capacity <= 0) {
      return {
        result: { complete: false, discovered: 0, truncated: true },
        error: { code: 'telegram_dialog_chat_limit', message: 'The 5,000-chat safety limit was reached.', stage }
      }
    }
    const chatList = list === 'main' ? { _: 'chatListMain' } : { _: 'chatListArchive' }
    const refreshIds = async () => {
      const chats: any = await withScanBoundary(
        client.invoke({ _: 'getChats', chat_list: chatList, limit: capacity }),
        deadlineAt,
        signal,
        stage
      )
      for (const value of chats?.chat_ids || []) {
        const chatId = Number(value)
        if (Number.isFinite(chatId)) ids.add(chatId)
      }
    }
    try {
      await refreshIds()
      let stalledBatches = 0
      while (true) {
        if (ids.size >= capacity) {
          return {
            result: { complete: false, discovered: ids.size, truncated: true },
            error: { code: 'telegram_dialog_chat_limit', message: 'The 5,000-chat safety limit was reached.', stage }
          }
        }
        const before = ids.size
        try {
          await withScanBoundary(
            client.invoke({ _: 'loadChats', chat_list: chatList, limit: 100 }),
            deadlineAt,
            signal,
            stage
          )
        } catch (error: any) {
          if (isChatListEnd(error)) return { result: { complete: true, discovered: ids.size } }
          throw error
        }
        await refreshIds()
        stalledBatches = ids.size === before ? stalledBatches + 1 : 0
        if (stalledBatches >= 2) {
          return {
            result: { complete: false, discovered: ids.size, stalled: true },
            error: { code: 'telegram_dialog_scan_stalled', message: `TDLib stopped adding ${list} chats before reporting completion.`, stage }
          }
        }
      }
    } catch (error: any) {
      const code = String(error?.code || 'telegram_dialog_chat_list_failed')
      return {
        result: { complete: false, discovered: ids.size },
        error: {
          code,
          message: code === 'telegram_dialog_scan_cancelled'
            ? 'Telegram dialog scan was cancelled.'
            : code === 'telegram_dialog_scan_timeout'
              ? `Telegram ${list} chat loading exceeded its deadline.`
              : `Telegram ${list} chats could not be loaded completely.`,
          stage
        }
      }
    }
  }

  return {
    async connect(input) {
      const dbPath = input.dbPath || tdlibDbPath(input)
      if (!input.proxy) return createMissingProxyResult({ ...input, dbPath })
      const client = await getClient({ ...input, dbPath })
      authStates.set(key(input), 'connecting')
      try {
        const login = await loginWithTimeout(client, { ...input, dbPath })
        if (login.timedOut) {
          const status = authStates.get(key(input)) === 'error' ? 'connecting' : authStates.get(key(input)) || 'connecting'
          authStates.set(key(input), status)
          return {
            status,
            dbPath,
            message: 'Telegram authorization is still initializing. Refresh status or try again in a moment.'
          }
        }
      } catch (error: any) {
        const status = authStates.get(key(input)) || error?.telegramStatus || 'error'
        if (['needs_code', 'needs_password', 'needs_reauth'].includes(status)) {
          return { status, dbPath, message: error instanceof Error ? error.message : String(error || '') }
        }
        throw error
      }
      return { status: authStates.get(key(input)) || 'connecting', dbPath }
    },
    async status(input) {
      const dbPath = input.dbPath || tdlibDbPath(input)
      let loginTimedOut = false
      if (!clients.has(key(input)) && fs.existsSync(dbPath)) {
        const client = await getClient({ ...input, dbPath })
        authStates.set(key(input), 'connecting')
        try {
          loginTimedOut = (await loginWithTimeout(client, { ...input, dbPath })).timedOut
        } catch {
          // The current auth state is returned below; missing code/password is expected.
        }
      }
      const status = authStates.get(key(input)) || (fs.existsSync(dbPath) ? 'connecting' : 'disconnected')
      return {
        status: loginTimedOut && status === 'error' ? 'connecting' : status,
        dbPath,
        message: loginTimedOut ? 'Telegram authorization is still initializing. Refresh status or try again in a moment.' : undefined
      }
    },
    async folders(input) {
      const client = await getClient(input)
      await loginWithSuppliedValues(client, { ...input, dbPath: input.dbPath || tdlibDbPath(input) })
      const folders = [
        { id: 'main', title: 'All chats', type: 'main' },
        { id: 'archive', title: 'Archive', type: 'archive' }
      ]
      try {
        const result = await client.invoke({ _: 'getChatFolders' })
        const tdlibFolders = (result.chat_folders || []).map((folder: any) => ({
          id: `folder:${folder.id}`,
          title: String(folder.title || `Folder ${folder.id}`),
          type: 'folder'
        }))
        return [...folders, ...tdlibFolders]
      } catch {
        return folders
      }
    },
    async dialogs(input) {
      const client = await getClient(input)
      await loginWithSuppliedValues(client, { ...input, dbPath: input.dbPath || tdlibDbPath(input) })
      const query = String(input.query || '').trim()
      if (query) {
        const chatIds = new Set<number>()
        try {
          const local = await client.invoke({ _: 'searchChats', query, limit: input.limit || 50 })
          for (const chatId of local.chat_ids || []) chatIds.add(Number(chatId))
        } catch {
          // Server search below is the useful fallback when local TDLib cache is thin.
        }
        try {
          const server = await client.invoke({ _: 'searchChatsOnServer', query, limit: input.limit || 50 })
          for (const chatId of server.chat_ids || []) chatIds.add(Number(chatId))
        } catch {
          // Some TDLib builds/accounts can reject server search; local results still stand.
        }
        return await Promise.all([...chatIds].slice(0, input.limit || 50).map((chatId: number) => dialogFromChat(client, chatId, 'search')))
      }
      const chatList = chatListFromInput(input)
      const chats = await client.invoke({ _: 'getChats', chat_list: chatList, limit: input.limit || 50 })
      const listName = input.list === 'archive' ? 'archive' : input.list === 'folder' ? `folder:${input.folderId}` : 'main'
      return await Promise.all((chats.chat_ids || []).map((chatId: number) => dialogFromChat(client, chatId, listName)))
    },
    async scanDialogs(input) {
      const startedAt = Date.now()
      const deadlineAt = startedAt + tdlibDialogScanTimeoutMs()
      const maxChats = Math.max(1, Math.min(Math.floor(Number(input.maxChats) || 5000), 5000))
      const hydrationConcurrency = Math.max(1, Math.min(Math.floor(Number(input.hydrationConcurrency) || 8), 16))
      const client = await withScanBoundary(
        Promise.resolve().then(() => getClient(input)),
        deadlineAt,
        input.signal,
        'authorization'
      )
      try {
        await withScanBoundary(
          loginWithSuppliedValues(client, { ...input, dbPath: input.dbPath || tdlibDbPath(input) }),
          deadlineAt,
          input.signal,
          'authorization'
        )
      } catch (error: any) {
        if (error?.code === 'telegram_dialog_scan_cancelled' || error?.code === 'telegram_dialog_scan_timeout') throw error
        const state = authStates.get(key(input))
        if (state === 'needs_code') throw scanFailure('telegram_auth_code_required', 'The stored Telegram session requires a new authorization code.', 'authorization')
        if (state === 'needs_password') throw scanFailure('telegram_password_required', 'The stored Telegram session requires its cloud password.', 'authorization')
        if (state === 'proxy_missing' || /proxy|SOCKS5/i.test(String(error?.message || ''))) {
          throw scanFailure('telegram_proxy_unavailable', 'The assigned Telegram proxy is unavailable.', 'authorization')
        }
        if (/lock|database.*(?:busy|in use)|SQLITE_BUSY/i.test(String(error?.message || ''))) {
          throw scanFailure('telegram_tdlib_database_locked', 'The local TDLib database is already in use.', 'authorization')
        }
        throw scanFailure('telegram_authorization_failed', 'The stored Telegram session could not restore authorization.', 'authorization')
      }

      const ids = {
        main: new Set<number>(),
        archive: new Set<number>()
      }
      const chatCache = new Map<number, any>()
      const rememberPosition = (chatId: number, position: any) => {
        const list = positionListName(position)
        if (!list || !positionIsVisible(position)) return
        ids[list].add(chatId)
      }
      const rememberChat = (chat: any) => {
        const chatId = Number(chat?.id)
        if (!Number.isFinite(chatId)) return
        chatCache.set(chatId, { ...(chatCache.get(chatId) || {}), ...chat })
        for (const position of chat?.positions || []) rememberPosition(chatId, position)
      }
      const onUpdate = (update: any) => {
        if (update?._ === 'updateNewChat') {
          rememberChat(update.chat)
          return
        }
        if (update?._ === 'updateChatPosition') {
          rememberPosition(Number(update.chat_id), update.position)
          return
        }
        if (update?._ === 'updateChatLastMessage') {
          const chatId = Number(update.chat_id)
          if (!Number.isFinite(chatId)) return
          chatCache.set(chatId, {
            ...(chatCache.get(chatId) || {}),
            id: chatId,
            last_message: update.last_message
          })
          for (const position of update.positions || []) rememberPosition(chatId, position)
        }
      }

      client.on?.('update', onUpdate)
      try {
        const main = await loadScannedChatList(client, 'main', ids.main, maxChats, deadlineAt, input.signal)
        const remainingCapacity = Math.max(0, maxChats - ids.main.size)
        const archive = await loadScannedChatList(client, 'archive', ids.archive, remainingCapacity, deadlineAt, input.signal)
        const memberships = [
          ...[...ids.main].map(chatId => [chatId, 'main'] as [number, 'main' | 'archive']),
          ...[...ids.archive]
            .filter(chatId => !ids.main.has(chatId))
            .map(chatId => [chatId, 'archive'] as [number, 'main' | 'archive'])
        ].slice(0, maxChats)
        const hydrated = input.signal?.aborted
          ? {
              dialogs: [] as TelegramDialog[],
              error: {
                code: 'telegram_dialog_scan_cancelled',
                message: 'Telegram dialog scan was cancelled.',
                stage: 'chat_hydrate' as TelegramDialogScanStage
              }
            }
          : await hydrateScannedDialogs(
              client,
              memberships,
              chatCache,
              hydrationConcurrency,
              deadlineAt,
              input.signal
            )
        const cutoffMs = Date.parse(input.cutoffAt)
        const dialogs = hydrated.dialogs
          .filter(dialog => Boolean(dialog.lastMessageAt) && (!Number.isFinite(cutoffMs) || Date.parse(String(dialog.lastMessageAt)) >= cutoffMs))
          .sort((left, right) =>
            String(right.lastMessageAt || '').localeCompare(String(left.lastMessageAt || '')) ||
            String(left.id).localeCompare(String(right.id))
          )
        const error = main.error || archive.error || hydrated.error
        const complete = main.result.complete && archive.result.complete && !hydrated.error
        return {
          dialogs,
          outcome: complete ? 'complete' : 'partial',
          stage: complete ? 'complete' : error?.stage || 'chat_hydrate',
          discoveredCount: memberships.length,
          matchedCount: dialogs.length,
          durationMs: Date.now() - startedAt,
          lists: {
            main: main.result,
            archive: archive.result
          },
          ...(error ? { error } : {})
        }
      } finally {
        if (typeof client.off === 'function') client.off('update', onUpdate)
        else client.removeListener?.('update', onUpdate)
      }
    },
    async messages(input) {
      const client = await getClient(input)
      await loginWithSuppliedValues(client, { ...input, dbPath: input.dbPath || tdlibDbPath(input) })
      // Intentionally only fetch history. Do not call TDLib viewMessages/openChat here:
      // the web console read-only mode must not mark messages as read for the sender.
      const history = await client.invoke({
        _: 'getChatHistory',
        chat_id: Number(input.chatId),
        from_message_id: 0,
        offset: 0,
        limit: input.limit || 50,
        only_local: false
      })
      return (history.messages || []).reverse().map((message: any) => ({
        id: String(message.id),
        chatId: String(input.chatId),
        text: messageText(message.content),
        outgoing: Boolean(message.is_outgoing),
        date: message.date ? new Date(message.date * 1000).toISOString() : undefined
      }))
    },
    async send(input) {
      const client = await getClient(input)
      await loginWithSuppliedValues(client, { ...input, dbPath: input.dbPath || tdlibDbPath(input) })
      try {
        const history = await client.invoke({
          _: 'getChatHistory',
          chat_id: Number(input.chatId),
          from_message_id: 0,
          offset: 0,
          limit: 50,
          only_local: false
        })
        const incomingMessageIds = (history.messages || [])
          .filter((message: any) => !message.is_outgoing)
          .map((message: any) => Number(message.id))
          .filter((id: number) => Number.isFinite(id) && id > 0)
        if (incomingMessageIds.length) {
          await client.invoke({
            _: 'viewMessages',
            chat_id: Number(input.chatId),
            message_ids: incomingMessageIds,
            source: null,
            force_read: true
          })
        }
      } catch {
        // Sending should still work if old history can't be marked read.
      }
      const sent = await sendMessageWithDelivery(client, {
        _: 'sendMessage',
        chat_id: Number(input.chatId),
        input_message_content: {
          _: 'inputMessageText',
          text: { _: 'formattedText', text: input.text, entities: [] }
        }
      })
      return {
        id: String(sent.id),
        chatId: String(input.chatId),
        text: input.text,
        outgoing: true,
        date: new Date().toISOString()
      }
    },
    async sendToUsername(input) {
      const client = await getClient(input)
      try {
        await applyProxyOnce(client, input)
      } catch {
        // Active persisted sessions can already have TDLib proxy state; don't block sends
        // only because re-applying the Dolphin proxy timed out.
      }
      const login = await loginWithTimeout(client, { ...input, dbPath: input.dbPath || tdlibDbPath(input) })
      if (login.timedOut) {
        throw Object.assign(new Error('Telegram authorization is still initializing. Refresh status or try again in a moment.'), { code: 'telegram_connecting' })
      }
      const username = String(input.username || '').replace(/^@/, '').trim()
      if (!username) throw Object.assign(new Error('Telegram username is required.'), { code: 'telegram_username_required' })
      const chat = await client.invoke({ _: 'searchPublicChat', username })
      const chatId = Number(chat.id)
      const messages: TelegramMessage[] = []
      const attachments = input.attachments || []
      if (attachments.length) {
        for (const [index, attachment] of attachments.entries()) {
          try {
            const sent = await sendMessageWithDelivery(client, {
              _: 'sendMessage',
              chat_id: chatId,
              input_message_content: await attachmentContent(client, attachment, index === 0 ? input.text : '')
            }, 120000)
            messages.push({
              id: String(sent.id),
              chatId: String(chatId),
              text: index === 0 ? input.text || attachment.fileName : attachment.fileName,
              outgoing: true,
              date: new Date().toISOString()
            })
          } catch (error: any) {
            throw Object.assign(new Error(`Telegram file send failed for ${attachment.fileName}: ${error?.message || String(error || '')}`), { code: 'telegram_file_send_failed' })
          }
        }
      } else if (input.text) {
        const sent = await sendMessageWithDelivery(client, {
          _: 'sendMessage',
          chat_id: chatId,
          input_message_content: {
            _: 'inputMessageText',
            text: { _: 'formattedText', text: input.text, entities: [] }
          }
        })
        messages.push({
          id: String(sent.id),
          chatId: String(chatId),
          text: input.text,
          outgoing: true,
          date: new Date().toISOString()
        })
      }
      return { chatId: String(chatId), messages }
    },
    async renameContact(input) {
      const client = await getClient(input)
      await loginWithSuppliedValues(client, { ...input, dbPath: input.dbPath || tdlibDbPath(input) })
      const chat = await client.invoke({ _: 'getChat', chat_id: Number(input.chatId) })
      if (chat?.type?._ !== 'chatTypePrivate' || !chat.type.user_id) {
        throw Object.assign(new Error('Only private Telegram chats can be renamed as contacts.'), { code: 'telegram_rename_not_supported' })
      }
      const { firstName, lastName } = splitContactName(input.firstName, input.lastName)
      if (!firstName) throw Object.assign(new Error('First name is required.'), { code: 'telegram_rename_invalid_name' })
      await client.invoke({
        _: 'addContact',
        user_id: chat.type.user_id,
        contact: {
          _: 'importedContact',
          phone_number: '',
          first_name: firstName,
          last_name: lastName
        },
        share_phone_number: false
      })
      return await dialogFromChat(client, Number(input.chatId), 'main')
    },
    async close(input) {
      const accountKey = key(input)
      const client = clients.get(accountKey)
      await client?.close?.()
      clients.delete(accountKey)
      const dbPath = input.dbPath || tdlibDbPath(input)
      return { status: authStates.get(accountKey) || 'active', dbPath }
    },
    async disconnect(input) {
      const accountKey = key(input)
      const client = clients.get(accountKey)
      await client?.close?.()
      clients.delete(accountKey)
      const dbPath = input.dbPath || tdlibDbPath(input)
      removeDir(dbPath)
      authStates.set(accountKey, 'needs_reauth')
      return { status: 'needs_reauth', dbPath }
    }
  }
}

function createDefaultTdlibAdapter(): TelegramAdapter {
  return process.env.WEB_CONSOLE_USE_MOCK_DATA === 'true'
    ? createFakeTdlibAdapter()
    : createRealTdlibAdapter()
}

module.exports = {
  createDefaultTdlibAdapter,
  createFakeTdlibAdapter,
  createRealTdlibAdapter,
  resolveTdlibRoot,
  tdlibDbPath
}
