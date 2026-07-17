const assert = require('node:assert/strict')
const { runVisibleResumeE2e } = require('./resume-visible-e2e.ts') as {
  runVisibleResumeE2e(options?: any): Promise<any>
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function makeRepository() {
  const client = {
    id: 102,
    clientName: 'Тест',
    education: 'University',
    englishLevelId: undefined as number | undefined,
    englishLevel: '',
    googleFolder: '',
    telegramPersonalChatId: '@Kira_arbeitet',
    commonChatId: '-5216637594',
    market: 'EN'
  }
  const workflow = {
    id: 98,
    clientId: 102,
    clientName: 'Тест',
    clientMarket: 'EN',
    clientTelegramUsername: '@Kira_arbeitet',
    clientGoogleFolder: '',
    commonChatId: '-5216637594',
    education: client.education,
    englishLevel: client.englishLevel,
    englishLevelId: client.englishLevelId,
    status: "collection student's data",
    studentDataFolderUrl: '',
    cvDraftUrl: '',
    enVersionUrl: '',
    ruVersionUrl: '',
    additionalVersions: '',
    kirasComments: '',
    lastResponsible: 'student',
    lastWorkflowError: '',
    workflowTrace: ''
  }

  function syncClientFields() {
    workflow.education = client.education
    workflow.englishLevel = client.englishLevel
    workflow.englishLevelId = client.englishLevelId
    workflow.clientTelegramUsername = client.telegramPersonalChatId
    workflow.clientGoogleFolder = client.googleFolder
    workflow.commonChatId = client.commonChatId
    workflow.clientMarket = client.market
  }

  return {
    client,
    workflow,
    async getClientById(clientId: number) {
      assert.equal(clientId, 102)
      return client
    },
    async listEnglishLevels() {
      return [{ id: 3, label: 'B1' }]
    },
    async updateClientProfile(clientId: number, patch: any) {
      assert.equal(clientId, 102)
      if (patch.education !== undefined) client.education = normalizeText(patch.education)
      if (patch.englishLevelId !== undefined) {
        client.englishLevelId = Number(patch.englishLevelId)
        client.englishLevel = 'B1'
      }
      syncClientFields()
      return { client, platformAccounts: [], linkedInEmail: '' }
    },
    async findClientByTelegramChatId(chatId: string) {
      return String(chatId) === client.commonChatId ? client : null
    },
    async updateGoogleFolderByTelegramChatId(chatId: string, googleFolder: string) {
      if (String(chatId) !== client.commonChatId) return null
      client.googleFolder = googleFolder
      syncClientFields()
      return client
    },
    async getResumeWorkflowByTelegramChatId(chatId: string) {
      syncClientFields()
      return String(chatId) === client.commonChatId ? workflow : null
    },
    async getResumeWorkflowById(workflowId: number) {
      syncClientFields()
      return Number(workflowId) === Number(workflow.id) ? workflow : null
    },
    async getProviderResumeTasks() {
      syncClientFields()
      return [workflow]
    },
    async patchResumeWorkflow(recordId: number, patch: any) {
      assert.equal(recordId, workflow.id)
      Object.assign(workflow, patch)
      syncClientFields()
      return workflow
    }
  }
}

function makeVisibleTelegramHarness() {
  let updateId = 1
  let messageId = 1
  const updates: any[] = []
  const messagesByChat = new Map<string, any[]>()
  const studentSends: string[] = []

  function pushMessage(chatId: string, text: string, outgoing: boolean) {
    const message = {
      id: String(messageId++),
      chatId,
      text,
      outgoing,
      date: new Date().toISOString()
    }
    messagesByChat.set(chatId, [...(messagesByChat.get(chatId) || []), message])
    return message
  }

  const telegramService = {
    async send(_clientId: number, input: any) {
      studentSends.push(input.text)
      const message = pushMessage(String(input.chatId), input.text, true)
      updates.push({
        update_id: updateId++,
        message: {
          message_id: Number(message.id),
          text: input.text,
          chat: { id: Number(input.chatId), type: 'supergroup' },
          from: { id: 343610488, username: 'Kira_arbeitet' }
        }
      })
      return { accountId: input.accountId, message }
    },
    async messages(_clientId: number, input: any) {
      return {
        accountId: input.accountId,
        messages: (messagesByChat.get(String(input.chatId)) || []).slice(-(input.limit || 50))
      }
    }
  }

  const botApi = {
    sentMessages: [] as any[],
    async getUpdates(offset?: number) {
      await new Promise(resolve => setTimeout(resolve, 5))
      const threshold = Number(offset || 0)
      return updates.filter(update => Number(update.update_id) >= threshold)
    },
    async sendMessage(input: any) {
      this.sentMessages.push(input)
      if (String(input.chatId) === '-5216637594') {
        pushMessage(String(input.chatId), input.text, false)
      }
      return { message_id: messageId++, chat: { id: input.chatId }, text: input.text }
    },
    async answerCallbackQuery() {
      return { ok: true }
    }
  }

  return {
    botApi,
    studentSends,
    telegramService,
    messagesByChat
  }
}

async function runTests() {
  const repository = makeRepository()
  repository.client.googleFolder = 'https://drive.google.com/drive/folders/visible-root-test'
  repository.workflow.studentDataFolderUrl = 'https://drive.google.com/drive/folders/visible-fake-test'
  const harness = makeVisibleTelegramHarness()
  const result = await runVisibleResumeE2e({
    repository,
    telegramService: harness.telegramService,
    botApi: harness.botApi,
    googleFolder: 'https://drive.google.com/drive/folders/visible-fake-test',
    skipBotPreflight: true,
    summaryLogsChannelId: '',
    pollTimeout: 0,
    waitTimeoutMs: 5000
  })

  assert.equal(result.ok, true)
  assert.equal(result.final.status, 'moved to filling')
  assert.equal(result.final.studentDataFolderUrl, 'https://drive.google.com/drive/folders/visible-fake-test')
  assert.deepEqual(harness.studentSends, [
    '/whoami',
    '/resume',
    '/resume',
    '/resume',
    '/resume'
  ])
  const commonChatText = (harness.messagesByChat.get('-5216637594') || []).map((message: any) => message.text).join('\n')
  assert.doesNotMatch(commonChatText, /Google folder updated/)
  assert.match(commonChatText, /черновик на согласовании у ученика/)
  assert.match(commonChatText, /английская версия на согласовании у ученика/)
  assert.match(commonChatText, /русская версия на согласовании у ученика/)
  assert.equal(result.steps.some((step: any) => step.step === 'provider_tasks' && step.status === 'Draft in process'), true)

  console.log('visible resume e2e tests passed')
}

runTests().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
