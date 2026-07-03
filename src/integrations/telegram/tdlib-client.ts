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
}

type TelegramMessage = {
  id: string
  chatId: string
  text: string
  outgoing: boolean
  date?: string
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
        { id: 'client-chat', title: 'Client messages', unreadCount: 2, chatList: 'main', username: '@client_partner' },
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
      filesDirectory: path.join(dbPath, 'files')
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
    const added = await client.invoke({
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
    })
    if (added?.id) {
      await client.invoke({ _: 'enableProxy', proxy_id: added.id })
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
    if (chat?.type?._ === 'chatTypePrivate' && chat.type.user_id) {
      try {
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
      username: username || undefined
    }
  }

  async function loginWithSuppliedValues(client: any, input: TelegramConnectInput & { dbPath: string }): Promise<void> {
    const accountKey = key(input)
    if (loginPromises.has(accountKey)) return await loginPromises.get(accountKey)
    let proxyApplied = false
    async function applyRequiredProxy(): Promise<void> {
      if (proxyApplied) return
      if (!input.proxy) {
        authStates.set(accountKey, 'proxy_missing')
        throw new Error('Assigned SOCKS5 proxy credentials are not available.')
      }
      await applyProxy(client, input.proxy)
      proxyApplied = true
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

  return {
    async connect(input) {
      const dbPath = input.dbPath || tdlibDbPath(input)
      if (!input.proxy) return createMissingProxyResult({ ...input, dbPath })
      const client = await getClient({ ...input, dbPath })
      authStates.set(key(input), 'connecting')
      try {
        await loginWithSuppliedValues(client, { ...input, dbPath })
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
      if (!clients.has(key(input)) && fs.existsSync(dbPath)) {
        const client = await getClient({ ...input, dbPath })
        authStates.set(key(input), 'connecting')
        try {
          await loginWithSuppliedValues(client, { ...input, dbPath })
        } catch {
          // The current auth state is returned below; missing code/password is expected.
        }
      }
      return { status: authStates.get(key(input)) || (fs.existsSync(dbPath) ? 'connecting' : 'disconnected'), dbPath }
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
