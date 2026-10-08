import type { InputRichMessage } from '@grammyjs/types'
import type { SendOneInput } from './types.ts'

const HTML_TAG = /<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' }

function renderedHtml(text: string): string {
  return text.replace(HTML_TAG, '').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot);/gi, (entity, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()]
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity
  })
}

/** Select one delivery without truncation, retries, or changing Markdown semantics. */
export function prepareTelegramRichMessage(input: Pick<SendOneInput, 'text' | 'parseMode'>): InputRichMessage<never> | undefined {
  if (input.parseMode && input.parseMode !== 'HTML') return undefined
  const rendered = input.parseMode === 'HTML' ? renderedHtml(input.text) : input.text
  const length = Array.from(rendered).length
  if (length <= 4096) return undefined
  if (length > 32768) {
    throw Object.assign(new Error('Telegram message exceeds the 32768-character Rich Message limit.'), {
      code: 'telegram_rich_message_too_long'
    })
  }
  if (input.parseMode !== 'HTML') return { blocks: [{ type: 'paragraph', text: input.text }] }

  // Rich HTML collapses ordinary whitespace. Keep the existing card's line breaks,
  // but do not alter tag attributes or literal newlines inside pre/code blocks.
  const html = input.text.replace(
    /<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>|\r\n|\r|\n/gi,
    part => part.startsWith('<') ? part : '<br>'
  )
  return { html }
}
