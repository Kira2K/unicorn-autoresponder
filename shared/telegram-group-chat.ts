// Choose the destination before normalization or delivery. A delivery failure must
// never make the caller retry against the retired group.
function selectTelegramGroupChatId(
  client?: { secured_general_chat_id?: unknown; telegram_general_chat_id?: unknown } | null,
  fallback: unknown = client?.telegram_general_chat_id
): unknown {
  const secured = client?.secured_general_chat_id
  return String(secured ?? '').trim() ? secured : fallback
}

module.exports = { selectTelegramGroupChatId }
