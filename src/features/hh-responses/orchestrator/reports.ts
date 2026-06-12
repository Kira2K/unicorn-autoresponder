const { TELEGRAM_MESSAGE_LIMIT } = require('./config.ts')

function splitTelegramMessage(message: string): string[] {
  if (message.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [message]
  }

  const chunks: string[] = []
  let remaining = message

  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    const slice = remaining.slice(0, TELEGRAM_MESSAGE_LIMIT)
    const splitAt = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('\n')
    )
    const chunkEnd = splitAt > TELEGRAM_MESSAGE_LIMIT * 0.6 ? splitAt : slice.length

    chunks.push(remaining.slice(0, chunkEnd).trimEnd())
    remaining = remaining.slice(chunkEnd).trimStart()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}

module.exports = {
  splitTelegramMessage
}
