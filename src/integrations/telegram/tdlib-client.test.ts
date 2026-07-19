const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { createRealTdlibAdapter } = require('./tdlib-client.ts') as {
  createRealTdlibAdapter(dependencies?: { tdl?: any; getTdjson?: () => any }): any
}

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function chat(id: number, list: 'main' | 'archive', date = 2_000_000_000) {
  return {
    id,
    title: `${list} chat ${id}`,
    unread_count: id % 2,
    type: id === 1 ? { _: 'chatTypePrivate', user_id: 101 } : { _: 'chatTypeBasicGroup' },
    positions: [{ list: { _: list === 'main' ? 'chatListMain' : 'chatListArchive' }, order: String(10_000 - id) }],
    last_message: { date }
  }
}

type MockOptions = {
  mainIds?: number[]
  archiveIds?: number[]
  mainBatches?: number[][]
  archiveBatches?: number[][]
  chats?: Map<number, any>
  stallMain?: boolean
  loadGate?: Deferred<void>
  hydrationDelayMs?: number
  loginError?: Error
}

class MockTdlibClient extends EventEmitter {
  calls: any[] = []
  mainIds: number[]
  archiveIds: number[]
  mainBatches: number[][]
  archiveBatches: number[][]
  mainLoads = 0
  archiveLoads = 0
  chats: Map<number, any>
  activeHydrations = 0
  maxActiveHydrations = 0
  options: MockOptions

  constructor(options: MockOptions = {}) {
    super()
    this.options = options
    this.mainIds = [...(options.mainIds || [1])]
    this.archiveIds = [...(options.archiveIds || [3])]
    this.mainBatches = (options.mainBatches || [[2]]).map(batch => [...batch])
    this.archiveBatches = (options.archiveBatches || []).map(batch => [...batch])
    this.chats = options.chats || new Map([
      [1, chat(1, 'main')],
      [2, chat(2, 'main', 1_999_999_999)],
      [3, chat(3, 'archive', 1_999_999_998)]
    ])
  }

  async login() {
    if (this.options.loginError) throw this.options.loginError
    this.emit('update', { _: 'updateAuthorizationState', authorization_state: { _: 'authorizationStateReady' } })
  }

  async invoke(payload: any): Promise<any> {
    this.calls.push(payload)
    if (payload._ === 'getChats') {
      return { chat_ids: payload.chat_list?._ === 'chatListArchive' ? [...this.archiveIds] : [...this.mainIds] }
    }
    if (payload._ === 'loadChats') {
      if (this.options.loadGate) await this.options.loadGate.promise
      const archive = payload.chat_list?._ === 'chatListArchive'
      const index = archive ? this.archiveLoads++ : this.mainLoads++
      if (!archive && this.options.stallMain && index < 2) return { _: 'ok' }
      const batches = archive ? this.archiveBatches : this.mainBatches
      const ids = archive ? this.archiveIds : this.mainIds
      const batch = batches[index]
      if (!batch) throw Object.assign(new Error('Not Found'), { code: 404 })
      for (const id of batch) {
        if (!ids.includes(id)) ids.push(id)
        const value = this.chats.get(id)
        if (value) this.emit('update', { _: 'updateNewChat', chat: value })
      }
      return { _: 'ok' }
    }
    if (payload._ === 'getChat') {
      this.activeHydrations += 1
      this.maxActiveHydrations = Math.max(this.maxActiveHydrations, this.activeHydrations)
      try {
        if (this.options.hydrationDelayMs) await new Promise(resolve => setTimeout(resolve, this.options.hydrationDelayMs))
        return this.chats.get(Number(payload.chat_id))
      } finally {
        this.activeHydrations -= 1
      }
    }
    if (payload._ === 'getUser') return { id: payload.user_id, usernames: { active_usernames: ['student_user'] } }
    if (payload._ === 'getChatHistory') {
      return { messages: [{ id: 41, chat_id: payload.chat_id, is_outgoing: false, date: 2_000_000_000, content: { _: 'messageText', text: { text: 'history' } } }] }
    }
    if (payload._ === 'viewMessages') return { _: 'ok' }
    if (payload._ === 'sendMessage') {
      const pending = { id: 50, chat_id: payload.chat_id, sending_state: { _: 'messageSendingStatePending' } }
      queueMicrotask(() => this.emit('update', {
        _: 'updateMessageSendSucceeded',
        old_message_id: 50,
        message: { ...pending, id: 51, sending_state: null }
      }))
      return pending
    }
    if (payload._ === 'addProxy') return { id: 7 }
    if (payload._ === 'enableProxy') return { _: 'ok' }
    if (payload._ === 'searchPublicChat') return chat(77, 'main')
    if (payload._ === 'getChatFolders') return { chat_folders: [] }
    throw new Error(`Unexpected TDLib call: ${payload._}`)
  }

  async close() {}
}

function harness(options: MockOptions = {}) {
  const client = new MockTdlibClient(options)
  const adapter = createRealTdlibAdapter({
    tdl: {
      configure() {},
      createClient() { return client }
    },
    getTdjson: () => 'mock-tdjson'
  })
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tdlib-dialog-test-'))
  const ref = {
    clientId: 1,
    accountId: 2,
    phone: '+10000000000',
    dbPath,
    proxy: { type: 'socks5', host: '127.0.0.1', port: 1080 }
  }
  return { adapter, client, ref, cleanup: () => fs.rmSync(dbPath, { recursive: true, force: true }) }
}

function invoked(client: MockTdlibClient, name: string): number {
  return client.calls.filter(call => call._ === name).length
}

async function testSnapshotUsesDeployedDialogPath() {
  const value = harness()
  try {
    const dialogs = await value.adapter.dialogs({ ...value.ref, list: 'main', limit: 50 })
    assert.equal(dialogs.length, 1)
    assert.equal(dialogs[0].lastMessageAt, new Date(2_000_000_000 * 1000).toISOString())
    assert.equal(dialogs[0].username, '@student_user')
    assert.equal(invoked(value.client, 'getChats'), 1)
    assert.equal(invoked(value.client, 'getChat'), 1)
    assert.equal(invoked(value.client, 'getUser'), 1)
    assert.equal(invoked(value.client, 'loadChats'), 0)
    assert.equal(invoked(value.client, 'getChatHistory'), 0)
  } finally {
    value.cleanup()
  }
}

async function testCompleteMainAndArchiveScan() {
  const chats = new Map<number, any>()
  for (let id = 1; id <= 125; id += 1) chats.set(id, chat(id, 'main', 2_000_000_000 - id))
  chats.set(201, chat(201, 'archive', 1_999_999_000))
  chats.set(202, chat(202, 'archive', 1_999_998_999))
  const value = harness({
    mainIds: Array.from({ length: 50 }, (_, index) => index + 1),
    mainBatches: [Array.from({ length: 75 }, (_, index) => index + 51)],
    archiveIds: [201],
    archiveBatches: [[202, 1]],
    chats,
    hydrationDelayMs: 1
  })
  try {
    await value.adapter.folders(value.ref)
    value.client.calls = []
    const listenerCount = value.client.listenerCount('update')
    const result = await value.adapter.scanDialogs({
      ...value.ref,
      cutoffAt: new Date(0).toISOString(),
      maxChats: 5000,
      hydrationConcurrency: 8
    })
    assert.equal(result.outcome, 'complete')
    assert.equal(result.lists.main.complete, true)
    assert.equal(result.lists.archive.complete, true)
    assert.equal(result.discoveredCount, 127)
    assert.equal(result.dialogs.length, 127)
    assert.ok(value.client.maxActiveHydrations <= 8)
    assert.equal(value.client.listenerCount('update'), listenerCount)
    assert.ok(invoked(value.client, 'loadChats') >= 4)
    assert.deepEqual(
      value.client.calls.filter(call => ['getChatHistory', 'openChat', 'viewMessages', 'getUser', 'sendMessage'].includes(call._)).map(call => call._),
      [],
      'collection must not invoke history, read-state, user hydration, or send operations'
    )
  } finally {
    value.cleanup()
  }
}

async function testZeroDateMatchesIsComplete() {
  const value = harness()
  try {
    const result = await value.adapter.scanDialogs({
      ...value.ref,
      cutoffAt: new Date(2_100_000_000 * 1000).toISOString()
    })
    assert.equal(result.outcome, 'complete')
    assert.equal(result.matchedCount, 0)
    assert.deepEqual(result.dialogs, [])
  } finally {
    value.cleanup()
  }
}

async function testStalledListIsPartial() {
  const value = harness({ stallMain: true, mainBatches: [] })
  try {
    await value.adapter.folders(value.ref)
    const before = value.client.listenerCount('update')
    const result = await value.adapter.scanDialogs({ ...value.ref, cutoffAt: new Date(0).toISOString() })
    assert.equal(result.outcome, 'partial')
    assert.equal(result.lists.main.stalled, true)
    assert.equal(result.error.code, 'telegram_dialog_scan_stalled')
    assert.equal(value.client.listenerCount('update'), before)
  } finally {
    value.cleanup()
  }
}

async function testSafetyLimitIsPartial() {
  const value = harness({ mainIds: [1, 2], archiveIds: [] })
  try {
    const result = await value.adapter.scanDialogs({
      ...value.ref,
      cutoffAt: new Date(0).toISOString(),
      maxChats: 2
    })
    assert.equal(result.outcome, 'partial')
    assert.equal(result.lists.main.truncated, true)
    assert.equal(result.error.code, 'telegram_dialog_chat_limit')
  } finally {
    value.cleanup()
  }
}

async function testHydrationFailureIsPartial() {
  const value = harness({
    mainIds: [999],
    mainBatches: [],
    archiveIds: [],
    archiveBatches: [],
    chats: new Map()
  })
  try {
    const result = await value.adapter.scanDialogs({ ...value.ref, cutoffAt: new Date(0).toISOString() })
    assert.equal(result.outcome, 'partial')
    assert.equal(result.error.code, 'telegram_dialog_hydration_failed')
    assert.equal(result.lists.main.complete, true)
    assert.equal(result.lists.archive.complete, true)
  } finally {
    value.cleanup()
  }
}

async function testTimeoutRemovesTemporaryListener() {
  const previousTimeout = process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS
  process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS = '10'
  const gate = deferred<void>()
  const value = harness({ loadGate: gate })
  try {
    await value.adapter.folders(value.ref)
    const before = value.client.listenerCount('update')
    const result = await value.adapter.scanDialogs({ ...value.ref, cutoffAt: new Date(0).toISOString() })
    assert.equal(result.outcome, 'partial')
    assert.equal(result.error.code, 'telegram_dialog_scan_timeout')
    assert.equal(value.client.listenerCount('update'), before)
  } finally {
    gate.resolve()
    value.cleanup()
    if (previousTimeout === undefined) delete process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS
    else process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS = previousTimeout
  }
}

async function testCancellationRemovesTemporaryListener() {
  const gate = deferred<void>()
  const value = harness({ loadGate: gate })
  const controller = new AbortController()
  try {
    await value.adapter.folders(value.ref)
    value.client.calls = []
    const before = value.client.listenerCount('update')
    const promise = value.adapter.scanDialogs({ ...value.ref, cutoffAt: new Date(0).toISOString(), signal: controller.signal })
    while (!invoked(value.client, 'loadChats')) await new Promise(resolve => setTimeout(resolve, 2))
    controller.abort()
    const result = await promise
    assert.equal(result.outcome, 'partial')
    assert.equal(result.error.code, 'telegram_dialog_scan_cancelled')
    assert.equal(value.client.listenerCount('update'), before)
  } finally {
    gate.resolve()
    value.cleanup()
  }
}

async function testHistoryReadOnlyAndSendReadBehavior() {
  const value = harness()
  try {
    await value.adapter.messages({ ...value.ref, chatId: '1', limit: 1 })
    assert.equal(invoked(value.client, 'getChatHistory'), 1)
    assert.equal(invoked(value.client, 'openChat'), 0)
    assert.equal(invoked(value.client, 'viewMessages'), 0)
    await value.adapter.send({ ...value.ref, chatId: '1', text: 'test' })
    assert.equal(invoked(value.client, 'viewMessages'), 1)
    assert.equal(invoked(value.client, 'sendMessage'), 1)
  } finally {
    value.cleanup()
  }
}

async function testAuthorizationFailureIsClassified() {
  const value = harness({ loginError: new Error('native authorization restoration failed') })
  try {
    await assert.rejects(
      () => value.adapter.scanDialogs({ ...value.ref, cutoffAt: new Date(0).toISOString() }),
      (error: any) => {
        assert.equal(error.code, 'telegram_authorization_failed')
        assert.equal(error.stage, 'authorization')
        return true
      }
    )
  } finally {
    value.cleanup()
  }
}

async function testProxyFailureIsClassified() {
  const value = harness({ loginError: new Error('Assigned SOCKS5 proxy is unavailable') })
  try {
    await assert.rejects(
      () => value.adapter.scanDialogs({ ...value.ref, cutoffAt: new Date(0).toISOString() }),
      (error: any) => {
        assert.equal(error.code, 'telegram_proxy_unavailable')
        assert.equal(error.stage, 'authorization')
        return true
      }
    )
  } finally {
    value.cleanup()
  }
}

async function run() {
  const previous = {
    apiId: process.env.TELEGRAM_API_ID,
    apiHash: process.env.TELEGRAM_API_HASH,
    scanTimeout: process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS
  }
  process.env.TELEGRAM_API_ID = '12345'
  process.env.TELEGRAM_API_HASH = 'test-hash'
  process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS = '2000'
  try {
    await testSnapshotUsesDeployedDialogPath()
    await testCompleteMainAndArchiveScan()
    await testZeroDateMatchesIsComplete()
    await testStalledListIsPartial()
    await testSafetyLimitIsPartial()
    await testHydrationFailureIsPartial()
    await testTimeoutRemovesTemporaryListener()
    await testCancellationRemovesTemporaryListener()
    await testHistoryReadOnlyAndSendReadBehavior()
    await testAuthorizationFailureIsClassified()
    await testProxyFailureIsClassified()
  } finally {
    if (previous.apiId === undefined) delete process.env.TELEGRAM_API_ID
    else process.env.TELEGRAM_API_ID = previous.apiId
    if (previous.apiHash === undefined) delete process.env.TELEGRAM_API_HASH
    else process.env.TELEGRAM_API_HASH = previous.apiHash
    if (previous.scanTimeout === undefined) delete process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS
    else process.env.TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS = previous.scanTimeout
  }
}

run()
  .then(() => console.log('tdlib-client tests passed'))
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
