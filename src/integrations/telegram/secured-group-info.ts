export type SecuredGroupRow = {
  clientName: unknown
  chatId: unknown
  invitationLink: unknown
}
export type SecuredGroupResult =
  | { kind: 'found'; clientName: string; chatId: string; invitationLink: string }
  | { kind: 'missing-username' | 'unknown-student' | 'ambiguous-student' | 'link-unavailable' }

function normalizeTelegramTag(value: unknown): string {
  if (typeof value !== 'string') return ''
  const tag = value.trim().replace(/^@/, '').toLowerCase()
  return /^[a-z0-9_]{1,32}$/.test(tag) ? tag : ''
}

async function findSecuredGroup(
  username: unknown,
  find: (normalizedTag: string) => Promise<SecuredGroupRow[]>
): Promise<SecuredGroupResult> {
  const tag = normalizeTelegramTag(username)
  if (!tag) return { kind: 'missing-username' }
  const rows = await find(tag)
  if (!rows.length) return { kind: 'unknown-student' }
  if (rows.length > 1) return { kind: 'ambiguous-student' }
  const row = rows[0]
  const chatId = String(row.chatId ?? '').trim()
  const link = typeof row.invitationLink === 'string' ? row.invitationLink.trim() : ''
  if (!/^-[1-9]\d*$/.test(chatId) || !/^https:\/\/t\.me\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+)$/.test(link)) return { kind: 'link-unavailable' }
  return { kind: 'found', clientName: String(row.clientName ?? '').trim(), chatId, invitationLink: link }
}

function securedGroupResponse(result: SecuredGroupResult): { text: string; replyMarkup?: { inline_keyboard: { text: string; url: string }[][] } } {
  if (result.kind === 'found') return {
    text: `Привет${result.clientName ? `, ${result.clientName}` : ''}! Вот ссылка на твою группу Very Evil Unicorn.`,
    replyMarkup: { inline_keyboard: [[{ text: 'Открыть мою группу', url: result.invitationLink }]] }
  }
  const messages = {
    'missing-username': 'Установи Telegram username и сообщи его менеджеру, чтобы получить ссылку на группу.',
    'unknown-student': 'Твой Telegram username пока не привязан к ученику. Обратись к менеджеру.',
    'ambiguous-student': 'Для твоего Telegram username найдено несколько привязок. Обратись к менеджеру для проверки.',
    'link-unavailable': 'Ссылка на твою группу пока недоступна. Обратись к менеджеру.'
  }
  return { text: messages[result.kind] }
}

module.exports = { normalizeTelegramTag, findSecuredGroup, securedGroupResponse }
export type SecuredGroupModule = {
  normalizeTelegramTag: typeof normalizeTelegramTag
  findSecuredGroup: typeof findSecuredGroup
  securedGroupResponse: typeof securedGroupResponse
}
