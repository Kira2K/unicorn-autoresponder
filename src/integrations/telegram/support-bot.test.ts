const assert = require('node:assert/strict')
const {
  BACKEND_UNAVAILABLE_MESSAGE,
  SUPPORT_BOT_ALLOWED_UPDATES,
  clearActiveTaskContextsForTest,
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
  clearActiveTaskContextsForTest(): void
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
  getProviderTasks(repository: any, actor?: any, options?: any): Promise<any>
  getResumeStatus(chatId: string, repository: any, options?: any): Promise<any>
  missingAdvanceFields(workflow: any, fakeDataMode?: boolean): string[]
  resetResumeWorkflowForTest(chatId: string, repository: any): Promise<any>
  resolveActorForWorkflow(actor: any, workflow?: any): any
  resumeWorkflowFakeDataMode(): boolean
  resumeWorkflow(chatId: string, repository: any, options?: any): Promise<any>
  resumeWorkflowById(workflowId: number, repository: any, options?: any): Promise<any>
  saveKiraCommentsFromChat(repository: any, actor?: any, comments?: string, options?: any): Promise<any>
  saveProviderLinkFromChat(repository: any, actor?: any, link?: string, options?: any): Promise<any>
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

function makeWorkflowListRepository(workflowRecords: any[]) {
  const patches: any[] = []
  return {
    patches,
    workflowRecords,
    async getResumeWorkflowByTelegramChatId() {
      return workflowRecords[0] ?? null
    },
    async getResumeWorkflowById(workflowId: number) {
      return workflowRecords.find(workflow => Number(workflow.id) === Number(workflowId)) ?? null
    },
    async getProviderResumeTasks() {
      return workflowRecords
    },
    async patchResumeWorkflow(recordId: number, patch: any) {
      patches.push({ recordId, patch })
      const workflow = workflowRecords.find(record => Number(record.id) === Number(recordId))
      if (!workflow) throw new Error(`Workflow ${recordId} not found`)
      Object.assign(workflow, patch)
      return workflow
    }
  }
}

async function runTests() {
  clearActiveTaskContextsForTest()
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
  const providerTaskOffsets: number[] = []
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
      return { found: true, chatId, message: 'Статус резюме для Client One: заполнено' }
    },
    async resumeStatus(chatId: string) {
      return { found: true, chatId, message: 'Статус резюме для Client One: черновик в работе' }
    },
    async resumeResetTest(chatId: string) {
      return { found: true, chatId, message: 'Тестовый workflow резюме для Client One сброшен.' }
    },
    async providerTasks(_actor?: any, offset = 0) {
      providerTaskOffsets.push(offset)
      return { message: 'Задачи подрядчика по резюме:\n1. Client One: черновик в работе', replyMarkup: { inline_keyboard: [] } }
    },
    async providerTask() {
      return { message: 'Client: Client One', replyMarkup: { inline_keyboard: [] } }
    },
    async advanceWorkflow() {
      return { found: true, message: 'Статус резюме для Client One: черновик на проверке у Киры' }
    },
    async saveKiraComments(comments: string) {
      return { message: `Комментарии Киры для Client One сохранены.\n\n${comments}`, replyMarkup: { inline_keyboard: [] } }
    },
    async saveResumeTaskInput(text: string, actor?: any) {
      if (actor?.userId === '8222949251') {
        return { message: `Ссылка на черновик для Client One сохранена.\n\n${text}`, replyMarkup: { inline_keyboard: [] } }
      }
      return { message: `Комментарии Киры для Client One сохранены.\n\n${text}`, replyMarkup: { inline_keyboard: [] } }
    }
  }

  assert.equal(
    responseText(await handleSupportBotMessage({
      text: '/whoami',
      chat: { id: -5216637594, type: 'supergroup' },
      from: { id: 42, username: 'tester' }
    }, foundApi)),
    'ID чата: -5216637594\nТип чата: supergroup\nID пользователя: 42\nUsername: @tester'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/backend_status', chat: { id: -5216637594 } }, foundApi)),
    'Бэкенд: работает'
  )
  assert.match(
    responseText(await handleSupportBotMessage({ text: '/commands', chat: { id: -5216637594 } }, foundApi)),
    /\/resume - продвинуть резюме/
  )
  assert.match(
    responseText(await handleSupportBotMessage({ text: '/commands@veu_support_bot', chat: { id: -5216637594 } }, foundApi)),
    /\/resume - продвинуть резюме/
  )
  assert.doesNotMatch(
    responseText(await handleSupportBotMessage({ text: '/commands', chat: { id: -5216637594 } }, foundApi)),
    /\/change_google_folder <url>/
  )
  assert.doesNotMatch(
    responseText(await handleSupportBotMessage({ text: '/commands', chat: { id: -5216637594 } }, foundApi)),
    /\/open_my_tasks - личная очередь задач/
  )
  assert.match(
    responseText(await handleSupportBotMessage({ text: '/help', chat: { id: -5216637594 } }, foundApi)),
    /Команды работают только если/
  )
  assert.match(
    responseText(await handleSupportBotMessage({ text: 'show all my commands', chat: { id: -5216637594 } }, foundApi)),
    /\/resume_status - показать текущий статус резюме/
  )
  assert.match(
    responseText(await handleSupportBotMessage({
      text: '/commands',
      chat: { id: 8222949251, type: 'private' },
      from: { id: 8222949251, username: 'veu_support' }
    }, foundApi)),
    /\/open_my_tasks - личная очередь задач/
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
    /\/open_my_tasks - личная очередь задач/
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/start', chat: { id: -5216637594, type: 'supergroup' } }, foundApi)),
    [
      'Привет, Client One! Я бот поддержки Very Evil Unicorn! 🦄',
      '',
      'Бот сейчас в бета-версии, поэтому часть функций может меняться.',
      'Отправь /commands, чтобы посмотреть список команд.'
    ].join('\n')
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/student', chat: { id: -5216637594, type: 'supergroup' } }, foundApi)),
    [
      'Ученик найден: Client One',
      '',
      'Бот сейчас в бета-версии, поэтому часть функций может меняться.',
      'Отправь /commands, чтобы посмотреть список команд.'
    ].join('\n')
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/change_google_folder https://drive.google.com/drive/folders/abc', chat: { id: -5216637594 } }, foundApi)),
    'Редактирование Google-папки из Telegram отключено. Измени корневую Google-папку в админке Noco.'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/change_google_folder', chat: { id: -5216637594 } }, foundApi)),
    'Редактирование Google-папки из Telegram отключено. Измени корневую Google-папку в админке Noco.'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/resume', chat: { id: -5216637594 } }, foundApi)),
    'Статус резюме для Client One: заполнено'
  )
  assert.equal(lastResumeOptions?.studentDataFolderUrl, '')
  assert.equal(
    responseText(await handleSupportBotMessage({
      text: '/resume https://drive.google.com/drive/folders/student-source',
      chat: { id: -5216637594, type: 'supergroup' },
      from: { id: 100, username: 'student_user' }
    }, foundApi)),
    'Статус резюме для Client One: заполнено'
  )
  assert.equal(lastResumeOptions?.studentDataFolderUrl, 'https://drive.google.com/drive/folders/student-source')
  assert.equal(
    responseText(await handleSupportBotMessage({
      text: 'I approve',
      chat: { id: -5216637594, type: 'supergroup' },
      from: { id: 100, username: 'student_user' }
    }, foundApi)),
    'Статус резюме для Client One: заполнено'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({
      text: '/resume',
      chat: { id: 8222949251, type: 'private' },
      from: { id: 8222949251, username: 'veu_support' }
    }, foundApi)),
    'Работай с задачами по резюме через /open_my_tasks.'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/resume_status', chat: { id: -5216637594 } }, foundApi)),
    'Статус резюме для Client One: черновик в работе'
  )
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/resume_reset_test', chat: { id: -5216637594 } }, foundApi)),
    'Тестовый workflow резюме для Client One сброшен.'
  )
  const groupTasksResponse = await handleSupportBotMessage({
    text: 'open my tasks',
    chat: { id: -5216637594, type: 'supergroup' },
    from: { id: 8222949251, username: 'veu_support' }
  }, foundApi)
  assert.match(responseText(groupTasksResponse), /личном чате/)

  const privateTasksResponse = await handleSupportBotMessage({
    text: '/open_my_tasks@veu_support_bot',
    chat: { id: 8222949251, type: 'private' },
    from: { id: 8222949251, username: 'veu_support' }
  }, foundApi)
  assert.equal(responseText(privateTasksResponse), 'Задачи подрядчика по резюме:\n1. Client One: черновик в работе')
  assert.deepEqual(privateTasksResponse.replyMarkup, { inline_keyboard: [] })

  const privateCommentResponse = await handleSupportBotMessage({
    text: 'Please make a focused Python draft.',
    chat: { id: 343610488, type: 'private' },
    from: { id: 343610488, username: 'Kira_arbeitet' }
  }, foundApi)
  assert.match(responseText(privateCommentResponse), /Комментарии Киры/)
  assert.deepEqual(privateCommentResponse.replyMarkup, { inline_keyboard: [] })

  const privateProviderDraftResponse = await handleSupportBotMessage({
    text: 'https://drive.google.com/drive/folders/draft-from-provider',
    chat: { id: 8222949251, type: 'private' },
    from: { id: 8222949251, username: 'veu_support' }
  }, foundApi)
  assert.match(responseText(privateProviderDraftResponse), /Ссылка на черновик/)
  assert.deepEqual(privateProviderDraftResponse.replyMarkup, { inline_keyboard: [] })

  const callbackResponse = await handleSupportBotCallback({
    data: `resume:advance:98:${Buffer.from('Draft in process', 'utf8').toString('base64url')}`,
    message: { chat: { id: 8222949251, type: 'private' } },
    from: { id: 8222949251, username: 'veu_support' }
  }, foundApi)
  assert.match(responseText(callbackResponse), /черновик на проверке у Киры/)

  clearActiveTaskContextsForTest()
  const contextualInputs: any[] = []
  const contextualApi = {
    ...foundApi,
    async providerTask(workflowId: number) {
      return {
        message: `Task ${workflowId}`,
        replyMarkup: { inline_keyboard: [] },
        workflow: {
          id: workflowId,
          status: workflowId === 77 ? "collection Kira's comments" : 'Draft in process'
        }
      }
    },
    async providerTasks(_actor?: any, offset = 0) {
      providerTaskOffsets.push(offset)
      return { message: 'Task list', replyMarkup: { inline_keyboard: [] } }
    },
    async saveResumeTaskInput(text: string, actor?: any, options?: any) {
      contextualInputs.push({ text, actor, options })
      return {
        message: `saved ${text}`,
        replyMarkup: { inline_keyboard: [] },
        workflow: options?.workflowId ? { id: options.workflowId, status: options.expectedStatus } : undefined
      }
    }
  }
  await handleSupportBotCallback({
    data: 'resume:open:99',
    message: { chat: { id: 8222949251, type: 'private' } },
    from: { id: 8222949251, username: 'veu_support' }
  }, contextualApi)
  await handleSupportBotMessage({
    text: 'https://drive.google.com/drive/folders/selected-provider-task',
    chat: { id: 8222949251, type: 'private' },
    from: { id: 8222949251, username: 'veu_support' }
  }, contextualApi)
  assert.equal(contextualInputs.at(-1).options.workflowId, 99)
  assert.equal(contextualInputs.at(-1).options.expectedStatus, 'Draft in process')

  await handleSupportBotCallback({
    data: 'resume:open:98',
    message: { chat: { id: 8222949251, type: 'private' } },
    from: { id: 8222949251, username: 'veu_support' }
  }, contextualApi)
  await handleSupportBotCallback({
    data: 'resume:open:99',
    message: { chat: { id: 8222949251, type: 'private' } },
    from: { id: 8222949251, username: 'veu_support' }
  }, contextualApi)
  await handleSupportBotMessage({
    text: 'https://drive.google.com/drive/folders/replaced-provider-task',
    chat: { id: 8222949251, type: 'private' },
    from: { id: 8222949251, username: 'veu_support' }
  }, contextualApi)
  assert.equal(contextualInputs.at(-1).options.workflowId, 99)

  await handleSupportBotCallback({
    data: 'resume:open:77',
    message: { chat: { id: 343610488, type: 'private' } },
    from: { id: 343610488, username: 'Kira_arbeitet' }
  }, contextualApi)
  await handleSupportBotMessage({
    text: 'Kira contextual comment',
    chat: { id: 343610488, type: 'private' },
    from: { id: 343610488, username: 'Kira_arbeitet' }
  }, contextualApi)
  assert.equal(contextualInputs.at(-1).options.workflowId, 77)
  assert.equal(contextualInputs.at(-1).options.expectedStatus, "collection Kira's comments")

  await handleSupportBotCallback({
    data: 'resume:open:99',
    message: { chat: { id: 8222949251, type: 'private' } },
    from: { id: 8222949251, username: 'veu_support' }
  }, contextualApi)
  await handleSupportBotCallback({
    data: 'resume:tasks',
    message: { chat: { id: 8222949251, type: 'private' } },
    from: { id: 8222949251, username: 'veu_support' }
  }, contextualApi)
  await handleSupportBotMessage({
    text: 'https://drive.google.com/drive/folders/no-active-task-after-list',
    chat: { id: 8222949251, type: 'private' },
    from: { id: 8222949251, username: 'veu_support' }
  }, contextualApi)
  assert.equal(contextualInputs.at(-1).options.workflowId, undefined)

  const realDateNow = Date.now
  try {
    ;(Date as any).now = () => 1000
    await handleSupportBotCallback({
      data: 'resume:open:99',
      message: { chat: { id: 8222949251, type: 'private' } },
      from: { id: 8222949251, username: 'veu_support' }
    }, contextualApi)
    ;(Date as any).now = () => 1000 + 30 * 60 * 1000 + 1
    await handleSupportBotMessage({
      text: 'https://drive.google.com/drive/folders/expired-active-task',
      chat: { id: 8222949251, type: 'private' },
      from: { id: 8222949251, username: 'veu_support' }
    }, contextualApi)
    assert.equal(contextualInputs.at(-1).options.workflowId, undefined)
  } finally {
    ;(Date as any).now = realDateNow
    clearActiveTaskContextsForTest()
  }

  const retryInputs: any[] = []
  let rejectNextTaskInput = true
  const retryApi = {
    ...contextualApi,
    async saveResumeTaskInput(text: string, actor?: any, options?: any) {
      retryInputs.push({ text, actor, options })
      if (rejectNextTaskInput) {
        rejectNextTaskInput = false
        throw Object.assign(new Error('Нужно отправить ссылку на резюме.'), { code: 'missing_provider_resume_link' })
      }
      return {
        message: `saved ${text}`,
        workflow: { id: options.workflowId, status: options.expectedStatus }
      }
    }
  }
  await handleSupportBotCallback({
    data: 'resume:open:99',
    message: { chat: { id: 8222949251, type: 'private' } },
    from: { id: 8222949251, username: 'veu_support' }
  }, retryApi)
  await assert.rejects(
    () => handleSupportBotMessage({
      text: 'not-a-link',
      chat: { id: 8222949251, type: 'private' },
      from: { id: 8222949251, username: 'veu_support' }
    }, retryApi),
    /ссылку/
  )
  await handleSupportBotMessage({
    text: 'https://drive.google.com/drive/folders/retry-after-invalid-link',
    chat: { id: 8222949251, type: 'private' },
    from: { id: 8222949251, username: 'veu_support' }
  }, retryApi)
  assert.equal(retryInputs.at(-1).options.workflowId, 99)
  clearActiveTaskContextsForTest()

  assert.equal(
    responseText(await handleSupportBotGroupAdd({
      my_chat_member: {
        chat: { id: -5216637594, type: 'supergroup', title: 'Test Group' },
        old_chat_member: { status: 'left' },
        new_chat_member: { status: 'member' }
      }
    }, foundApi)),
    [
      'Привет, Client One! Я бот поддержки Very Evil Unicorn! 🦄',
      '',
      'Бот сейчас в бета-версии, поэтому часть функций может меняться.',
      'Отправь /commands, чтобы посмотреть список команд.',
      '',
      'Статус резюме для Client One: черновик в работе'
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
    'Привет, Client One! Я бот поддержки Very Evil Unicorn! 🦄',
    '',
    'Бот сейчас в бета-версии, поэтому часть функций может меняться.',
    'Отправь /commands, чтобы посмотреть список команд.',
    '',
    'Статус резюме для Client One: черновик в работе'
  ].join('\n'))

  const notFoundApi = {
    async findClient(chatId: string) {
      return { found: false, chatId }
    },
    async updateGoogleFolder(chatId: string) {
      return { success: false, error: 'CLIENT_NOT_FOUND', chatId }
    },
    async resume(chatId: string) {
      return { found: false, chatId, message: 'Для этого Telegram-чата ученик не найден.' }
    },
    async resumeStatus(chatId: string) {
      return { found: false, chatId, message: 'Для этого Telegram-чата ученик не найден.' }
    },
    async resumeResetTest(chatId: string) {
      return { found: false, chatId, message: 'Для этого Telegram-чата ученик не найден.' }
    }
  }
  assert.equal(
    responseText(await handleSupportBotMessage({ text: '/student', chat: { id: -999 } }, notFoundApi)),
    'Для этого Telegram-чата ученик не найден.\n\nID чата: -999\nПривяжи этот ID чата к ученику в админке NocoDB.'
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
  process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS = '8222949251,315110920'
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
    assert.match(missingSourceResult.message, /@veu_support пожалуйста, добавьте корневую Google-папку ученика Test/)
    assert.deepEqual(missingAdvanceFields(missingSourceRepository.workflowRecord), ['root_google_folder', 'student_data_folder_url'])

    const nocoFolderRepository = makeWorkflowRepository(makeWorkflow({
      clientGoogleFolder: 'https://drive.google.com/drive/folders/noco-root'
    }))
    const nocoFolderResult = await resumeWorkflow('-5216637594', nocoFolderRepository, { actor: studentActor })
    assert.equal(nocoFolderResult.workflow.status, "collection student's data")
    assert.deepEqual(nocoFolderResult.transitions, [])
    assert.equal(nocoFolderRepository.workflowRecord.studentDataFolderUrl, '')
    assert.match(nocoFolderResult.message, /отправь \/resume <ссылка на папку с самопрезентацией\/исходными данными>/)

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
    assert.match(missingKiraTask.message, /Отправь комментарий Киры следующим сообщением/)
    assert.deepEqual(
      missingKiraTask.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Назад к задачам']
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
    assert.match(savedKiraCommentsResult.message, /Комментарии Киры для Test сохранены/)
    assert.deepEqual(
      savedKiraCommentsResult.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Перейти к следующему шагу', 'Назад к задачам']
    )

    const missingDraftRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Draft in process',
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/manual-source',
      kirasComments: 'Please prepare the draft.'
    }))
    const missingDraftTask = await getProviderTaskById(98, missingDraftRepository, providerActor)
    assert.match(missingDraftTask.message, /Отправь ссылку на черновик следующим сообщением/)
    assert.deepEqual(
      missingDraftTask.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Назад к задачам']
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
    assert.match(savedProviderDraftResult.message, /Ссылка на черновик для Test сохранена/)
    assert.match(savedProviderDraftResult.message, /Чтобы передать её дальше, нажми кнопку «Перейти к следующему шагу»/)
    assert.deepEqual(
      savedProviderDraftResult.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Перейти к следующему шагу', 'Назад к задачам']
    )

    const missingEnglishVersionRepository = makeWorkflowRepository(makeWorkflow({
      status: 'English version in progress',
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/manual-source',
      kirasComments: 'Please prepare the draft.',
      cvDraftUrl: 'https://drive.google.com/drive/folders/draft-from-provider'
    }))
    const missingEnglishTask = await getProviderTaskById(98, missingEnglishVersionRepository, providerActor)
    assert.match(missingEnglishTask.message, /Отправь ссылку на английскую версию следующим сообщением/)
    const savedProviderEnglishResult = await saveProviderLinkFromChat(
      missingEnglishVersionRepository,
      providerActor,
      'https://drive.google.com/drive/folders/cv-eng-from-provider'
    )
    assert.equal(missingEnglishVersionRepository.workflowRecord.enVersionUrl, 'https://drive.google.com/drive/folders/cv-eng-from-provider')
    assert.match(savedProviderEnglishResult.message, /Ссылка на английскую версию для Test сохранена/)
    assert.match(savedProviderEnglishResult.message, /Чтобы передать её дальше, нажми кнопку «Перейти к следующему шагу»/)
    assert.deepEqual(
      savedProviderEnglishResult.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Перейти к следующему шагу', 'Назад к задачам']
    )

    const missingRussianVersionRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Russian version in process',
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/manual-source',
      kirasComments: 'Please prepare the draft.',
      cvDraftUrl: 'https://drive.google.com/drive/folders/draft-from-provider',
      enVersionUrl: 'https://drive.google.com/drive/folders/cv-eng-from-provider'
    }))
    const missingRussianTask = await getProviderTaskById(98, missingRussianVersionRepository, providerActor)
    assert.match(missingRussianTask.message, /Отправь ссылку на русскую версию следующим сообщением/)
    const savedProviderRussianResult = await saveProviderLinkFromChat(
      missingRussianVersionRepository,
      providerActor,
      'https://drive.google.com/drive/folders/cv-ru-from-provider'
    )
    assert.equal(missingRussianVersionRepository.workflowRecord.ruVersionUrl, 'https://drive.google.com/drive/folders/cv-ru-from-provider')
    assert.match(savedProviderRussianResult.message, /Ссылка на русскую версию для Test сохранена/)
    assert.match(savedProviderRussianResult.message, /Чтобы передать её дальше, нажми кнопку «Перейти к следующему шагу»/)
    assert.deepEqual(
      savedProviderRussianResult.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Перейти к следующему шагу', 'Назад к задачам']
    )

    const exactKiraRepository = makeWorkflowListRepository([
      makeWorkflow({
        id: 201,
        status: "collection Kira's comments",
        studentDataFolderUrl: 'https://drive.google.com/drive/folders/source-one'
      }),
      makeWorkflow({
        id: 202,
        clientName: 'Selected Kira Task',
        status: "collection Kira's comments",
        studentDataFolderUrl: 'https://drive.google.com/drive/folders/source-two'
      })
    ])
    const exactKiraResult = await saveKiraCommentsFromChat(
      exactKiraRepository,
      manualKiraActor,
      'Comment for selected task only',
      { workflowId: 202, expectedStatus: "collection Kira's comments" }
    )
    assert.equal(exactKiraRepository.workflowRecords[0].kirasComments, '')
    assert.equal(exactKiraRepository.workflowRecords[1].kirasComments, 'Comment for selected task only')
    assert.equal(exactKiraResult.workflow.id, 202)

    const exactProviderRepository = makeWorkflowListRepository([
      makeWorkflow({
        id: 301,
        status: 'Draft in process',
        studentDataFolderUrl: 'https://drive.google.com/drive/folders/source-one',
        kirasComments: 'First task'
      }),
      makeWorkflow({
        id: 302,
        clientName: 'Selected Provider Task',
        status: 'Draft in process',
        studentDataFolderUrl: 'https://drive.google.com/drive/folders/source-two',
        kirasComments: 'Second task'
      })
    ])
    const exactProviderResult = await saveProviderLinkFromChat(
      exactProviderRepository,
      providerActor,
      'https://drive.google.com/drive/folders/selected-draft',
      { workflowId: 302, expectedStatus: 'Draft in process' }
    )
    assert.equal(exactProviderRepository.workflowRecords[0].cvDraftUrl, '')
    assert.equal(exactProviderRepository.workflowRecords[1].cvDraftUrl, 'https://drive.google.com/drive/folders/selected-draft')
    assert.equal(exactProviderResult.workflow.id, 302)

    const staleProviderRepository = makeWorkflowListRepository([
      makeWorkflow({
        id: 401,
        status: 'English version in progress',
        studentDataFolderUrl: 'https://drive.google.com/drive/folders/source',
        kirasComments: 'Ready'
      })
    ])
    const staleProviderResult = await saveProviderLinkFromChat(
      staleProviderRepository,
      providerActor,
      'https://drive.google.com/drive/folders/stale-draft',
      { workflowId: 401, expectedStatus: 'Draft in process' }
    )
    assert.equal(staleProviderRepository.workflowRecords[0].cvDraftUrl, '')
    assert.equal(staleProviderResult.clearActiveTask, true)

    const wrongStatusKiraRepository = makeWorkflowListRepository([
      makeWorkflow({
        id: 501,
        status: 'Draft in process',
        studentDataFolderUrl: 'https://drive.google.com/drive/folders/source'
      })
    ])
    const wrongStatusKiraResult = await saveKiraCommentsFromChat(
      wrongStatusKiraRepository,
      manualKiraActor,
      'Too late comment',
      { workflowId: 501, expectedStatus: "collection Kira's comments" }
    )
    assert.equal(wrongStatusKiraRepository.workflowRecords[0].kirasComments, '')
    assert.equal(wrongStatusKiraResult.clearActiveTask, true)

    const sparseDraftRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Draft in process',
      studentDataFolderUrl: '',
      kirasComments: '',
      cvDraftUrl: 'https://drive.google.com/drive/folders/seeded-draft'
    }))
    const sparseDraftResult = await resumeWorkflowById(98, sparseDraftRepository, { actor: providerActor })
    assert.equal(sparseDraftResult.workflow.status, 'Draft in approve by Kira')
    assert.deepEqual(sparseDraftResult.transitions, ['Draft in process -> Draft in approve by Kira'])

    const sparseEnglishRepository = makeWorkflowRepository(makeWorkflow({
      status: 'English version in progress',
      studentDataFolderUrl: '',
      kirasComments: '',
      cvDraftUrl: '',
      enVersionUrl: 'https://drive.google.com/drive/folders/seeded-en'
    }))
    const sparseEnglishTask = await getProviderTaskById(98, sparseEnglishRepository, providerActor)
    assert.doesNotMatch(sparseEnglishTask.message, /исходными данными|комментарии Киры|черновик/)
    assert.deepEqual(
      sparseEnglishTask.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Перейти к следующему шагу', 'Назад к задачам']
    )
    const sparseEnglishResult = await resumeWorkflowById(98, sparseEnglishRepository, { actor: providerActor })
    assert.equal(sparseEnglishResult.workflow.status, 'English version in approve by Kira')
    assert.deepEqual(sparseEnglishResult.transitions, ['English version in progress -> English version in approve by Kira'])

    const sparseRussianRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Russian version in process',
      studentDataFolderUrl: '',
      kirasComments: '',
      cvDraftUrl: '',
      enVersionUrl: '',
      ruVersionUrl: 'https://drive.google.com/drive/folders/seeded-ru'
    }))
    const sparseRussianTask = await getProviderTaskById(98, sparseRussianRepository, providerActor)
    assert.doesNotMatch(sparseRussianTask.message, /исходными данными|комментарии Киры|черновик|английскую/)
    assert.deepEqual(
      sparseRussianTask.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Перейти к следующему шагу', 'Назад к задачам']
    )
    const sparseRussianResult = await resumeWorkflowById(98, sparseRussianRepository, { actor: providerActor })
    assert.equal(sparseRussianResult.workflow.status, 'Russian version in approve by Kira')
    assert.deepEqual(sparseRussianResult.transitions, ['Russian version in process -> Russian version in approve by Kira'])

    const sparseEnglishApprovalRepository = makeWorkflowRepository(makeWorkflow({
      status: 'English version in approve by student',
      studentDataFolderUrl: '',
      kirasComments: '',
      cvDraftUrl: '',
      enVersionUrl: 'https://drive.google.com/drive/folders/seeded-en'
    }))
    const sparseEnglishApprovalResult = await resumeWorkflowById(98, sparseEnglishApprovalRepository, { actor: studentActor })
    assert.equal(sparseEnglishApprovalResult.workflow.status, 'Russian version in process')
    assert.deepEqual(sparseEnglishApprovalResult.transitions, ['English version in approve by student -> Russian version in process'])

    const missingApprovalLinkRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Russian version in approve by student',
      studentDataFolderUrl: '',
      kirasComments: '',
      cvDraftUrl: '',
      enVersionUrl: '',
      ruVersionUrl: ''
    }))
    const missingApprovalLinkResult = await resumeWorkflowById(98, missingApprovalLinkRepository, { actor: studentActor })
    assert.equal(missingApprovalLinkResult.workflow.status, 'Russian version in approve by student')
    assert.deepEqual(missingApprovalLinkResult.transitions, [])
    assert.match(missingApprovalLinkResult.message, /Отправь ссылку на русскую версию следующим сообщением/)

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
      { actor: studentActor, after: 'moved to filling', notification: 'private_kira' }
    ]

    let lastResult: any
    for (const step of steps) {
      lastResult = await resumeWorkflow('-5216637594', repository, { actor: step.actor })
      assert.equal(lastResult.workflow.status, step.after)
      if (step.notification) {
        assert.equal(lastResult.notifications.some((item: any) => item.kind === step.notification), true)
        if ((step.notification === 'private_kira' || step.notification === 'private_provider') && step.after !== 'moved to filling') {
          const notification = lastResult.notifications.find((item: any) => item.kind === step.notification)
          if (step.notification === 'private_kira') {
            assert.match(notification.text, /^Кира, резюме/)
          }
          if (step.notification === 'private_provider') {
            assert.match(notification.text, /^Юля, резюме/)
          }
          assert.doesNotMatch(notification.text, /^@student_user, резюме/)
          assert.match(notification.text, /Открой \/open_my_tasks, чтобы обработать эту задачу/)
          assert.match(notification.text, /Ученик: Test/)
          if (step.notification === 'private_provider') {
            assert.deepEqual(notification.chatIds, ['8222949251', '315110920'])
          }
        }
        if (step.after === 'Draft in approve by student') {
          const notification = lastResult.notifications.find((item: any) => item.kind === 'common_chat')
          assert.match(notification.text, /^@student_user, резюме/)
          assert.match(notification.text, /Черновик CV: https:\/\/docs\.google\.com\/document\/d\/test-draft/)
          assert.match(notification.text, /Чтобы согласовать, отправь:\n\/resume I approve/)
          assert.match(notification.text, /После этого я переведу резюме на следующий шаг/)
        }
        if (step.after === 'moved to filling') {
          const notification = lastResult.notifications.find((item: any) => item.kind === 'private_kira')
          assert.match(notification.text, /Резюме для Test EN передано на заполнение/)
          assert.match(notification.text, /Английская версия:/)
          assert.match(notification.text, /Русская версия:/)
        }
      }
    }

    assert.equal(lastResult.completed, false)
    assert.equal(repository.workflowRecord.studentDataFolderUrl, 'https://drive.google.com/drive/folders/manual-source')
    assert.equal(repository.workflowRecord.cvDraftUrl, 'https://docs.google.com/document/d/test-draft')
    assert.equal(repository.workflowRecord.enVersionUrl, 'https://docs.google.com/document/d/test-english-version')
    assert.equal(repository.workflowRecord.ruVersionUrl, 'https://docs.google.com/document/d/test-russian-version')
    assert.equal(repository.patches.length, 11)
    assert.match(repository.workflowRecord.workflowTrace, /student/)
    assert.match(repository.workflowRecord.workflowTrace, /provider/)
    assert.match(repository.workflowRecord.workflowTrace, /kira/)

    const fillingPatch = repository.patches.find((patch: any) => patch.status === 'moved to filling')
    assert.equal(Boolean(fillingPatch), true)
    const filledPatch = repository.patches.find((patch: any) => patch.status === 'filled')
    assert.equal(Boolean(filledPatch), false)
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
        assert.match(error.message, /Telegram-аккаунты Киры или подрядчика/)
        return true
      }
    )
    const providerTasks = await getProviderTasks(makeWorkflowRepository(beforeFilled), providerActor)
    assert.equal(providerTasks.tasks.length, 1)
    assert.equal(providerTasks.tasks[0].clientName, 'Test')
    assert.equal(providerTasks.total, 1)
    assert.equal(providerTasks.offset, 0)
    assert.match(providerTasks.message, /1-1/)
    assert.match(providerTasks.message, /1\. Test \[EN\]/)
    assert.doesNotMatch(providerTasks.message, /Google-/)
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
    assert.match(kiraTasks.message, /1-2/)
    assert.match(kiraTasks.message, /1\. Test/)
    assert.match(kiraTasks.message, /2\. Other Kira Client/)
    assert.deepEqual(kiraTasks.tasks.map((task: any) => task.clientName), ['Test', 'Other Kira Client'])
    const unavailableProviderTaskForKira = await getProviderTaskById(100, kiraTaskRepository, manualKiraActor)
    assert.equal(unavailableProviderTaskForKira.workflow, undefined)
    assert.match(unavailableProviderTaskForKira.message, /больше недоступна/)
    const openedKiraTask = await getProviderTaskById(98, kiraTaskRepository, manualKiraActor)
    assert.equal(openedKiraTask.workflow.status, 'Draft in approve by Kira')
    assert.match(openedKiraTask.message, /Статус: черновик на проверке у Киры/)
    const kiraAdvanceRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Draft in approve by Kira',
      cvDraftUrl: 'https://docs.google.com/document/d/test-draft'
    }))
    const kiraAdvanceResult = await resumeWorkflowById(98, kiraAdvanceRepository, {
      actor: manualKiraActor,
      expectedStatus: 'Draft in approve by Kira'
    })
    assert.equal(kiraAdvanceResult.workflow.status, 'Draft in approve by student')
    assert.match(kiraAdvanceResult.message, /Черновик CV: https:\/\/docs\.google\.com\/document\/d\/test-draft/)
    assert.match(kiraAdvanceResult.message, /Чтобы согласовать, отправь:\n\/resume I approve/)
    assert.match(kiraAdvanceResult.message, /После этого я переведу резюме на следующий шаг/)
    const mixedProviderTasks = await getProviderTasks({
      async getProviderResumeTasks() {
        return [
          makeWorkflow({ id: 98, clientId: 102, clientName: 'Test', status: 'Draft in process' }),
          makeWorkflow({ id: 99, clientId: 999, clientName: 'Other Client', status: 'Draft in process' })
        ]
      }
    }, providerActor)
    assert.deepEqual(mixedProviderTasks.tasks.map((task: any) => task.clientName), ['Test'])
    delete process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS
    const unscopedProviderTasks = await getProviderTasks({
      async getProviderResumeTasks() {
        return [
          makeWorkflow({ id: 98, clientId: 102, clientName: 'Test', status: 'Draft in process' }),
          makeWorkflow({ id: 99, clientId: 999, clientName: 'Other Client', status: 'Draft in process' })
        ]
      }
    }, providerActor)
    assert.deepEqual(unscopedProviderTasks.tasks.map((task: any) => task.clientName), ['Test', 'Other Client'])
    process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS = '102:473'
    await assert.rejects(
      () => resumeWorkflow(
        '-5216637594',
        makeWorkflowRepository(makeWorkflow({ clientId: 999, clientName: 'Other Client', status: 'Draft in process' })),
        { actor: providerActor }
      ),
      (error: any) => {
        assert.equal(error.code, 'forbidden')
        assert.match(error.message, /аккаунт подрядчика не назначен/)
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
