export type TestNotification = { channel: 'bot' | 'summary'; chatId: string; text: string; messageThreadId?: number };
export function workflowTestServices(notifications: TestNotification[]) {
  const disabled = new Proxy({}, { get: () => async () => {
    throw Object.assign(new Error('Внешние действия в SQL-тесте отключены.'), { code: 'sql_test_operation_disabled' });
  } });
  return {
    summaryLogsChannelId: '-9006',
    telegramService: disabled, telegramAdapter: disabled, telegramGatewayService: disabled,
    telegramGatewayEnv: { WEB_CONSOLE_TELEGRAM_MODE: 'local' },
    telegramBotApi: { async sendMessage(input: { chatId: string; text: string; messageThreadId?: number }) {
      notifications.push({ channel: 'bot', chatId: input.chatId, text: input.text, messageThreadId: input.messageThreadId });
      return { ok: true };
    } },
    async sendSummaryTelegramMessage(chatId: string | number, text: string) {
      notifications.push({ channel: 'summary', chatId: String(chatId), text });
    }
  };
}
