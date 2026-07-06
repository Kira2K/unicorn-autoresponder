const assert = require('node:assert/strict')
const {
  commandArgument,
  commandName,
  handleSupportBotMessage
} = require('./support-bot.ts') as {
  commandArgument(text: string): string
  commandName(text: string): string
  handleSupportBotMessage(message: any, api: any): Promise<string | null>
}

async function runTests() {
  assert.equal(commandName('/student@veu_support_bot hello'), '/student')
  assert.equal(commandArgument('/change_google_folder https://drive.google.com/drive/folders/abc'), 'https://drive.google.com/drive/folders/abc')

  const foundApi = {
    async findClient(chatId: string) {
      return { found: true, chatId, client: { id: 1, name: 'Client One', chatId, googleFolder: '' } }
    },
    async updateGoogleFolder(chatId: string, googleFolder: string) {
      return { success: true, client: { id: 1, name: 'Client One', chatId, googleFolder } }
    }
  }

  assert.equal(
    await handleSupportBotMessage({ text: '/whoami', chat: { id: -5216637594, type: 'supergroup' }, from: { id: 42 } }, foundApi),
    'Chat ID: -5216637594\nChat type: supergroup\nUser ID: 42'
  )
  assert.equal(
    await handleSupportBotMessage({ text: '/student', chat: { id: -5216637594, type: 'supergroup' } }, foundApi),
    'Student found: Client One'
  )
  assert.equal(
    await handleSupportBotMessage({ text: '/change_google_folder https://drive.google.com/drive/folders/abc', chat: { id: -5216637594 } }, foundApi),
    'Google folder updated for Client One.\nNew value: https://drive.google.com/drive/folders/abc'
  )
  assert.equal(
    await handleSupportBotMessage({ text: '/change_google_folder', chat: { id: -5216637594 } }, foundApi),
    'Google folder value is required.'
  )

  const notFoundApi = {
    async findClient(chatId: string) {
      return { found: false, chatId }
    },
    async updateGoogleFolder(chatId: string) {
      return { success: false, error: 'CLIENT_NOT_FOUND', chatId }
    }
  }
  assert.equal(
    await handleSupportBotMessage({ text: '/student', chat: { id: -999 } }, notFoundApi),
    'No student found for this Telegram chat.\n\nChat ID: -999\nPlease link this chat ID to a student in NocoDB/Admin Console.'
  )
  assert.equal(await handleSupportBotMessage({ text: 'hello', chat: { id: -999 } }, notFoundApi), null)

  console.log('support bot tests passed')
}

runTests().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
