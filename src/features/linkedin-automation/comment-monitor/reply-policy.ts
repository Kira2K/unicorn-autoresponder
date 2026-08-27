export type ReplyPolicyReason = 'reply' | 'too_short' | 'ai_authorship_question' |
  'provocation' | 'insult' | 'irrelevant_to_context'

export type ReplyPolicyDecision = {
  action: 'reply' | 'skip'
  reason: ReplyPolicyReason
}

const MODEL_SKIP_REASONS = new Set<ReplyPolicyReason>([
  'ai_authorship_question', 'provocation', 'insult', 'irrelevant_to_context'
])

const WORD_SEGMENTER = new Intl.Segmenter('und', { granularity: 'word' })

export function meaningfulWords(value: unknown) {
  const normalized = String(value ?? '').normalize('NFKC')
  return [...WORD_SEGMENTER.segment(normalized)]
    .filter(segment => segment.isWordLike)
    .map(segment => segment.segment)
}

export function deterministicSkipReason(value: unknown): ReplyPolicyReason | undefined {
  return meaningfulWords(value).length <= 1 ? 'too_short' : undefined
}

export function validateModelDecision(value: any, incomingText: unknown): {
  ok: boolean
  decision?: ReplyPolicyDecision
} {
  const action = String(value?.action ?? '')
  const reason = String(value?.reason ?? '') as ReplyPolicyReason
  if (action === 'reply' && reason === 'reply') {
    return { ok: true, decision: { action, reason } }
  }
  const skipAllowed = MODEL_SKIP_REASONS.has(reason) ||
    (reason === 'too_short' && deterministicSkipReason(incomingText) === 'too_short')
  if (action === 'skip' && skipAllowed && !String(value?.reply ?? '').trim() &&
    !String(value?.grounding_phrase ?? '').trim()) {
    return { ok: true, decision: { action, reason } }
  }
  return { ok: false }
}
