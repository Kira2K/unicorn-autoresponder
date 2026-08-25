const BANNED = [
  /^great (insight|point|post)/i, /^thanks for sharing/i, /^well said/i,
  /^absolutely agree/i, /^this resonates/i, /^spot on/i, /^love this/i
]

const words = (value: string) => value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)?/g) ?? []
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function validateReply(reply: unknown, grounding: unknown, context: string) {
  const text = String(reply ?? '').trim()
  const phrase = String(grounding ?? '').trim()
  const issues: string[] = []
  const count = words(text).length
  if (count < 5 || count > 10) issues.push('comment_reply_word_count')
  if (!/^[A-Z]/.test(text) || !/[.!?]$/.test(text) || /[.!?].+[.!?]$/.test(text)) {
    issues.push('comment_reply_sentence_invalid')
  }
  if (/https?:\/\/|www\.|#|\r|\n/u.test(text) || /[^\x00-\x7F]/u.test(text)) {
    issues.push('comment_reply_format_invalid')
  }
  if (BANNED.some(pattern => pattern.test(text))) issues.push('comment_reply_ai_slop')
  if (phrase.length < 3 || !normalized(context).includes(normalized(phrase))) {
    issues.push('comment_reply_not_grounded')
  }
  return { ok: issues.length === 0, text, issues }
}
