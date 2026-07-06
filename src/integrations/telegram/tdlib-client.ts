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
  messages(input: TelegramAccountRef & { chatId: string; limit?: number }): Promise<TelegramMessage[]>
  send(input: TelegramAccountRef & { chatId: string; text: string }): Promise<TelegramMessage>
  sendToUsername(input: TelegramAccountRef & { username: string; text: string; attachments?: TelegramAttachment[] }): Promise<{ chatId: string; messages: TelegramMessage[] }>
  renameContact(input: TelegramAccountRef & { chatId: string; firstName: string; lastName?: string }): Promise<TelegramDialog>
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
      const dialogs = [
        { id: 'reporting-chat', title: 'Current reporting chat', unreadCount: 0, chatList: 'main' },
        { id: 'client-chat', title: 'Client messages', unreadCount: 2, chatList: 'main', username: '@client_partner', userId: '901', isPrivate: true },
        { id: 'archived-chat', title: 'Archived lead', unreadCount: 0, chatList: 'archive' }
      ]
      const list = input.list || 'main'
      const query = String(input.query || '').trim().toLowerCase()
      return dialogs
        .filter(dialog => query || list === 'folder' || dialog.chatList === list)
        .filter(dialog => !query || dialog.title.toLowerCase().includes(query))
        .slice(0, input.limit || 50)
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

function createRealTdlibAdapter(): TelegramAdapter {
  const tdl = require('tdl')
  const { getTdjson } = require('prebuilt-tdlib')
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
      isPrivate: chat?.type?._ === 'chatTypePrivate'
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
      const sent = await client.invoke({
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
            const sent = await invokeWithTimeout(client, {
              _: 'sendMessage',
              chat_id: chatId,
              input_message_content: await attachmentContent(client, attachment, index === 0 ? input.text : '')
            }, 120000, `Telegram send file ${attachment.fileName}`)
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
        const sent = await client.invoke({
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
