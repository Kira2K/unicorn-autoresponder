require('dotenv').config({ quiet: true })

const { createTelegramIntegration } = require('./integration.ts') as typeof import('./integration.ts')

const DESTINATIONS = ['-5216637594', '-1003187558078'] as const

async function run(): Promise<void> {
  const telegram = createTelegramIntegration({
    regularErrorChatId: '',
    summaryLogsChatId: ''
  })
  const runId = new Date().toISOString()
  const evidence: Array<{ chatId: string; messageId: number }> = []
  const failures: Array<{ chatId: string; attempt: number; result: unknown }> = []

  for (const chatId of DESTINATIONS) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await telegram.sendOne({
        chatId,
        text: `Typed Telegram integration smoke ${runId} (${attempt}/2)`
      })
      if (result.kind === 'telegram-response' && result.response.ok) {
        const responseChatId = String(result.response.result.chat.id)
        if (responseChatId !== chatId) {
          failures.push({ chatId, attempt, result: { reason: 'unexpected_chat_id', responseChatId } })
          continue
        }
        evidence.push({ chatId: responseChatId, messageId: result.response.result.message_id })
      } else {
        failures.push({ chatId, attempt, result })
      }
    }
  }

  console.log(JSON.stringify({ runId, evidence, failures }, null, 2))
  if (evidence.length !== 4 || failures.length) {
    process.exitCode = 1
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  process.exitCode = 1
})
