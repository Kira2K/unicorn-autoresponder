const assert = require('node:assert/strict')
const {
  BACKEND_UNAVAILABLE_MESSAGE,
  SUPPORT_BOT_ALLOWED_UPDATES,
  commandArgument,
  commandName,
  createSupportBotApiClient,
  handleSupportBotCallback,
  handleSupportBotGroupAdd,
  handleSupportBotMessage,
  responseText,
  runSupportBot
} = require('./support-bot.ts') as {
  BACKEND_UNAVAILABLE_MESSAGE: string
  SUPPORT_BOT_ALLOWED_UPDATES: string[]
  commandArgument(text: string): string
  commandName(text: string): string
  createSupportBotApiClient(options?: any): any
  handleSupportBotCallback(callbackQuery: any, api: any): Promise<any>
  handleSupportBotGroupAdd(update: any, api: any): Promise<any>
  handleSupportBotMessage(message: any, api: any): Promise<any>
  responseText(response: any): string
  runSupportBot(options?: any): Promise<void>
}
const {
  RESUME_STATUSES,
  getProviderTaskById,
  getProviderTasks,
  getResumeStatus,
  missingAdvanceFields,
  resetResumeWorkflowForTest,
  resolveActorForWorkflow,
  resumeWorkflowFakeDataMode,
  resumeWorkflow,
  resumeWorkflowById,
  saveKiraCommentsFromChat,
  saveProviderLinkFromChat
} = require('./resume-workflow.ts') as {
  RESUME_STATUSES: string[]
  getProviderTaskById(workflowId: number, repository: any, actor?: any): Promise<any>
  getProviderTasks(repository: any, actor?: any): Promise<any>
  getResumeStatus(chatId: string, repository: any, options?: any): Promise<any>
  missingAdvanceFields(workflow: any, fakeDataMode?: boolean): string[]
  resetResumeWorkflowForTest(chatId: string, repository: any): Promise<any>
  resolveActorForWorkflow(actor: any, workflow?: any): any
  resumeWorkflowFakeDataMode(): boolean
  resumeWorkflow(chatId: string, repository: any, options?: any): Promise<any>
  resumeWorkflowById(workflowId: number, repository: any, options?: any): Promise<any>
  saveKiraCommentsFromChat(repository: any, actor?: any, comments?: string): Promise<any>
  saveProviderLinkFromChat(repository: any, actor?: any, link?: string): Promise<any>
}

const studentActor = {
  userId: '100',
  username: 'student_user',
  chatId: '-5216637594',
  chatType: 'supergroup'
}
const kiraActor = {
  userId: '343610488',
  username: 'Kira_arbeitet',
  chatId: '343610488',
  chatType: 'private'
}
const providerActor = {
  userId: '8222949251',
  username: 'veu_support',
  chatId: '8222949251',
  chatType: 'private'
}

function makeWorkflow(overrides: Record<string, any> = {}) {
  return {
    id: 98,
    clientId: 102,
    clientName: 'Test',
    clientMarket: 'EN',
    clientTelegramUsername: '@student_user',
    commonChatId: '-5216637594',
    education: 'University',
    englishLevel: 'B1',
    englishLevelId: 3,
    status: "collection student's data",
    studentDataFolderUrl: '',
    cvDraftUrl: '',
    enVersionUrl: '',
    ruVersionUrl: '',
    additionalVersions: '',
    kirasComments: '',
    lastResponsible: 'student',
    lastWorkflowError: '',
    workflowTrace: '',
    ...overrides
  }
}

function makeWorkflowRepository(workflowRecord = makeWorkflow()) {
  const patches: any[] = []
  const repository = {
    patches,
    workflowRecord,
    async getResumeWorkflowByTelegramChatId(chatId: string, options: any) {
      assert.equal(chatId, '-5216637594')
      assert.equal(options.ensure, true)
      return workflowRecord
    },
    async getResumeWorkflowById(workflowId: number) {
      return Number(workflowId) === Number(workflowRecord.id) ? workflowRecord : null
    },
    async getProviderResumeTasks() {
      return [workflowRecord]
    },
    async patchResumeWorkflow(recordId: number, patch: any) {
      assert.equal(recordId, 98)
      patches.push(patch)
      Object.assign(workflowRecord, patch)
      return workflowRecord
    }
  }
  return repository
}

async function runTests() {
  assert.equal(commandName('/student@veu_support_bot hello'), '/student')
  assert.equal(commandArgument('/change_google_folder https://drive.google.com/drive/folders/abc'), 'https://drive.google.com/drive/folders/abc')
  assert.equal(RESUME_STATUSES.includes('filled'), true)
  assert.equal(RESUME_STATUSES.includes('stopped'), true)
  assert.equal(
    resolveActorForWorkflow({
      userId: '7586552066',
      username: 'student_user',
      chatId: '-5216637594',
      chatType: 'supergroup'
    }, makeWorkflow()).role,
    'student'
  )
  assert.equal(resolveActorForWorkflow(kiraActor, makeWorkflow()).role, 'kira')

  let lastResumeOptions: any
  const foundApi = {
    async backendStatus() {
      return { ok: true, service: 'web-console-backend' }
    },
    async findClient(chatId: string) {
      return { found: true, chatId, client: { id: 1, name: 'Client One', chatId, googleFolder: '' } }
    },
    async updateGoogleFolder(chatId: string, googleFolder: string) {
      return { success: true, client: { id: 1, name: 'Client One', chatId, googleFolder } }
    },
    async resume(chatId: string, _actor?: any, options?: any) {
      lastResumeOptions = options
      return { found: true, chatId, message: 'Resume workflow status for Client One: filled' }
    },
    async resumeStatus(chatId: string) {
      return { found: true, chatId, message: 'Resume workflow status for Client One: Draft in process' }
    },
    async resumeResetTest(chatId: string) {
      return { found: true, chatId, message: 'Resume test workflow reset for Client One.' }
    },
    async providerTasks() {
      return { message: 'Provider resume tasks:\n1. Client One: Draft in process', replyMarkup: { inline_keyboard: [] } }
    },
    async providerTask() {
      return { message: 'Client: Client One', replyMarkup: { inline_keyboard: [] } }
    },
    async advanceWorkflow() {
      return { found: true, message: 'Resume workflow status for Client One: Draft in approve by Kira' }
    },
    async saveKiraComments(comments: string) {
      return { message: `Kira comments saved for Client One.\n\n${comments}`, replyMarkup: { inline_keyboard: [] } }
    },
    async saveResumeTaskInput(text: string, actor?: any) {
      if (actor?.userId === '8222949251') {
        return { message: `Draft link saved for Client One.\n\n${text}`, replyMarkup: { inline_keyboard: [] } }
      }
      return { message: `Kira comments saved for Client One.\n\n${text}`, replyMarkup: { inline_keyboard: [] } }
    }
  }

  assert.equal(
    responseText(await handleSupportBotMessage({
      text: '/whoami',
      chat: { id: -5216637594, type: 'supergroup' },
      from: { id: 42, username: 'tester' }
    }, foundApi)),
    'Chat ID: -5216637594\nChat type: supergroup\nUser ID: 42\nUsername: @tester'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/backend_status', chat: { id: -5216637594 } }, foundApi)),
    'Backend: ok'
  )
  assert.match(
    responseText(await handleSupportBotMessage({ text: '/commands', chat: { id: -5216637594 } }, foundApi)),
    /\/resume - move the resume workflow/
  )
  assert.match(
    responseText(await handleSupportBotMessage({ text: '/commands@veu_support_bot', chat: { id: -5216637594 } }, foundApi)),
    /\/resume - move the resume workflow/
  )
  assert.doesNotMatch(
    responseText(await handleSupportBotMessage({ text: '/commands', chat: { id: -5216637594 } }, foundApi)),
    /\/change_google_folder <url>/
  )
  assert.doesNotMatch(
    responseText(await handleSupportBotMessage({ text: '/commands', chat: { id: -5216637594 } }, foundApi)),
    /\/open_my_tasks - private Kira\/Provider queue/
  )
  assert.match(
    responseText(await handleSupportBotMessage({ text: '/help', chat: { id: -5216637594 } }, foundApi)),
    /Commands only work when this chat or Telegram account is linked/
  )
  assert.match(
    responseText(await handleSupportBotMessage({ text: 'show all my commands', chat: { id: -5216637594 } }, foundApi)),
    /\/resume_status - show the current resume workflow status/
  )
  assert.match(
    responseText(await handleSupportBotMessage({
      text: '/commands',
      chat: { id: 8222949251, type: 'private' },
      from: { id: 8222949251, username: 'veu_support' }
    }, foundApi)),
    /\/open_my_tasks - private Kira\/Provider queue/
  )
  const regularPrivateApi = {
    ...foundApi,
    async providerTasks() {
      throw Object.assign(new Error('Only configured Kira or provider Telegram accounts can open resume tasks.'), {
        code: 'forbidden',
        status: 403
      })
    }
  }
  assert.doesNotMatch(
    responseText(await handleSupportBotMessage({
      text: '/commands',
      chat: { id: 42, type: 'private' },
      from: { id: 42, username: 'regular_user' }
    }, regularPrivateApi)),
    /\/open_my_tasks - private Kira\/Provider queue/
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/student', chat: { id: -5216637594, type: 'supergroup' } }, foundApi)),
    'Student found: Client One'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/change_google_folder https://drive.google.com/drive/folders/abc', chat: { id: -5216637594 } }, foundApi)),
    'Google folder editing from Telegram is disabled. Please edit the root Google folder in Noco/Admin Console.'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/change_google_folder', chat: { id: -5216637594 } }, foundApi)),
    'Google folder editing from Telegram is disabled. Please edit the root Google folder in Noco/Admin Console.'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/resume', chat: { id: -5216637594 } }, foundApi)),
    'Resume workflow status for Client One: filled'
  )
  assert.equal(lastResumeOptions?.studentDataFolderUrl, '')
  assert.equal(
    responseText(await handleSupportBotMessage({
      text: '/resume https://drive.google.com/drive/folders/student-source',
      chat: { id: -5216637594, type: 'supergroup' },
      from: { id: 100, username: 'student_user' }
    }, foundApi)),
    'Resume workflow status for Client One: filled'
  )
  assert.equal(lastResumeOptions?.studentDataFolderUrl, 'https://drive.google.com/drive/folders/student-source')
  assert.equal(
    responseText(await handleSupportBotMessage({
      text: 'I approve',
      chat: { id: -5216637594, type: 'supergroup' },
      from: { id: 100, username: 'student_user' }
    }, foundApi)),
    'Resume workflow status for Client One: filled'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({
      text: '/resume',
      chat: { id: 8222949251, type: 'private' },
      from: { id: 8222949251, username: 'veu_support' }
    }, foundApi)),
    'Please operate resume tasks via /open_my_tasks.'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/resume_status', chat: { id: -5216637594 } }, foundApi)),
    'Resume workflow status for Client One: Draft in process'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/resume_reset_test', chat: { id: -5216637594 } }, foundApi)),
    'Resume test workflow reset for Client One.'
  )
  const groupTasksResponse = await handleSupportBotMessage({
    text: 'open my tasks',
    chat: { id: -5216637594, type: 'supergroup' },
    from: { id: 8222949251, username: 'veu_support' }
  }, foundApi)
  assert.match(responseText(groupTasksResponse), /private chat/)

  const privateTasksResponse = await handleSupportBotMessage({
    text: '/open_my_tasks@veu_support_bot',
    chat: { id: 8222949251, type: 'private' },
    from: { id: 8222949251, username: 'veu_support' }
  }, foundApi)
  assert.equal(responseText(privateTasksResponse), 'Provider resume tasks:\n1. Client One: Draft in process')
  assert.deepEqual(privateTasksResponse.replyMarkup, { inline_keyboard: [] })

  const privateCommentResponse = await handleSupportBotMessage({
    text: 'Please make a focused Python draft.',
    chat: { id: 343610488, type: 'private' },
    from: { id: 343610488, username: 'Kira_arbeitet' }
  }, foundApi)
  assert.match(responseText(privateCommentResponse), /Kira comments saved/)
  assert.deepEqual(privateCommentResponse.replyMarkup, { inline_keyboard: [] })

  const privateProviderDraftResponse = await handleSupportBotMessage({
    text: 'https://drive.google.com/drive/folders/draft-from-provider',
    chat: { id: 8222949251, type: 'private' },
    from: { id: 8222949251, username: 'veu_support' }
  }, foundApi)
  assert.match(responseText(privateProviderDraftResponse), /Draft link saved/)
  assert.deepEqual(privateProviderDraftResponse.replyMarkup, { inline_keyboard: [] })

  const callbackResponse = await handleSupportBotCallback({
    data: `resume:advance:98:${Buffer.from('Draft in process', 'utf8').toString('base64url')}`,
    message: { chat: { id: 8222949251, type: 'private' } },
    from: { id: 8222949251, username: 'veu_support' }
  }, foundApi)
  assert.match(responseText(callbackResponse), /Draft in approve by Kira/)

  assert.equal(
    responseText(await handleSupportBotGroupAdd({
      my_chat_member: {
        chat: { id: -5216637594, type: 'supergroup', title: 'Test Group' },
        old_chat_member: { status: 'left' },
        new_chat_member: { status: 'member' }
      }
    }, foundApi)),
    [
      "Hello Client One, I'm a unicorn support bot!",
      'Please complete the required profile details about yourself in the Console.',
      'Add self-presentation and resume files to your Google folder when this stage asks for them.',
      'Send /commands to see what I can do.'
    ].join('\n')
  )
  assert.equal(await handleSupportBotGroupAdd({
    my_chat_member: {
      chat: { id: -5216637594, type: 'supergroup', title: 'Test Group' },
      old_chat_member: { status: 'member' },
      new_chat_member: { status: 'administrator' }
    }
  }, foundApi), null)

  const runnerStop = new AbortController()
  const runnerSentMessages: any[] = []
  let runnerAllowedUpdates: string[] | undefined
  await runSupportBot({
    apiClient: foundApi,
    stopSignal: runnerStop.signal,
    pollTimeout: 0,
    botApi: {
      async getUpdates(_offset?: number, _timeout?: number, allowedUpdates?: string[]) {
        runnerAllowedUpdates = allowedUpdates
        return [{
          update_id: 1,
          my_chat_member: {
            chat: { id: -5216637594, type: 'supergroup', title: 'Test Group' },
            old_chat_member: { status: 'left' },
            new_chat_member: { status: 'member' }
          }
        }]
      },
      async sendMessage(input: any) {
        runnerSentMessages.push(input)
        runnerStop.abort()
        return { ok: true }
      },
      async answerCallbackQuery() {
        return { ok: true }
      }
    }
  })
  assert.deepEqual(runnerAllowedUpdates, SUPPORT_BOT_ALLOWED_UPDATES)
  assert.equal(runnerSentMessages.at(-1).chatId, '-5216637594')
  assert.equal(runnerSentMessages.at(-1).text, [
    "Hello Client One, I'm a unicorn support bot!",
    'Please complete the required profile details about yourself in the Console.',
    'Add self-presentation and resume files to your Google folder when this stage asks for them.',
    'Send /commands to see what I can do.'
  ].join('\n'))

  const notFoundApi = {
    async findClient(chatId: string) {
      return { found: false, chatId }
    },
    async updateGoogleFolder(chatId: string) {
      return { success: false, error: 'CLIENT_NOT_FOUND', chatId }
    },
    async resume(chatId: string) {
      return { found: false, chatId, message: 'No student found for this Telegram chat.' }
    },
    async resumeStatus(chatId: string) {
      return { found: false, chatId, message: 'No student found for this Telegram chat.' }
    },
    async resumeResetTest(chatId: string) {
      return { found: false, chatId, message: 'No student found for this Telegram chat.' }
    }
  }
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/student', chat: { id: -999 } }, notFoundApi)),
    'No student found for this Telegram chat.\n\nChat ID: -999\nPlease link this chat ID to a student in NocoDB/Admin Console.'
  )
  assert.equal(await handleSupportBotMessage({ text: 'hello', chat: { id: -999 } }, notFoundApi), null)

  const downApi = {
    async backendStatus() {
      throw Object.assign(new Error(BACKEND_UNAVAILABLE_MESSAGE), { code: 'backend_unavailable' })
    },
    async findClient() {
      throw Object.assign(new Error(BACKEND_UNAVAILABLE_MESSAGE), { code: 'backend_unavailable' })
    },
    async providerTasks() {
      throw Object.assign(new Error(BACKEND_UNAVAILABLE_MESSAGE), { code: 'backend_unavailable' })
    }
  }
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/backend_status', chat: { id: -5216637594 } }, downApi)),
    BACKEND_UNAVAILABLE_MESSAGE
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/student', chat: { id: -5216637594 } }, downApi)),
    BACKEND_UNAVAILABLE_MESSAGE
  )
  assert.equal(
    responseText(await handleSupportBotMessage({
      text: '/open_my_tasks',
      chat: { id: 8222949251, type: 'private' },
      from: { id: 8222949251, username: 'veu_support' }
    }, downApi)),
    BACKEND_UNAVAILABLE_MESSAGE
  )

  const connectionRefusedApi = createSupportBotApiClient({
    baseUrl: 'http://127.0.0.1:65535',
    token: 'test-bot-token',
    requester: async () => {
      const error = new TypeError('fetch failed') as Error & { cause?: any }
      error.cause = { code: 'ECONNREFUSED' }
      throw error
    }
  })
  await assert.rejects(
    () => connectionRefusedApi.findClient('-5216637594'),
    (error: any) => {
      assert.equal(error.code, 'backend_unavailable')
      assert.equal(error.message, BACKEND_UNAVAILABLE_MESSAGE)
      return true
    }
  )

  const timedOutApi = createSupportBotApiClient({
    baseUrl: 'http://127.0.0.1:65535',
    token: 'test-bot-token',
    timeoutMs: 1,
    requester: async (_url: string, options: any) => await new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
      })
    })
  })
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/backend_status', chat: { id: -5216637594 } }, timedOutApi)),
    BACKEND_UNAVAILABLE_MESSAGE
  )

  const proxyDownApi = createSupportBotApiClient({
    baseUrl: 'http://127.0.0.1:65535',
    token: 'test-bot-token',
    requester: async () => ({
      ok: false,
      status: 503,
      async json() {
        return { error: 'service_unavailable' }
      }
    })
  })
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/backend_status', chat: { id: -5216637594 } }, proxyDownApi)),
    BACKEND_UNAVAILABLE_MESSAGE
  )

  const previousResumeTestMode = process.env.RESUME_WORKFLOW_TEST_MODE
  const previousKiraUserIds = process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS
  const previousKiraNotifyChatId = process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID
  const previousProviderUserIds = process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS
  const previousProviderNotifyChatId = process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID
  const previousProviderRefs = process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS
  const previousFakeDataMode = process.env.RESUME_WORKFLOW_FAKE_DATA_MODE
  process.env.RESUME_WORKFLOW_TEST_MODE = 'true'
  process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS = '343610488'
  process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID = '343610488'
  process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS = '8222949251'
  process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID = '8222949251'
  process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS = '102:473'
  process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = 'false'
  try {
    const manualKiraActor = {
      ...kiraActor,
      userId: '343610488',
      username: 'kira_manual'
    }
    assert.equal(resolveActorForWorkflow(manualKiraActor, makeWorkflow()).role, 'kira')
    const kiraWithStudentUsername = {
      ...manualKiraActor,
      username: 'student_user',
      chatId: '-5216637594',
      chatType: 'supergroup'
    }
    assert.equal(resolveActorForWorkflow(kiraWithStudentUsername, makeWorkflow()).role, 'student')
    assert.equal(resolveActorForWorkflow(kiraWithStudentUsername, makeWorkflow({
      status: "collection Kira's comments"
    })).role, 'kira')
    assert.equal(resumeWorkflowFakeDataMode(), false)

    const missingEnglishRepository = makeWorkflowRepository(makeWorkflow({ englishLevel: '', englishLevelId: undefined }))
    await assert.rejects(
      () => resumeWorkflow('-5216637594', missingEnglishRepository, { actor: studentActor }),
      (error: any) => {
        assert.equal(error.code, 'resume_required_data_missing')
        assert.deepEqual(error.missingFields, ['English level'])
        return true
      }
    )

    const missingSourceRepository = makeWorkflowRepository()
    const missingSourceResult = await resumeWorkflow('-5216637594', missingSourceRepository, { actor: studentActor })
    assert.equal(missingSourceResult.workflow.status, "collection student's data")
    assert.deepEqual(missingSourceResult.transitions, [])
    assert.equal(missingSourceRepository.workflowRecord.studentDataFolderUrl, '')
    assert.match(missingSourceResult.message, /@veu_support pls add Test's root Google folder in Noco clients\.google_folder/)
    assert.deepEqual(missingAdvanceFields(missingSourceRepository.workflowRecord), ['root_google_folder', 'student_data_folder_url'])

    const nocoFolderRepository = makeWorkflowRepository(makeWorkflow({
      clientGoogleFolder: 'https://drive.google.com/drive/folders/noco-root'
    }))
    const nocoFolderResult = await resumeWorkflow('-5216637594', nocoFolderRepository, { actor: studentActor })
    assert.equal(nocoFolderResult.workflow.status, "collection student's data")
    assert.deepEqual(nocoFolderResult.transitions, [])
    assert.equal(nocoFolderRepository.workflowRecord.studentDataFolderUrl, '')
    assert.match(nocoFolderResult.message, /send \/resume <link to the self-presentation\/source-data folder>/)

    const suppliedStudentFolderResult = await resumeWorkflow('-5216637594', nocoFolderRepository, {
      actor: studentActor,
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/student-source'
    })
    assert.equal(suppliedStudentFolderResult.workflow.status, "collection Kira's comments")
    assert.deepEqual(suppliedStudentFolderResult.transitions, ["collection student's data -> collection Kira's comments"])
    assert.equal(nocoFolderRepository.workflowRecord.studentDataFolderUrl, 'https://drive.google.com/drive/folders/student-source')

    const missingKiraCommentRepository = makeWorkflowRepository(makeWorkflow({
      status: "collection Kira's comments",
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/manual-source'
    }))
    const missingKiraTask = await getProviderTaskById(98, missingKiraCommentRepository, manualKiraActor)
    assert.match(missingKiraTask.message, /Required before processing: kiras_comments/)
    assert.deepEqual(
      missingKiraTask.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Back to tasks']
    )
    const missingKiraResult = await resumeWorkflowById(98, missingKiraCommentRepository, { actor: manualKiraActor })
    assert.equal(missingKiraResult.workflow.status, "collection Kira's comments")
    assert.deepEqual(missingKiraResult.transitions, [])
    assert.equal(missingKiraCommentRepository.workflowRecord.kirasComments, '')

    const savedKiraCommentsResult = await saveKiraCommentsFromChat(
      missingKiraCommentRepository,
      manualKiraActor,
      'Please prepare the first draft.'
    )
    assert.equal(missingKiraCommentRepository.workflowRecord.kirasComments, 'Please prepare the first draft.')
    assert.match(savedKiraCommentsResult.message, /Kira comments saved for Test/)
    assert.deepEqual(
      savedKiraCommentsResult.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Process next step', 'Back to tasks']
    )

    const missingDraftRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Draft in process',
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/manual-source',
      kirasComments: 'Please prepare the draft.'
    }))
    const missingDraftTask = await getProviderTaskById(98, missingDraftRepository, providerActor)
    assert.match(missingDraftTask.message, /Required before processing: cv_draft_url/)
    assert.deepEqual(
      missingDraftTask.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Back to tasks']
    )
    const missingDraftResult = await resumeWorkflowById(98, missingDraftRepository, { actor: providerActor })
    assert.equal(missingDraftResult.workflow.status, 'Draft in process')
    assert.deepEqual(missingDraftResult.transitions, [])
    assert.equal(missingDraftRepository.workflowRecord.cvDraftUrl, '')

    const savedProviderDraftResult = await saveProviderLinkFromChat(
      missingDraftRepository,
      providerActor,
      'https://drive.google.com/drive/folders/draft-from-provider'
    )
    assert.equal(missingDraftRepository.workflowRecord.cvDraftUrl, 'https://drive.google.com/drive/folders/draft-from-provider')
    assert.match(savedProviderDraftResult.message, /Draft link saved for Test/)
    assert.deepEqual(
      savedProviderDraftResult.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Process next step', 'Back to tasks']
    )

    const missingEnglishVersionRepository = makeWorkflowRepository(makeWorkflow({
      status: 'English version in progress',
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/manual-source',
      kirasComments: 'Please prepare the draft.',
      cvDraftUrl: 'https://drive.google.com/drive/folders/draft-from-provider'
    }))
    const savedProviderEnglishResult = await saveProviderLinkFromChat(
      missingEnglishVersionRepository,
      providerActor,
      'https://drive.google.com/drive/folders/cv-eng-from-provider'
    )
    assert.equal(missingEnglishVersionRepository.workflowRecord.enVersionUrl, 'https://drive.google.com/drive/folders/cv-eng-from-provider')
    assert.match(savedProviderEnglishResult.message, /English version link saved for Test/)
    assert.deepEqual(
      savedProviderEnglishResult.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Process next step', 'Back to tasks']
    )

    const missingRussianVersionRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Russian version in process',
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/manual-source',
      kirasComments: 'Please prepare the draft.',
      cvDraftUrl: 'https://drive.google.com/drive/folders/draft-from-provider',
      enVersionUrl: 'https://drive.google.com/drive/folders/cv-eng-from-provider'
    }))
    const savedProviderRussianResult = await saveProviderLinkFromChat(
      missingRussianVersionRepository,
      providerActor,
      'https://drive.google.com/drive/folders/cv-ru-from-provider'
    )
    assert.equal(missingRussianVersionRepository.workflowRecord.ruVersionUrl, 'https://drive.google.com/drive/folders/cv-ru-from-provider')
    assert.match(savedProviderRussianResult.message, /Russian version link saved for Test/)
    assert.deepEqual(
      savedProviderRussianResult.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Process next step', 'Back to tasks']
    )

    process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = 'true'
    assert.equal(resumeWorkflowFakeDataMode(), true)

    const repository = makeWorkflowRepository(makeWorkflow({
      clientGoogleFolder: 'https://drive.google.com/drive/folders/root',
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/manual-source'
    }))
    const statusResult = await getResumeStatus('-5216637594', repository, { actor: studentActor })
    assert.equal(statusResult.workflow.status, "collection student's data")

    const steps = [
      { actor: studentActor, after: "collection Kira's comments", notification: 'private_kira' },
      { actor: manualKiraActor, after: 'Draft in process', notification: 'private_provider' },
      { actor: providerActor, after: 'Draft in approve by Kira', notification: 'private_kira' },
      { actor: manualKiraActor, after: 'Draft in approve by student', notification: 'common_chat' },
      { actor: studentActor, after: 'English version in progress', notification: 'private_provider' },
      { actor: providerActor, after: 'English version in approve by Kira', notification: 'private_kira' },
      { actor: manualKiraActor, after: 'English version in approve by student', notification: 'common_chat' },
      { actor: studentActor, after: 'Russian version in process', notification: 'private_provider' },
      { actor: providerActor, after: 'Russian version in approve by Kira', notification: 'private_kira' },
      { actor: manualKiraActor, after: 'Russian version in approve by student', notification: 'common_chat' },
      { actor: studentActor, after: 'filled', notification: 'private_kira' }
    ]

    let lastResult: any
    for (const step of steps) {
      lastResult = await resumeWorkflow('-5216637594', repository, { actor: step.actor })
      assert.equal(lastResult.workflow.status, step.after)
      if (step.notification) {
        assert.equal(lastResult.notifications.some((item: any) => item.kind === step.notification), true)
        if ((step.notification === 'private_kira' || step.notification === 'private_provider') && step.after !== 'filled') {
          const notification = lastResult.notifications.find((item: any) => item.kind === step.notification)
          assert.match(notification.text, /Open \/open_my_tasks to process this task/)
          assert.match(notification.text, /Student: Test/)
        }
        if (step.after === 'Draft in approve by student') {
          const notification = lastResult.notifications.find((item: any) => item.kind === 'common_chat')
          assert.match(notification.text, /Draft CV: https:\/\/docs\.google\.com\/document\/d\/test-draft/)
          assert.match(notification.text, /To approve it, send:\n\/resume I approve/)
          assert.match(notification.text, /After that I will move the resume workflow to the next step/)
        }
        if (step.after === 'filled') {
          const notification = lastResult.notifications.find((item: any) => item.kind === 'private_kira')
          assert.match(notification.text, /Resume workflow for Test EN is filled/)
          assert.match(notification.text, /English version:/)
          assert.match(notification.text, /Russian version:/)
        }
      }
    }

    assert.equal(lastResult.completed, true)
    assert.equal(repository.workflowRecord.studentDataFolderUrl, 'https://drive.google.com/drive/folders/manual-source')
    assert.equal(repository.workflowRecord.cvDraftUrl, 'https://docs.google.com/document/d/test-draft')
    assert.equal(repository.workflowRecord.enVersionUrl, 'https://docs.google.com/document/d/test-english-version')
    assert.equal(repository.workflowRecord.ruVersionUrl, 'https://docs.google.com/document/d/test-russian-version')
    assert.equal(repository.patches.length, 11)
    assert.match(repository.workflowRecord.workflowTrace, /student/)
    assert.match(repository.workflowRecord.workflowTrace, /provider/)
    assert.match(repository.workflowRecord.workflowTrace, /kira/)

    const fillingPatch = repository.patches.find((patch: any) => patch.status === 'moved to filling')
    assert.equal(Boolean(fillingPatch), false)
    const beforeFilled = makeWorkflow({
      status: 'Draft in process'
    })
    await assert.rejects(
      () => resumeWorkflow(
        '-5216637594',
        makeWorkflowRepository(makeWorkflow({ status: "collection Kira's comments" })),
        { actor: studentActor }
      ),
      (error: any) => {
        assert.equal(error.code, 'forbidden')
        assert.equal(error.requiredRole, 'kira')
        assert.equal(error.actorRole, 'student')
        return true
      }
    )
    await assert.rejects(
      () => resumeWorkflow(
        '-5216637594',
        makeWorkflowRepository(makeWorkflow({ status: 'Draft in process' })),
        { actor: studentActor }
      ),
      (error: any) => {
        assert.equal(error.code, 'forbidden')
        assert.equal(error.requiredRole, 'provider')
        assert.equal(error.actorRole, 'student')
        return true
      }
    )
    await assert.rejects(
      () => getProviderTasks(makeWorkflowRepository(beforeFilled), studentActor),
      (error: any) => {
        assert.equal(error.code, 'forbidden')
        assert.match(error.message, /Only configured Kira or provider/)
        return true
      }
    )
    const providerTasks = await getProviderTasks(makeWorkflowRepository(beforeFilled), providerActor)
    assert.equal(providerTasks.tasks.length, 1)
    assert.equal(providerTasks.tasks[0].clientName, 'Test')
    assert.match(providerTasks.message, /^Provider resume tasks:/)
    assert.match(providerTasks.message, /Student: Test/)
    assert.match(providerTasks.message, /Status: Draft in process/)
    assert.match(providerTasks.message, /Market: EN/)
    const kiraTaskRows = [
      makeWorkflow({ id: 98, clientId: 102, clientName: 'Test', status: 'Draft in approve by Kira' }),
      makeWorkflow({ id: 99, clientId: 999, clientName: 'Other Kira Client', status: 'English version in approve by Kira' }),
      makeWorkflow({ id: 100, clientId: 102, clientName: 'Provider Client', status: 'Draft in process' }),
      makeWorkflow({ id: 101, clientId: 102, clientName: 'Student Client', status: 'Draft in approve by student' })
    ]
    const kiraTaskRepository = {
      async getProviderResumeTasks() {
        return kiraTaskRows
      },
      async getResumeWorkflowById(workflowId: number) {
        return kiraTaskRows.find((workflow: any) => Number(workflow.id) === Number(workflowId)) ?? null
      }
    }
    const kiraTasks = await getProviderTasks(kiraTaskRepository, manualKiraActor)
    assert.match(kiraTasks.message, /^Kira resume tasks:/)
    assert.match(kiraTasks.message, /Student: Test/)
    assert.match(kiraTasks.message, /Status: Draft in approve by Kira/)
    assert.deepEqual(kiraTasks.tasks.map((task: any) => task.clientName), ['Test', 'Other Kira Client'])
    const unavailableProviderTaskForKira = await getProviderTaskById(100, kiraTaskRepository, manualKiraActor)
    assert.equal(unavailableProviderTaskForKira.workflow, undefined)
    assert.match(unavailableProviderTaskForKira.message, /not available/)
    const openedKiraTask = await getProviderTaskById(98, kiraTaskRepository, manualKiraActor)
    assert.equal(openedKiraTask.workflow.status, 'Draft in approve by Kira')
    assert.match(openedKiraTask.message, /Status: Draft in approve by Kira/)
    const kiraAdvanceRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Draft in approve by Kira',
      cvDraftUrl: 'https://docs.google.com/document/d/test-draft'
    }))
    const kiraAdvanceResult = await resumeWorkflowById(98, kiraAdvanceRepository, {
      actor: manualKiraActor,
      expectedStatus: 'Draft in approve by Kira'
    })
    assert.equal(kiraAdvanceResult.workflow.status, 'Draft in approve by student')
    assert.match(kiraAdvanceResult.message, /Draft CV: https:\/\/docs\.google\.com\/document\/d\/test-draft/)
    assert.match(kiraAdvanceResult.message, /To approve it, send:\n\/resume I approve/)
    assert.match(kiraAdvanceResult.message, /After that I will move the resume workflow to the next step/)
    const mixedProviderTasks = await getProviderTasks({
      async getProviderResumeTasks() {
        return [
          makeWorkflow({ id: 98, clientId: 102, clientName: 'Test', status: 'Draft in process' }),
          makeWorkflow({ id: 99, clientId: 999, clientName: 'Other Client', status: 'Draft in process' })
        ]
      }
    }, providerActor)
    assert.deepEqual(mixedProviderTasks.tasks.map((task: any) => task.clientName), ['Test'])
    await assert.rejects(
      () => resumeWorkflow(
        '-5216637594',
        makeWorkflowRepository(makeWorkflow({ clientId: 999, clientName: 'Other Client', status: 'Draft in process' })),
        { actor: providerActor }
      ),
      (error: any) => {
        assert.equal(error.code, 'forbidden')
        assert.match(error.message, /not assigned/)
        return true
      }
    )

    const resetResult = await resetResumeWorkflowForTest('-5216637594', repository)
    assert.equal(resetResult.workflow.status, "collection student's data")
    assert.equal(resetResult.workflow.cvDraftUrl, '')
  } finally {
    if (previousResumeTestMode === undefined) {
      delete process.env.RESUME_WORKFLOW_TEST_MODE
    } else {
      process.env.RESUME_WORKFLOW_TEST_MODE = previousResumeTestMode
    }
    if (previousKiraUserIds === undefined) {
      delete process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS
    } else {
      process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS = previousKiraUserIds
    }
    if (previousKiraNotifyChatId === undefined) {
      delete process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID
    } else {
      process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID = previousKiraNotifyChatId
    }
    if (previousProviderUserIds === undefined) {
      delete process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS
    } else {
      process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS = previousProviderUserIds
    }
    if (previousProviderNotifyChatId === undefined) {
      delete process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID
    } else {
      process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID = previousProviderNotifyChatId
    }
    if (previousProviderRefs === undefined) {
      delete process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS
    } else {
      process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS = previousProviderRefs
    }
    if (previousFakeDataMode === undefined) {
      delete process.env.RESUME_WORKFLOW_FAKE_DATA_MODE
    } else {
      process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = previousFakeDataMode
    }
  }

  console.log('support bot tests passed')
}

runTests().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
