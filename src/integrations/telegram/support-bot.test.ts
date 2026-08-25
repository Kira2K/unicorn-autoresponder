const assert = require('node:assert/strict')
const {
  BACKEND_OVERLOADED_MESSAGE,
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
  BACKEND_OVERLOADED_MESSAGE: string
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
  callbackData,
  decodeCallbackStatus,
  getProviderTaskById,
  getProviderTasks,
  getResumeStatus,
  missingAdvanceFields,
  requiredClientDataIssues,
  resetResumeWorkflowForTest,
  rejectResumeWorkflow,
  rejectResumeWorkflowById,
  resolveActorForWorkflow,
  resumeWorkflowFakeDataMode,
  resumeWorkflow,
  resumeWorkflowById,
  saveKiraCommentsFromChat,
  saveProviderLinkFromChat
} = require('./resume-workflow.ts') as {
  RESUME_STATUSES: string[]
  callbackData(action: 'open' | 'advance' | 'reject', workflowId: number, expectedStatus?: string): string
  decodeCallbackStatus(value: string | undefined): string
  getProviderTaskById(workflowId: number, repository: any, actor?: any): Promise<any>
  getProviderTasks(repository: any, actor?: any, options?: any): Promise<any>
  getResumeStatus(chatId: string, repository: any, options?: any): Promise<any>
  missingAdvanceFields(workflow: any, fakeDataMode?: boolean): string[]
  requiredClientDataIssues(workflow: any): string[]
  resetResumeWorkflowForTest(chatId: string, repository: any): Promise<any>
  rejectResumeWorkflow(chatId: string, repository: any, options?: any): Promise<any>
  rejectResumeWorkflowById(workflowId: number, repository: any, options?: any): Promise<any>
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
const ruTranslatorActor = {
  userId: '490903294',
  username: 'polinats',
  chatId: '490903294',
  chatType: 'private'
}

function makeWorkflow(overrides: Record<string, any> = {}) {
  return {
    id: 98,
    clientId: 102,
    clientName: 'Test',
    clientStack: 'Python',
    clientMarket: 'EN',
    clientTelegramUsername: '@student_user',
    clientTelegramRu: '@student_ru',
    clientTelegramEn: '@student_en',
    clientPhoneRu: '+7 999 000 1122',
    clientPhoneEn: '+1 555 0100',
    commonChatId: '-5216637594',
    education: 'University',
    educationEntries: [
      { uni: 'University', faculty: '', grade: '', yearOfEnd: '' }
    ],
    realAge: 24,
    realLocation: 'Tbilisi, Georgia',
    desiredLocation: 'Remote RU proxy',
    englishLevel: 'B1',
    englishLevelId: 3,
    clientGoogleFolder: '',
    clientGithubUrl: 'https://github.com/student-user',
    clientGithubAccountExists: true,
    clientLinkedInUrl: 'https://linkedin.com/in/student-user',
    clientLinkedInAccountExists: true,
    status: "collection student's data",
    studentDataFolderUrl: '',
    cvDraftUrl: '',
    enVersionUrl: '',
    ruVersionUrl: '',
    additionalVersions: '',
    kirasComments: '',
    lastRejectionComment: '',
    rejectionHistory: '',
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
  let lastRejectWorkflowInput: any
  let lastRejectResumeInput: any
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
    async rejectWorkflow(workflowId: number, expectedStatus: string, comment: string, actor?: any) {
      lastRejectWorkflowInput = { workflowId, expectedStatus, comment, actor }
      return { found: true, message: `Резюме возвращено: ${comment}`, workflow: { id: workflowId, status: 'Draft in process' } }
    },
    async rejectResume(chatId: string, comment: string, actor?: any) {
      lastRejectResumeInput = { chatId, comment, actor }
      return { found: true, message: `Резюме возвращено из чата: ${comment}`, workflow: { status: 'Draft in process' } }
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
  const rejectCallbackResponse = await handleSupportBotCallback({
    data: callbackData('reject', 98, 'Draft in approve by student'),
    message: { chat: { id: -5216637594, type: 'supergroup' } },
    from: { id: 100, username: 'student_user' }
  }, foundApi)
  assert.match(responseText(rejectCallbackResponse), /для того чтобы вернуть на доработку введи \/resume_reject оставил комменты в резюме или кастомный комментарий/)
  const rejectCommentResponse = await handleSupportBotMessage({
    text: 'оставил комменты в резюме',
    chat: { id: -5216637594, type: 'supergroup' },
    from: { id: 100, username: 'student_user' }
  }, foundApi)
  assert.match(responseText(rejectCommentResponse), /Резюме возвращено/)
  assert.equal(lastRejectWorkflowInput.workflowId, 98)
  assert.equal(lastRejectWorkflowInput.expectedStatus, 'Draft in approve by student')
  assert.equal(lastRejectWorkflowInput.comment, 'оставил комменты в резюме')

  const rejectCommandResponse = await handleSupportBotMessage({
    text: '/resume_reject оставил комменты в резюме',
    chat: { id: -5216637594, type: 'supergroup' },
    from: { id: 100, username: 'student_user' }
  }, foundApi)
  assert.match(responseText(rejectCommandResponse), /Резюме возвращено из чата/)
  assert.equal(lastRejectResumeInput.chatId, '-5216637594')
  assert.equal(lastRejectResumeInput.comment, 'оставил комменты в резюме')

  const longStatusCallback = callbackData('advance', 98, 'English version in approve by Kira')
  assert.equal(longStatusCallback, 'resume:advance:98:eak')
  assert(longStatusCallback.length <= 64)
  assert.equal(decodeCallbackStatus(longStatusCallback.split(':')[3]), 'English version in approve by Kira')
  assert.equal(
    decodeCallbackStatus(Buffer.from('Draft in process', 'utf8').toString('base64url')),
    'Draft in process'
  )

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
  let runnerPollTimeout: number | undefined
  await runSupportBot({
    apiClient: foundApi,
    stopSignal: runnerStop.signal,
    botApi: {
      async getUpdates(_offset?: number, timeout?: number, allowedUpdates?: string[]) {
        runnerPollTimeout = timeout
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
  assert.equal(runnerPollTimeout, 0)
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

  const expectedConsoleErrors: string[] = []
  const realConsoleError = console.error
  console.error = (...args: any[]) => {
    expectedConsoleErrors.push(args.map(String).join(' '))
  }
  try {
  const retryPollingStop = new AbortController()
  const retryPollingSentMessages: any[] = []
  let retryPollingCalls = 0
  await runSupportBot({
    apiClient: foundApi,
    stopSignal: retryPollingStop.signal,
    pollTimeout: 0,
    pollErrorDelayMs: 0,
    botApi: {
      async getUpdates() {
        retryPollingCalls += 1
        if (retryPollingCalls === 1) {
          throw new TypeError('fetch failed')
        }
        if (retryPollingCalls === 2) {
          throw Object.assign(new Error('Too Many Requests: retry after 1'), {
            code: 'telegram_bot_api_failed',
            details: { status: 429 }
          })
        }
        if (retryPollingCalls === 3) {
          throw Object.assign(new Error('Conflict: terminated by other getUpdates request; make sure that only one bot instance is running'), {
            code: 'telegram_bot_api_failed',
            details: { status: 409 }
          })
        }
        return [{
          update_id: 2,
          message: {
            text: '/backend_status',
            chat: { id: -5216637594, type: 'supergroup' },
            from: { id: 42, username: 'tester' }
          }
        }]
      },
      async sendMessage(input: any) {
        retryPollingSentMessages.push(input)
        retryPollingStop.abort()
        return { ok: true }
      },
      async answerCallbackQuery() {
        return { ok: true }
      }
    }
  })
  assert.equal(retryPollingCalls, 4)
  assert.equal(retryPollingSentMessages.at(-1).text, 'Бэкенд: работает')

  const fallbackSendStop = new AbortController()
  let fallbackSendAttempts = 0
  await runSupportBot({
    apiClient: {
      ...foundApi,
      async findClient() {
        throw new Error('unexpected backend handler failure')
      }
    },
    stopSignal: fallbackSendStop.signal,
    pollTimeout: 0,
    botApi: {
      async getUpdates() {
        return [{
          update_id: 3,
          message: {
            text: '/student',
            chat: { id: -5216637594, type: 'supergroup' },
            from: { id: 42, username: 'tester' }
          }
        }]
      },
      async sendMessage() {
        fallbackSendAttempts += 1
        fallbackSendStop.abort()
        throw new Error('Telegram send failed')
      },
      async answerCallbackQuery() {
        return { ok: true }
      }
    }
  })
  assert.equal(fallbackSendAttempts, 1)
  } finally {
    console.error = realConsoleError
  }
  assert(expectedConsoleErrors.some(message => message.includes('Too Many Requests')))
  assert(expectedConsoleErrors.some(message => message.includes('fetch failed')))
  assert(expectedConsoleErrors.some(message => message.includes('terminated by other getUpdates request')))
  assert(expectedConsoleErrors.some(message => message.includes('Failed to send Telegram bot response')))

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

  const overloadedApi = createSupportBotApiClient({
    baseUrl: 'http://127.0.0.1:65535',
    token: 'test-bot-token',
    requester: async () => ({
      ok: false,
      status: 429,
      async json() {
        return { error: 'too_many_requests', message: 'Request failed with status code 429' }
      }
    })
  })
  await assert.rejects(
    () => overloadedApi.findClient('-5216637594'),
    (error: any) => {
      assert.equal(error.code, 'backend_overloaded')
      assert.equal(error.message, BACKEND_OVERLOADED_MESSAGE)
      return true
    }
  )
  assert.equal(
    responseText(await handleSupportBotMessage({
      text: '/open_my_tasks',
      chat: { id: 8222949251, type: 'private' },
      from: { id: 8222949251, username: 'veu_support' }
    }, overloadedApi)),
    BACKEND_OVERLOADED_MESSAGE
  )

  const previousResumeTestMode = process.env.RESUME_WORKFLOW_TEST_MODE
  const previousKiraUserIds = process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS
  const previousKiraNotifyChatId = process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID
  const previousProviderUserIds = process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS
  const previousProviderNotifyChatId = process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID
  const previousProviderRefs = process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS
  const previousRusTranslatorUserIds = process.env.RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS
  const previousLinkedInReadyChatId = process.env.RESUME_WORKFLOW_LINKEDIN_READY_CHAT_ID
  const previousLinkedInReadyThreadId = process.env.RESUME_WORKFLOW_LINKEDIN_READY_THREAD_ID
  const previousFakeDataMode = process.env.RESUME_WORKFLOW_FAKE_DATA_MODE
  process.env.RESUME_WORKFLOW_TEST_MODE = 'true'
  process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS = '343610488'
  process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID = '343610488'
  process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS = '8222949251,315110920'
  process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID = '8222949251'
  process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS = '102:473'
  process.env.RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS = '490903294'
  process.env.RESUME_WORKFLOW_LINKEDIN_READY_CHAT_ID = '-1003187558078'
  process.env.RESUME_WORKFLOW_LINKEDIN_READY_THREAD_ID = '777'
  process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = 'false'
  try {
    const manualKiraActor = {
      ...kiraActor,
      userId: '343610488',
      username: 'kira_manual'
    }
    assert.equal(resolveActorForWorkflow(manualKiraActor, makeWorkflow()).role, 'kira')
    assert.equal(resolveActorForWorkflow(ruTranslatorActor, makeWorkflow({
      status: 'Russian version in process'
    })).role, 'provider')
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

    const missingRequiredClientDataRepository = makeWorkflowRepository(makeWorkflow({
      clientGoogleFolder: 'https://drive.google.com/drive/folders/noco-root',
      education: '',
      educationEntries: [],
      englishLevel: '',
      englishLevelId: undefined,
      realAge: undefined,
      realLocation: '',
      desiredLocation: '',
      clientGithubUrl: '',
      clientGithubAccountExists: false,
      clientLinkedInUrl: '',
      clientLinkedInAccountExists: false,
      clientTelegramRu: '',
      clientTelegramEn: ''
    }))
    assert.deepEqual(
      requiredClientDataIssues(missingRequiredClientDataRepository.workflowRecord),
      ['Education', 'English level', 'Real age', 'Real location', 'Desired location', 'Github', 'LinkedIn', 'Telegram RU', 'Telegram EN']
    )
    const missingRequiredStatusResult = await getResumeStatus(
      '-5216637594',
      missingRequiredClientDataRepository,
      { actor: studentActor }
    )
    assert.match(missingRequiredStatusResult.message, /сначала заполни недостающие данные в ЛК/)
    assert.match(missingRequiredStatusResult.message, /образование/)
    assert.match(missingRequiredStatusResult.message, /уровень английского/)
    assert.match(missingRequiredStatusResult.message, /реальный возраст/)
    assert.match(missingRequiredStatusResult.message, /реальная локация/)
    assert.match(missingRequiredStatusResult.message, /желаемая локация/)
    assert.match(missingRequiredStatusResult.message, /аккаунт GitHub/)
    assert.match(missingRequiredStatusResult.message, /аккаунт LinkedIn/)
    assert.match(missingRequiredStatusResult.message, /Telegram RU/)
    assert.match(missingRequiredStatusResult.message, /Telegram EN/)
    assert.doesNotMatch(missingRequiredStatusResult.message, /\/resume </)

    const missingRequiredResumeResult = await resumeWorkflow('-5216637594', missingRequiredClientDataRepository, {
      actor: studentActor,
      studentDataFolderUrl: 'https://drive.google.com/drive/folders/student-source'
    })
    assert.equal(missingRequiredResumeResult.workflow.status, "collection student's data")
    assert.deepEqual(missingRequiredResumeResult.transitions, [])
    assert.equal(missingRequiredClientDataRepository.workflowRecord.studentDataFolderUrl, '')
    assert.match(missingRequiredResumeResult.message, /сначала заполни недостающие данные в ЛК/)

    const emptyUrlsExistingAccountsWorkflow = makeWorkflow({
      clientGithubUrl: '',
      clientGithubAccountExists: true,
      clientLinkedInUrl: '',
      clientLinkedInAccountExists: true
    })
    assert.equal(requiredClientDataIssues(emptyUrlsExistingAccountsWorkflow).includes('Github'), false)
    assert.equal(requiredClientDataIssues(emptyUrlsExistingAccountsWorkflow).includes('LinkedIn'), false)

    const missingSourceRepository = makeWorkflowRepository()
    const missingSourceStatusResult = await getResumeStatus('-5216637594', missingSourceRepository, { actor: studentActor })
    assert.match(missingSourceStatusResult.message, /@veu_support/)
    assert.match(missingSourceStatusResult.message, /clients\.google_folder/)
    assert.doesNotMatch(missingSourceStatusResult.message, /\/resume </)

    const missingSourceResult = await resumeWorkflow('-5216637594', missingSourceRepository, { actor: studentActor })
    assert.equal(missingSourceResult.workflow.status, "collection student's data")
    assert.deepEqual(missingSourceResult.transitions, [])
    assert.equal(missingSourceRepository.workflowRecord.studentDataFolderUrl, '')
    assert.match(missingSourceResult.message, /@veu_support нужно заполнить гугл-папку ученика Test/)
    assert.deepEqual(missingAdvanceFields(missingSourceRepository.workflowRecord), ['root_google_folder', 'student_data_folder_url'])

    const nocoFolderRepository = makeWorkflowRepository(makeWorkflow({
      clientGoogleFolder: 'https://drive.google.com/drive/folders/noco-root'
    }))
    const nocoFolderStatusResult = await getResumeStatus('-5216637594', nocoFolderRepository, { actor: studentActor })
    assert.match(nocoFolderStatusResult.message, /отправь \/resume <ссылка на папку с самопрезентацией\/исходными данными>/)
    assert.doesNotMatch(nocoFolderStatusResult.message, /заполнить обязательные данные в ЛК/)

    const nocoFolderResult = await resumeWorkflow('-5216637594', nocoFolderRepository, { actor: studentActor })
    assert.equal(nocoFolderResult.workflow.status, "collection student's data")
    assert.deepEqual(nocoFolderResult.transitions, [])
    assert.equal(nocoFolderRepository.workflowRecord.studentDataFolderUrl, '')
    assert.match(nocoFolderResult.message, /отправь \/resume <ссылка на папку с самопрезентацией\/исходными данными>/)
    assert.equal(
      nocoFolderResult.message.match(/\/resume <ссылка на папку с самопрезентацией\/исходными данными>/g)?.length,
      1
    )

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
    const unavailableRussianTaskForMainProvider = await getProviderTaskById(98, missingRussianVersionRepository, providerActor)
    assert.equal(unavailableRussianTaskForMainProvider.workflow, undefined)
    assert.match(unavailableRussianTaskForMainProvider.message, /больше недоступна/)
    const missingRussianTask = await getProviderTaskById(98, missingRussianVersionRepository, ruTranslatorActor)
    assert.match(missingRussianTask.message, /Отправь ссылку на русскую версию следующим сообщением/)
    const wrongProviderRussianSave = await saveProviderLinkFromChat(
      missingRussianVersionRepository,
      providerActor,
      'https://drive.google.com/drive/folders/cv-ru-from-wrong-provider',
      { workflowId: 98, expectedStatus: 'Russian version in process' }
    )
    assert.equal(wrongProviderRussianSave.workflow, undefined)
    assert.equal(wrongProviderRussianSave.clearActiveTask, true)
    const savedProviderRussianResult = await saveProviderLinkFromChat(
      missingRussianVersionRepository,
      ruTranslatorActor,
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

    await assert.rejects(
      () => resumeWorkflowById(98, makeWorkflowRepository(makeWorkflow({
        status: 'Draft in process',
        cvDraftUrl: 'https://drive.google.com/drive/folders/seeded-draft'
      })), { actor: ruTranslatorActor }),
      (error: any) => {
        assert.equal(error.code, 'forbidden')
        return true
      }
    )

    const sparseRussianRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Russian version in process',
      studentDataFolderUrl: '',
      kirasComments: '',
      cvDraftUrl: '',
      enVersionUrl: '',
      ruVersionUrl: 'https://drive.google.com/drive/folders/seeded-ru'
    }))
    const sparseRussianTask = await getProviderTaskById(98, sparseRussianRepository, ruTranslatorActor)
    assert.doesNotMatch(sparseRussianTask.message, /исходными данными|комментарии Киры|черновик|английскую/)
    assert.deepEqual(
      sparseRussianTask.replyMarkup.inline_keyboard.flat().map((button: any) => button.text),
      ['Перейти к следующему шагу', 'Назад к задачам']
    )
    const sparseRussianResult = await resumeWorkflowById(98, sparseRussianRepository, { actor: ruTranslatorActor })
    assert.equal(sparseRussianResult.workflow.status, 'Russian version in approve by Kira')
    assert.deepEqual(sparseRussianResult.transitions, ['Russian version in process -> Russian version in approve by Kira'])

    await assert.rejects(
      () => resumeWorkflowById(98, makeWorkflowRepository(makeWorkflow({
        status: 'Russian version in process',
        ruVersionUrl: 'https://drive.google.com/drive/folders/seeded-ru'
      })), { actor: providerActor }),
      (error: any) => {
        assert.equal(error.code, 'forbidden')
        return true
      }
    )

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

    const ruOnlyDraftApprovalRepository = makeWorkflowRepository(makeWorkflow({
      clientMarket: 'Ru',
      status: 'Draft in approve by student',
      cvDraftUrl: 'https://drive.google.com/drive/folders/seeded-draft'
    }))
    const ruOnlyDraftApprovalResult = await resumeWorkflowById(98, ruOnlyDraftApprovalRepository, { actor: studentActor })
    assert.equal(ruOnlyDraftApprovalResult.workflow.status, 'Russian version in process')
    assert.deepEqual(ruOnlyDraftApprovalResult.transitions, ['Draft in approve by student -> Russian version in process'])
    const ruOnlyProviderTask = await getProviderTaskById(98, ruOnlyDraftApprovalRepository, providerActor)
    assert.equal(ruOnlyProviderTask.workflow.status, 'Russian version in process')
    const ruOnlyTranslatorTask = await getProviderTaskById(98, ruOnlyDraftApprovalRepository, ruTranslatorActor)
    assert.equal(ruOnlyTranslatorTask.workflow, undefined)
    assert.match(ruOnlyTranslatorTask.message, /больше недоступна/)

    const ruOnlyFillingRepository = makeWorkflowRepository(makeWorkflow({
      clientMarket: 'Ru',
      status: 'Russian version in approve by student',
      ruVersionUrl: 'https://docs.google.com/document/d/test-russian-version',
      enVersionUrl: ''
    }))
    const ruOnlyFillingResult = await resumeWorkflowById(98, ruOnlyFillingRepository, { actor: studentActor })
    assert.equal(ruOnlyFillingResult.workflow.status, 'moved to filling')
    assert.deepEqual(ruOnlyFillingResult.transitions, ['Russian version in approve by student -> moved to filling'])
    assert.equal(ruOnlyFillingResult.notifications.some((item: any) => item.kind === 'private_kira'), true)
    assert.equal(ruOnlyFillingResult.notifications.some((item: any) => item.kind === 'linkedin_ready'), false)

    const bothMarketFillingRepository = makeWorkflowRepository(makeWorkflow({
      clientMarket: 'both',
      status: 'Russian version in approve by student',
      ruVersionUrl: 'https://docs.google.com/document/d/test-russian-version',
      enVersionUrl: 'https://docs.google.com/document/d/test-english-version'
    }))
    const bothMarketFillingResult = await resumeWorkflowById(98, bothMarketFillingRepository, { actor: studentActor })
    assert.equal(bothMarketFillingResult.workflow.status, 'moved to filling')
    assert.deepEqual(bothMarketFillingResult.transitions, ['Russian version in approve by student -> moved to filling'])
    const bothMarketLinkedInNotification = bothMarketFillingResult.notifications.find((item: any) => item.kind === 'linkedin_ready')
    assert.equal(bothMarketLinkedInNotification.chatId, '-1003187558078')
    assert.equal(bothMarketLinkedInNotification.messageThreadId, 777)
    assert.match(bothMarketLinkedInNotification.text, /^@CheMpoKaRokee, резюме Test, Python, both, готово к заполнению на LinkedIn\./)

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

    await assert.rejects(
      () => rejectResumeWorkflowById(98, makeWorkflowRepository(makeWorkflow({
        status: 'Draft in approve by student',
        cvDraftUrl: 'https://docs.google.com/document/d/test-draft'
      })), {
        actor: studentActor,
        rejectionComment: 'short'
      }),
      (error: any) => {
        assert.equal(error.code, 'resume_reject_comment_too_short')
        return true
      }
    )

    const studentRejectRepository = makeWorkflowRepository(makeWorkflow({
      status: 'Draft in approve by student',
      cvDraftUrl: 'https://docs.google.com/document/d/test-draft'
    }))
    const studentRejectResult = await rejectResumeWorkflowById(98, studentRejectRepository, {
      actor: studentActor,
      expectedStatus: 'Draft in approve by student',
      rejectionComment: 'оставил комменты в резюме'
    })
    assert.equal(studentRejectResult.workflow.status, 'Draft in process')
    assert.equal(studentRejectRepository.workflowRecord.cvDraftUrl, '')
    assert.equal(studentRejectRepository.workflowRecord.lastRejectionComment, 'оставил комменты в резюме')
    assert.match(studentRejectRepository.workflowRecord.rejectionHistory, /Draft in approve by student -> Draft in process/)
    assert.deepEqual(studentRejectResult.transitions, ['Draft in approve by student -> Draft in process'])
    assert.equal(studentRejectResult.notifications.some((notification: any) => notification.kind === 'private_provider'), true)

    const longComment = 'Нужно исправить формат, опыт и короткое саммари.'
    const kiraRejectRepository = makeWorkflowRepository(makeWorkflow({
      status: 'English version in approve by Kira',
      enVersionUrl: 'https://docs.google.com/document/d/test-en'
    }))
    const kiraRejectResult = await rejectResumeWorkflow('-5216637594', kiraRejectRepository, {
      actor: manualKiraActor,
      expectedStatus: 'English version in approve by Kira',
      rejectionComment: longComment
    })
    assert.equal(kiraRejectResult.workflow.status, 'English version in progress')
    assert.equal(kiraRejectRepository.workflowRecord.enVersionUrl, '')
    assert.equal(kiraRejectRepository.workflowRecord.lastRejectionComment, longComment)

    await assert.rejects(
      () => rejectResumeWorkflowById(98, makeWorkflowRepository(makeWorkflow({
        status: 'Draft in process',
        cvDraftUrl: 'https://docs.google.com/document/d/test-draft'
      })), {
        actor: providerActor,
        rejectionComment: 'оставил комменты в резюме'
      }),
      (error: any) => {
        assert.equal(error.code, 'resume_reject_not_allowed')
        return true
      }
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
      { actor: ruTranslatorActor, after: 'Russian version in approve by Kira', notification: 'private_kira' },
      { actor: manualKiraActor, after: 'Russian version in approve by student', notification: 'common_chat' },
      { actor: studentActor, after: 'moved to filling', notification: 'private_kira' }
    ]

    let lastResult: any
    for (const step of steps) {
      lastResult = await resumeWorkflow('-5216637594', repository, { actor: step.actor })
      assert.equal(lastResult.workflow.status, step.after)
      if (step.notification) {
        assert.equal(lastResult.notifications.some((item: any) => item.kind === step.notification), true)
        if (step.notification === 'private_kira' || step.notification === 'private_provider') {
          const notification = lastResult.notifications.find((item: any) => item.kind === step.notification)
          if (step.notification === 'private_kira' && step.after !== 'moved to filling') {
            assert.match(notification.text, /^Кира, резюме/)
          }
          if (step.notification === 'private_provider') {
            if (step.after === 'Russian version in process') {
              assert.match(notification.text, /^Полина, резюме/)
            } else {
              assert.match(notification.text, /^Юля, резюме/)
            }
          }
          assert.doesNotMatch(notification.text, /^@student_user, резюме/)
          if (step.after !== 'moved to filling') {
            assert.match(notification.text, /Открой \/open_my_tasks, чтобы обработать эту задачу/)
            assert.match(notification.text, /Ученик: Test/)
            assert.match(notification.text, /Данные ученика:/)
            assert.match(notification.text, /Рынок ученика: EN/)
            assert.match(notification.text, /Стек: Python/)
            assert.match(notification.text, /Telegram RU: @student_ru/)
            assert.match(notification.text, /Telegram EN: @student_en/)
            assert.match(notification.text, /Phone RU: \+7 999 000 1122/)
            assert.match(notification.text, /Phone EN: \+1 555 0100/)
            assert.match(notification.text, /Реальная локация: Tbilisi, Georgia/)
            assert.match(notification.text, /Желаемая локация: Remote RU proxy/)
            assert.match(notification.text, /GitHub: https:\/\/github\.com\/student-user/)
            assert.match(notification.text, /LinkedIn: https:\/\/linkedin\.com\/in\/student-user/)
            assert.match(notification.text, /Реальный возраст: 24/)
            assert.match(notification.text, /Английский: B1/)
            assert.match(notification.text, /Образование: University/)
          }
          if (step.notification === 'private_provider') {
            assert.deepEqual(
              notification.chatIds,
              step.after === 'Russian version in process' ? ['490903294'] : ['8222949251', '315110920']
            )
          }
        }
        if (step.after === 'Draft in approve by student') {
          const notification = lastResult.notifications.find((item: any) => item.kind === 'common_chat')
          assert.match(notification.text, /^@student_user, резюме/)
          assert.match(notification.text, /Черновик CV: https:\/\/docs\.google\.com\/document\/d\/test-draft/)
          assert.match(notification.text, /Чтобы согласовать, нажми кнопку «Согласовать» или отправь \/resume I approve/)
          assert.match(notification.text, /для того чтобы вернуть на доработку введи \/resume_reject оставил комменты в резюме или кастомный комментарий/)
          assert.match(notification.text, /После этого я переведу резюме на следующий шаг/)
        }
        if (step.after === 'moved to filling') {
          const kiraNotification = lastResult.notifications.find((item: any) => item.kind === 'private_kira')
          assert.match(kiraNotification.text, /Резюме для Test EN передано на заполнение/)
          assert.match(kiraNotification.text, /Английская версия:/)
          assert.match(kiraNotification.text, /Русская версия:/)

          const linkedInNotification = lastResult.notifications.find((item: any) => item.kind === 'linkedin_ready')
          assert.equal(linkedInNotification.chatId, '-1003187558078')
          assert.equal(linkedInNotification.messageThreadId, 777)
          assert.match(linkedInNotification.text, /^@CheMpoKaRokee, резюме Test, Python, EN, готово к заполнению на LinkedIn\./)
          assert.match(linkedInNotification.text, /Ссылка на резюме: https:\/\/docs\.google\.com\/document\/d\/test-english-version/)
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
    const openedProviderTask = await getProviderTaskById(98, makeWorkflowRepository(beforeFilled), providerActor)
    assert.match(openedProviderTask.message, /Данные ученика:/)
    assert.match(openedProviderTask.message, /Рынок ученика: EN/)
    assert.match(openedProviderTask.message, /Стек: Python/)
    assert.match(openedProviderTask.message, /Telegram RU: @student_ru/)
    assert.match(openedProviderTask.message, /Telegram EN: @student_en/)
    assert.match(openedProviderTask.message, /Phone RU: \+7 999 000 1122/)
    assert.match(openedProviderTask.message, /Phone EN: \+1 555 0100/)
    assert.match(openedProviderTask.message, /Реальная локация: Tbilisi, Georgia/)
    assert.match(openedProviderTask.message, /Желаемая локация: Remote RU proxy/)
    assert.match(openedProviderTask.message, /GitHub: https:\/\/github\.com\/student-user/)
    assert.match(openedProviderTask.message, /LinkedIn: https:\/\/linkedin\.com\/in\/student-user/)
    assert.match(openedProviderTask.message, /Реальный возраст: 24/)
    assert.match(openedProviderTask.message, /Английский: B1/)
    assert.match(openedProviderTask.message, /Образование: University/)
    const fillingTaskRepository = {
      async getProviderResumeTasks() {
        return [
          makeWorkflow({ id: 98, clientId: 102, clientName: 'Ready Filling', status: 'moved to filling' }),
          makeWorkflow({ id: 99, clientId: 102, clientName: 'Provider Work', status: 'Russian version in process' })
        ]
      },
      async getResumeWorkflowById(workflowId: number) {
        return makeWorkflow({ id: workflowId, clientId: 102, clientName: 'Ready Filling', status: 'moved to filling' })
      }
    }
    const fillingProviderTasks = await getProviderTasks(fillingTaskRepository, providerActor)
    assert.deepEqual(fillingProviderTasks.tasks.map((task: any) => task.clientName), [])
    assert.doesNotMatch(fillingProviderTasks.message, /Ready Filling/)
    assert.equal(fillingProviderTasks.replyMarkup, undefined)
    assert.doesNotMatch(fillingProviderTasks.message, /Provider Work/)
    const fillingRuTranslatorTasks = await getProviderTasks(fillingTaskRepository, ruTranslatorActor)
    assert.deepEqual(fillingRuTranslatorTasks.tasks.map((task: any) => task.clientName), ['Provider Work'])
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
    assert.match(kiraAdvanceResult.message, /Чтобы согласовать, нажми кнопку «Согласовать» или отправь \/resume I approve/)
    assert.match(kiraAdvanceResult.message, /для того чтобы вернуть на доработку введи \/resume_reject оставил комменты в резюме или кастомный комментарий/)
    assert.match(kiraAdvanceResult.message, /После этого я переведу резюме на следующий шаг/)
    const mixedProviderTasks = await getProviderTasks({
      async getProviderResumeTasks() {
        return [
          makeWorkflow({ id: 98, clientId: 102, clientName: 'Test', status: 'Draft in process' }),
          makeWorkflow({ id: 99, clientId: 999, clientName: 'Other Client', status: 'Draft in process' }),
          makeWorkflow({ id: 100, clientId: 102, clientName: 'RU Client', status: 'Russian version in process' })
        ]
      }
    }, providerActor)
    assert.deepEqual(mixedProviderTasks.tasks.map((task: any) => task.clientName), ['Test'])
    const mixedRuTranslatorTasks = await getProviderTasks({
      async getProviderResumeTasks() {
        return [
          makeWorkflow({ id: 98, clientId: 102, clientName: 'Test', status: 'Draft in process' }),
          makeWorkflow({ id: 99, clientId: 102, clientName: 'English Client', status: 'English version in progress' }),
          makeWorkflow({ id: 100, clientId: 102, clientName: 'RU Client', status: 'Russian version in process' })
        ]
      }
    }, ruTranslatorActor)
    assert.deepEqual(mixedRuTranslatorTasks.tasks.map((task: any) => task.clientName), ['RU Client'])
    process.env.RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS = '8222949251'
    const mixedDevProviderTranslatorTasks = await getProviderTasks({
      async getProviderResumeTasks() {
        return [
          makeWorkflow({ id: 98, clientId: 102, clientName: 'Draft Client', status: 'Draft in process' }),
          makeWorkflow({ id: 99, clientId: 102, clientName: 'English Client', status: 'English version in progress' }),
          makeWorkflow({ id: 100, clientId: 102, clientName: 'RU Translator Client', status: 'Russian version in process' })
        ]
      }
    }, providerActor)
    assert.deepEqual(
      mixedDevProviderTranslatorTasks.tasks.map((task: any) => task.clientName),
      ['Draft Client', 'English Client', 'RU Translator Client']
    )
    process.env.RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS = '490903294'
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
    if (previousRusTranslatorUserIds === undefined) {
      delete process.env.RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS
    } else {
      process.env.RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS = previousRusTranslatorUserIds
    }
    if (previousLinkedInReadyChatId === undefined) {
      delete process.env.RESUME_WORKFLOW_LINKEDIN_READY_CHAT_ID
    } else {
      process.env.RESUME_WORKFLOW_LINKEDIN_READY_CHAT_ID = previousLinkedInReadyChatId
    }
    if (previousLinkedInReadyThreadId === undefined) {
      delete process.env.RESUME_WORKFLOW_LINKEDIN_READY_THREAD_ID
    } else {
      process.env.RESUME_WORKFLOW_LINKEDIN_READY_THREAD_ID = previousLinkedInReadyThreadId
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
