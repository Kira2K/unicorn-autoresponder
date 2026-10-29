const { telegramForReports } = require('../../../integrations/telegram/index.ts')
type SendOneInput = import('../../../integrations/telegram/types.ts').SendOneInput
type SendOneResult = import('../../../integrations/telegram/types.ts').SendOneResult
type ReportOptions = { parseMode?: false | 'html' | 'md' | 'markdown' }
function createSendReport(api: {sendOne(input: SendOneInput): Promise<SendOneResult>}) {
  return async (to: string, text: string, options: ReportOptions = {}): Promise<void> => {
    const parseMode = options.parseMode === 'html' ? 'HTML' : options.parseMode ? 'Markdown' : undefined
    const result = await api.sendOne({chatId: to, text, ...(parseMode ? {parseMode} : {})})
    if (result.kind === 'telegram-response' && result.response.ok) return
    const reason = result.kind === 'client-failure'
      ? result.failure.stage
      : `Bot API ${result.response.ok ? 'unknown' : result.response.error_code}`
    throw new Error(`Telegram report delivery failed: ${reason}`)
  }
}
async function sendTelegramMessage(to: string, text: string, options: ReportOptions = {}): Promise<void> {
  const api = telegramForReports(process.env.summary_logs_channel_id || to)
  await createSendReport(api)(to, text, options)
}
module.exports = {createSendReport, sendTelegramMessage}
